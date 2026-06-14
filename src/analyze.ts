import { z } from "zod";
import {
  type PublicClient,
  type Address,
  getAddress,
  isAddress,
} from "viem";
import { DANGER_BY_SELECTOR } from "./selectors.js";

// ---------------------------------------------------------------------------
// Schemas (shared by the LangChain tool, the MCP server and the Action object)
// ---------------------------------------------------------------------------

export const GuardSkillInputSchema = z.object({
  address: z.string().describe("The target contract address the agent is about to transact with."),
});
export type GuardSkillInput = z.infer<typeof GuardSkillInputSchema>;

export const FlagSchema = z.object({
  id: z.string(),
  category: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  title: z.string(),
  detail: z.string(),
});
export type Flag = z.infer<typeof FlagSchema>;

export const RiskReportSchema = z.object({
  address: z.string(),
  chainId: z.number(),
  isContract: z.boolean(),
  contractKind: z.enum(["eoa", "contract", "eip1967-proxy", "uups-proxy", "minimal-proxy", "beacon-proxy"]),
  token: z
    .object({
      isERC20: z.boolean(),
      name: z.string().optional(),
      symbol: z.string().optional(),
      decimals: z.number().optional(),
      owner: z.string().optional(),
    })
    .optional(),
  flags: z.array(FlagSchema),
  score: z.number().describe("0-100, higher = riskier"),
  level: z.enum(["ok", "caution", "block"]),
  recommendation: z.string(),
  summary: z.string(),
});
export type RiskReport = z.infer<typeof RiskReportSchema>;

// ---------------------------------------------------------------------------
// Bytecode opcode walker
// ---------------------------------------------------------------------------

const OP_SELFDESTRUCT = 0xff;
const OP_DELEGATECALL = 0xf4;
const OP_PUSH1 = 0x60;
const OP_PUSH32 = 0x7f;
const OP_PUSH4 = 0x63;

interface BytecodeScan {
  selectors: Set<string>;
  hasSelfdestruct: boolean;
  hasDelegatecall: boolean;
  sizeBytes: number;
}

/**
 * Walk runtime bytecode opcode-by-opcode, correctly skipping PUSH immediates so
 * we never mistake pushed DATA for an opcode. Collects every PUSH4 immediate
 * (the function-dispatch selectors) and flags real SELFDESTRUCT / DELEGATECALL
 * opcodes. Works on unverified contracts (no source / ABI required).
 */
/**
 * Strip the trailing Solidity metadata (CBOR) so we don't scan DATA as if it
 * were opcodes (which yields spurious selectors / SELFDESTRUCT / DELEGATECALL).
 * Layout: [...runtime code...][CBOR metadata][2-byte big-endian metadata length].
 */
function stripMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4) return bytes;
  const len = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
  const start = bytes.length - 2 - len;
  if (start > 0 && len > 0) {
    const b = bytes[start];
    // CBOR map of 1-3 entries (solc emits 0xa1/0xa2/0xa3 ...)
    if (b === 0xa1 || b === 0xa2 || b === 0xa3) return bytes.slice(0, start);
  }
  return bytes;
}

export function scanBytecode(code: `0x${string}`): BytecodeScan {
  const hex = code.slice(2);
  const all = new Uint8Array(hex.length / 2);
  for (let i = 0; i < all.length; i++) all[i] = parseInt(hex.substr(i * 2, 2), 16);
  const bytes = stripMetadata(all);

  const selectors = new Set<string>();
  let hasSelfdestruct = false;
  let hasDelegatecall = false;

  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i];
    if (op === OP_SELFDESTRUCT) hasSelfdestruct = true;
    else if (op === OP_DELEGATECALL) hasDelegatecall = true;

    if (op >= OP_PUSH1 && op <= OP_PUSH32) {
      const n = op - OP_PUSH1 + 1; // bytes pushed
      if (op === OP_PUSH4 && i + 4 < bytes.length) {
        let sel = "0x";
        for (let k = 1; k <= 4; k++) sel += bytes[i + k].toString(16).padStart(2, "0");
        selectors.add(sel.toLowerCase());
      }
      i += 1 + n;
    } else {
      i += 1;
    }
  }
  return { selectors, hasSelfdestruct, hasDelegatecall, sizeBytes: bytes.length };
}

