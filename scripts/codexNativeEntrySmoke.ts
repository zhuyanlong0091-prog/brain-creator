import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createConfiguredAgentBridge } from "../src/agent/bridgeProvider.js";
import { buildDoctorReport, formatDoctorReport } from "../src/cli/doctor.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "../src/mcp/handlers.js";

const pluginManifest = JSON.parse(
  await readFile("plugins/brain-creator/.codex-plugin/plugin.json", "utf8")
);
const pluginMcp = JSON.parse(await readFile("plugins/brain-creator/.mcp.json", "utf8"));

assert(
  pluginManifest.interface.defaultPrompt.some((prompt: string) => prompt.includes("/bc help")),
  "Codex plugin starter prompts must expose /bc help"
);
assert(
  pluginMcp.mcpServers["brain-creator"].env.BRAIN_CREATOR_AGENT_PROVIDER === "host-agent",
  "Codex plugin MCP config must default to host-agent"
);

const doctor = buildDoctorReport({
  env: {
    BRAIN_CREATOR_WORKSPACE: ".",
    BRAIN_CREATOR_AGENT_PROVIDER: "host-agent",
    BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
  }
});
const doctorText = formatDoctorReport(doctor);
assert(doctor.ok, doctorText);
assert(doctor.agentBridge.provider === "host-agent", "Doctor did not resolve host-agent provider");
assert(doctorText.includes("bc_submit_agent_output"), "Doctor did not explain host-agent handoff");

const workDir = await mkdtemp(join(tmpdir(), "brain-codex-native-entry-"));
try {
  const context = createBrainCreatorMcpContext({
    dataFilePath: join(workDir, "assets.json"),
    workDir,
    agentBridge: createConfiguredAgentBridge({
      env: { BRAIN_CREATOR_AGENT_PROVIDER: "host-agent" }
    })
  });
  const help = dataOf(
    await handleBrainCreatorTool(context, "bc_command", {
      command: "/bc help"
    })
  );
  assert(help.action === "help", "/bc help should return help action");
  assert(help.helpMarkdown.includes("/bc run"), "/bc help should include run shortcut");
  assert(help.helpMarkdown.includes("--failure-type"), "/bc help should include review filters");
  assert(
    context.service.listSystemProfiles().length === 0,
    "/bc help must be read-only and must not create systems"
  );
  const status = dataOf(
    await handleBrainCreatorTool(context, "bc_command", {
      command: "/bc status"
    })
  );
  assert(
    status.result.status === "no_systems",
    "/bc status without a system should return connection guidance"
  );
  assert(
    context.service.listSystemProfiles().length === 0,
    "/bc status system selection must be read-only"
  );
} finally {
  await rm(workDir, { recursive: true, force: true });
}

await import("./hostAgentChainSmoke.js");

console.log("Codex-native entry smoke passed.");
console.log(
  "Validated plugin starter prompts, host-agent doctor guidance, /bc help, context-free /bc status, and host-agent chain handoff."
);

function dataOf(result: CallToolResult): any {
  if (result.isError) {
    throw new Error(textContent(result.content?.[0]) || "Brain Creator tool failed");
  }
  return JSON.parse(textContent(result.content[0]) || "{}").data;
}

function textContent(content: CallToolResult["content"][number] | undefined) {
  return content?.type === "text" ? content.text : "";
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
