import { createClaudeSubagentBridge } from "../src/agent/claudeBridge.js";
import type { AgentBridgeInput } from "../src/agent/orchestrator.js";

type SmokeStep = Pick<AgentBridgeInput, "agent" | "inputSummary">;

const timeoutMs = Number(process.env.BRAIN_CREATOR_AGENT_TIMEOUT_MS ?? 120000);
const bridge = createClaudeSubagentBridge({
  command: process.env.BRAIN_CREATOR_AGENT_COMMAND,
  baseArgs: parseArgs(process.env.BRAIN_CREATOR_AGENT_ARGS),
  timeoutMs
});

const steps: SmokeStep[] = [
  {
    agent: "planner",
    inputSummary:
      "Live smoke only. Confirm the Brain Creator planner can receive a task. Do not create or edit files. Reply in one short sentence."
  },
  {
    agent: "generator",
    inputSummary:
      "Live smoke only. Confirm the Brain Creator generator can receive an approved-case task. Do not create or edit files. Reply in one short sentence."
  },
  {
    agent: "healer",
    inputSummary:
      "Live smoke only. Confirm the Brain Creator healer can receive a failing-test task. Do not create or edit files. Reply in one short sentence."
  }
];

console.log("Running live Claude planner -> generator -> healer smoke...");
for (const step of steps) {
  const result = await bridge({
    systemId: "live-claude-smoke",
    agent: step.agent,
    inputSummary: step.inputSummary,
    args: [],
    outputPaths: [],
    cwd: process.cwd(),
    timeoutMs
  });
  const output = [result.stdout, result.stderr].map((entry) => entry.trim()).filter(Boolean).join("\n");
  console.log(`[${step.agent}] exit=${result.exitCode}`);
  if (output) {
    console.log(output);
  }
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
    throw new Error(`Live Claude ${step.agent} smoke failed`);
  }
}
console.log("Live Claude planner -> generator -> healer smoke passed.");

function parseArgs(raw: string | undefined) {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
      return parsed;
    }
  } catch {
    // Fall back to whitespace splitting for simple local shells.
  }
  return raw.split(/\s+/).filter(Boolean);
}
