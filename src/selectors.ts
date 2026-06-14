import { toFunctionSelector } from "viem";

export type Category =
  | "upgradeability"
  | "ownership"
  | "supply"
  | "freeze"
  | "fee"
  | "fund-movement";

export interface DangerSig {
  signature: string; // e.g. "mint(address,uint256)"
  category: Category;
  severity: "high" | "medium" | "low";
  why: string;
}

/**
 * Curated set of function signatures whose PRESENCE in a deployed contract's
 * bytecode is a risk signal for an autonomous agent about to transact with it.
 * Detection is by 4-byte selector found in the dispatch table (PUSH4 immediates),
 * so it works on UNVERIFIED contracts from bytecode alone — no source needed.
 */
export const DANGER_SIGNATURES: DangerSig[] = [
  // Upgradeability — logic can be swapped out from under the agent
  { signature: "upgradeTo(address)", category: "upgradeability", severity: "high", why: "Contract logic is upgradeable; the implementation an agent audited can be replaced at any time." },
  { signature: "upgradeToAndCall(address,bytes)", category: "upgradeability", severity: "high", why: "UUPS-style upgrade entrypoint; logic can be replaced and re-initialized." },

  // Ownership / admin — a privileged actor controls the contract
  { signature: "transferOwnership(address)", category: "ownership", severity: "medium", why: "Ownable: a single owner controls privileged functions." },
  { signature: "setOwner(address)", category: "ownership", severity: "medium", why: "Owner can be reassigned; privileged control present." },
  { signature: "changeAdmin(address)", category: "ownership", severity: "high", why: "Proxy admin can be changed; admin controls the implementation." },

  // Supply control — owner can dilute / inflate
  { signature: "mint(address,uint256)", category: "supply", severity: "high", why: "Token supply can be minted by a privileged role; balances/price can be diluted." },
  { signature: "mint(uint256)", category: "supply", severity: "high", why: "Mint entrypoint present; supply is not fixed." },
  { signature: "setMaxSupply(uint256)", category: "supply", severity: "medium", why: "Max supply is mutable." },

  // Freeze / censor — the agent's funds or transfers can be blocked
  { signature: "pause()", category: "freeze", severity: "high", why: "Transfers/operations can be paused, freezing the agent's position." },
  { signature: "blacklist(address)", category: "freeze", severity: "high", why: "Addresses can be blacklisted; the agent could be blocked from moving funds." },
  { signature: "addBlackList(address)", category: "freeze", severity: "high", why: "Blacklist mechanism (USDT-style); the agent can be censored." },
  { signature: "setBlocked(address,bool)", category: "freeze", severity: "high", why: "Per-address block switch; the agent can be frozen out." },
  { signature: "freeze(address)", category: "freeze", severity: "high", why: "Accounts can be frozen by a privileged role." },

  // Fee / tax — classic honeypot / value-skim signals on tokens
  { signature: "setFee(uint256)", category: "fee", severity: "medium", why: "Transfer fee is adjustable; can be raised to skim or trap value." },
  { signature: "setTaxFee(uint256)", category: "fee", severity: "medium", why: "Tax fee is adjustable (reflection/honeypot pattern)." },
  { signature: "setMaxTxAmount(uint256)", category: "fee", severity: "medium", why: "Max transaction amount is adjustable; can be set low to trap holders." },
  { signature: "setMaxWalletAmount(uint256)", category: "fee", severity: "medium", why: "Max wallet cap adjustable; honeypot-style restriction." },
  { signature: "enableTrading()", category: "fee", severity: "low", why: "Trading can be toggled on/off; sells may be blocked (honeypot)." },
  { signature: "setTradingEnabled(bool)", category: "fee", severity: "medium", why: "Trading on/off switch; sells can be disabled after buys (honeypot)." },

  // Fund movement / rug — owner can pull assets
  { signature: "withdrawAll()", category: "fund-movement", severity: "high", why: "A privileged withdraw-all exists; pooled funds can be pulled." },
  { signature: "emergencyWithdraw()", category: "fund-movement", severity: "medium", why: "Emergency withdraw entrypoint; funds can be swept under 'emergency'." },
  { signature: "sweep(address)", category: "fund-movement", severity: "medium", why: "Token sweep entrypoint; arbitrary tokens can be moved out." },
  { signature: "rescueTokens(address,uint256)", category: "fund-movement", severity: "medium", why: "Rescue entrypoint; tokens can be moved out by a privileged role." },
  { signature: "setRouter(address)", category: "fund-movement", severity: "low", why: "Swap router is mutable; flows can be redirected." },
];

export interface DangerSelector extends DangerSig {
  selector: `0x${string}`; // 4-byte selector, lowercase, 0x-prefixed
}

/** signatures resolved to their 4-byte selectors (computed at load, not hardcoded). */
export const DANGER_SELECTORS: DangerSelector[] = DANGER_SIGNATURES.map((s) => ({
  ...s,
  selector: toFunctionSelector(s.signature).toLowerCase() as `0x${string}`,
}));

/** map: selector -> DangerSig, for O(1) lookup during the bytecode scan. */
export const DANGER_BY_SELECTOR: Map<string, DangerSelector> = new Map(
  DANGER_SELECTORS.map((d) => [d.selector, d]),
);
