import assert from "node:assert";
import { toFunctionSelector } from "viem";
import { scanBytecode } from "../src/analyze.js";
import { DANGER_BY_SELECTOR } from "../src/selectors.js";

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`  ok  ${name}`);
}

// Build runtime bytecode: PUSH4 <mint selector>, then PUSH1 0xff (data byte 0xff,
// which must NOT be read as SELFDESTRUCT), then a real SELFDESTRUCT (0xff) and a
// real DELEGATECALL (0xf4).
const mintSel = toFunctionSelector("mint(address,uint256)").slice(2); // 8 hex
const pauseSel = toFunctionSelector("pause()").slice(2);

const bytecode =
  "0x" +
  "63" + mintSel + // PUSH4 mint selector  (must be detected)
  "60ff" +         // PUSH1 0xff           (data 0xff must be SKIPPED, not flagged)
  "63" + pauseSel + // PUSH4 pause selector (must be detected)
  "f4" +           // DELEGATECALL         (real opcode, must be flagged)
  "00" +           // STOP
  "ff";            // SELFDESTRUCT         (real opcode, must be flagged)

const scan = scanBytecode(bytecode as `0x${string}`);

check("detects PUSH4 mint selector", scan.selectors.has(("0x" + mintSel).toLowerCase()));
check("detects PUSH4 pause selector", scan.selectors.has(("0x" + pauseSel).toLowerCase()));
check("mint selector maps to a danger sig", DANGER_BY_SELECTOR.has(("0x" + mintSel).toLowerCase()));
check("real SELFDESTRUCT flagged", scan.hasSelfdestruct === true);
check("real DELEGATECALL flagged", scan.hasDelegatecall === true);

// Walker correctness: a bytecode whose ONLY 0xff is inside PUSH data must NOT flag selfdestruct.
const onlyDataFF = "0x" + "60ff" + "00"; // PUSH1 0xff ; STOP
const scan2 = scanBytecode(onlyDataFF as `0x${string}`);
check("0xff inside PUSH data is NOT a selfdestruct", scan2.hasSelfdestruct === false);

// Empty / EOA-style code
const scan3 = scanBytecode("0x" as `0x${string}`);
check("empty bytecode yields no selectors", scan3.selectors.size === 0);

console.log(`\n${passed} checks passed.`);