// ---------------------------------------------------------------------------
// Proxy detection
// ---------------------------------------------------------------------------

// EIP-1967 storage slots
const SLOT_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const SLOT_ADMIN = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103" as const;
const SLOT_BEACON = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as const;

function slotIsSet(v: string | undefined): boolean {
  return !!v && /[1-9a-f]/i.test(v.slice(2)); // any non-zero nibble
}

function isMinimalProxy(code: `0x${string}`): boolean {
  const c = code.toLowerCase();
  // EIP-1167: 363d3d373d3d3d363d73 <impl> 5af43d82803e903d91602b57fd5bf3
  return c.startsWith("0x363d3d373d3d3d363d73") && c.includes("5af43d82803e903d91602b57fd5bf3");
}

// ---------------------------------------------------------------------------
// Minimal ERC20 probe ABI
// ---------------------------------------------------------------------------

const erc20Abi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

async function tryRead<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHT = { high: 40, medium: 15, low: 5 } as const;

/**
 * Analyze a target address for transaction-time risk. READ-ONLY: only eth_getCode,
 * eth_getStorageAt and view calls — never sends a transaction, never needs a key.
 */
export async function analyzeContract(client: PublicClient, rawAddress: string): Promise<RiskReport> {
  const chainId = client.chain?.id ?? Number(process.env.BSC_CHAIN_ID ?? 56);

  if (!isAddress(rawAddress, { strict: false })) {
    throw new Error(`Invalid address: ${rawAddress}`);
  }
  const address = getAddress(rawAddress) as Address;

  const code = (await client.getCode({ address })) ?? "0x";
  const flags: Flag[] = [];

  // EOA: no code.
  if (code === "0x") {
    return {
      address,
      chainId,
      isContract: false,
      contractKind: "eoa",
      flags: [],
      score: 0,
      level: "ok",
      recommendation: "Target is an externally-owned account (no code), not a contract. A native-value transfer carries no contract-logic risk. If the agent expected a contract here, treat the mismatch as suspicious.",
      summary: "EOA (no contract code at this address).",
    };
  }

  const scan = scanBytecode(code as `0x${string}`);

  // ---- proxy / upgradeability detection ----
  let contractKind: RiskReport["contractKind"] = "contract";
  if (isMinimalProxy(code as `0x${string}`)) {
    contractKind = "minimal-proxy";
    flags.push({
      id: "minimal-proxy",
      category: "upgradeability",
      severity: "low",
      title: "EIP-1167 minimal proxy",
      detail: "Calls are delegated to a fixed implementation. The implementation address is immutable in the proxy but the agent is interacting with delegated logic.",
    });
  } else {
    const [impl, admin, beacon] = await Promise.all([
      tryRead(client.getStorageAt({ address, slot: SLOT_IMPL })),
      tryRead(client.getStorageAt({ address, slot: SLOT_ADMIN })),
      tryRead(client.getStorageAt({ address, slot: SLOT_BEACON })),
    ]);
    if (slotIsSet(beacon)) {
      contractKind = "beacon-proxy";
      flags.push({ id: "beacon-proxy", category: "upgradeability", severity: "high", title: "EIP-1967 beacon proxy", detail: "Implementation is resolved from a beacon that can be upgraded, swapping logic for ALL proxies at once." });
    } else if (slotIsSet(impl)) {
      contractKind = slotIsSet(admin) ? "eip1967-proxy" : "uups-proxy";
      flags.push({
        id: "eip1967-proxy",
        category: "upgradeability",
        severity: "high",
        title: `EIP-1967 ${slotIsSet(admin) ? "transparent" : "UUPS"} proxy`,
        detail: "Upgradeable proxy: the implementation the agent inspects can be replaced by the proxy admin at any time, changing behavior after the agent decided to trust it.",
      });
    }
  }

  // ---- dangerous selectors in the dispatch table ----
  const seenCategories = new Set<string>();
  for (const sel of scan.selectors) {
    const d = DANGER_BY_SELECTOR.get(sel);
    if (d) {
      flags.push({ id: `sel:${d.signature}`, category: d.category, severity: d.severity, title: d.signature, detail: d.why });
      seenCategories.add(d.category);
    }
  }

  // ---- raw opcode risks ----
  if (scan.hasSelfdestruct) {
    flags.push({ id: "opcode:selfdestruct", category: "fund-movement", severity: "high", title: "SELFDESTRUCT opcode present", detail: "The contract can self-destruct, which can brick balances/allowances and strand funds the agent sent or approved." });
  }
  if (scan.hasDelegatecall && contractKind === "contract") {
    flags.push({ id: "opcode:delegatecall", category: "upgradeability", severity: "medium", title: "DELEGATECALL opcode present", detail: "Uses delegatecall (library/proxy/router pattern); behavior may depend on mutable external logic." });
  }

  // ---- ERC20 probes (best-effort, read-only) ----
  const [name, symbol, decimals, totalSupply, owner] = await Promise.all([
    tryRead(client.readContract({ address, abi: erc20Abi, functionName: "name" }) as Promise<string>),
    tryRead(client.readContract({ address, abi: erc20Abi, functionName: "symbol" }) as Promise<string>),
    tryRead(client.readContract({ address, abi: erc20Abi, functionName: "decimals" }) as Promise<number>),
    tryRead(client.readContract({ address, abi: erc20Abi, functionName: "totalSupply" }) as Promise<bigint>),
    tryRead(client.readContract({ address, abi: erc20Abi, functionName: "owner" }) as Promise<string>),
  ]);
  const isERC20 = decimals !== undefined && totalSupply !== undefined;
  let token: RiskReport["token"] | undefined;
  if (isERC20) {
    token = { isERC20: true, name, symbol, decimals: Number(decimals), owner: owner ? getAddress(owner) : undefined };
    if (owner && /[1-9a-f]/i.test(owner.slice(2))) {
      flags.push({ id: "live-owner", category: "ownership", severity: "low", title: "Token has a live owner()", detail: `owner() = ${getAddress(owner)} — a privileged account controls owner-gated functions. Confirm it is a timelock/multisig, not a single EOA.` });
    }
    // honeypot heuristic: fee/trading controls on a token
    if (seenCategories.has("fee")) {
      flags.push({ id: "honeypot-signal", category: "fee", severity: "medium", title: "Honeypot-style fee/trading controls on a token", detail: "Adjustable fees / trading toggles on a token are a common honeypot pattern (buys allowed, sells taxed or blocked). Treat sells as not guaranteed." });
    }
  }

  // ---- score + level ----
  let score = 0;
  for (const f of flags) score += SEVERITY_WEIGHT[f.severity];
  score = Math.min(100, score);

  const hasHigh = flags.some((f) => f.severity === "high");
  let level: RiskReport["level"];
  if (score >= 40 || hasHigh) level = "block";
  else if (score >= 15) level = "caution";
  else level = "ok";

  const recommendation =
    level === "block"
      ? "BLOCK: do not transact autonomously. High-severity control(s) detected (upgradeable logic, mint, pause/blacklist, self-destruct or privileged fund movement). Require human review / an allowlist before sending value or approvals."
      : level === "caution"
        ? "CAUTION: proceed only with limits. Medium-severity controls present. Cap approvals (no infinite approve), bound the amount, and avoid recurring/unattended interaction until reviewed."
        : "OK: no high-risk controls detected in bytecode. Still cap approvals to the needed amount; this is a heuristic bytecode scan, not a full audit.";

  const summary = `${contractKind}${token?.isERC20 ? ` ERC20 ${token.symbol ?? ""}`.trimEnd() : ""}; ${flags.length} flag(s); risk ${score}/100 -> ${level.toUpperCase()}.`;

  return { address, chainId, isContract: true, contractKind, token, flags, score, level, recommendation, summary };
}
