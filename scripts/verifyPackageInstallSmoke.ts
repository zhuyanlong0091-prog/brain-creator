import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const rootDir = process.cwd();
const smokeRoot = await mkdtemp(join(tmpdir(), "brain-package-install-"));
const packageDir = join(smokeRoot, "package");
const businessDir = join(smokeRoot, "business-project");
const sourceDataFile = join(rootDir, ".brain-creator", "local-assets.json");
const sourceSnapshot = await readOptionalFile(sourceDataFile);
const keepArtifacts = process.env.BRAIN_CREATOR_KEEP_LIVE_ARTIFACTS === "1";

try {
  await mkdir(packageDir, { recursive: true });
  await mkdir(businessDir, { recursive: true });
  await run("npm", ["pack", "--pack-destination", packageDir], rootDir);
  const tarballName = join(packageDir, await findTarball(packageDir));
  assert(tarballName.endsWith(".tgz"), "npm pack did not create a package tarball");

  await writeFile(join(businessDir, "package.json"), "{\"type\":\"module\"}", "utf8");
  await run("npm", ["install", tarballName], businessDir);

  const binDir = join(businessDir, "node_modules", ".bin");
  await run(join(binDir, "brain-creator-install-assets.cmd"), [], businessDir);
  await run(join(binDir, "brain-creator-write-mcp-config.cmd"), [], businessDir);

  const skill = await readFile(
    join(businessDir, ".claude", "skills", "brain-creator", "SKILL.md"),
    "utf8"
  );
  assert(skill.includes("bc_run_chain"), "installed Brain Creator skill is missing workflow guidance");
  const mcpConfig = JSON.parse(await readFile(join(businessDir, ".mcp.json"), "utf8"));
  assert(
    mcpConfig.mcpServers?.["brain-creator"]?.command === "npx",
    "installed business project MCP config is missing Brain Creator"
  );
  assert(
    JSON.stringify(mcpConfig.mcpServers?.["brain-creator"]?.args) ===
      JSON.stringify(["brain-creator-mcp"]),
    "installed business project MCP config should use local npx Brain Creator"
  );

  await run(join(binDir, "brain-creator-doctor.cmd"), [], businessDir, {
    BRAIN_CREATOR_WORKSPACE: businessDir,
    BRAIN_CREATOR_AGENT_PROVIDER: "host-agent",
    BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
  });

  const client = new Client({ name: "brain-creator-package-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      join(
        businessDir,
        "node_modules",
        "brain-creator",
        "dist",
        "cli",
        "brainCreatorMcp.js"
      )
    ],
    cwd: businessDir,
    env: childEnv({
      BRAIN_CREATOR_WORKSPACE: businessDir,
      BRAIN_CREATOR_AGENT_PROVIDER: "host-agent",
      BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
    }),
    stderr: "pipe"
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    for (const name of [
      "bc_command",
      "bc_create_system",
      "bc_prepare_agent_task",
      "bc_submit_agent_output",
      "bc_list_agent_runs"
    ]) {
      assert(tools.tools.some((tool) => tool.name === name), `Installed MCP is missing ${name}`);
    }

    const help = dataOf(
      await client.callTool({
        name: "bc_command",
        arguments: { command: "/bc help" }
      })
    );
    assert(help.action === "help", "Installed MCP /bc help did not return help");
    const status = dataOf(
      await client.callTool({
        name: "bc_command",
        arguments: { command: "/bc status" }
      })
    );
    assert(
      status.result.status === "no_systems",
      "Installed MCP /bc status did not return system connection guidance"
    );

    const system = dataOf(
      await client.callTool({
        name: "bc_create_system",
        arguments: {
          name: "Installed Codex Host Agent",
          environment: "package-smoke",
          baseUrl: "https://installed-host-agent.example.test",
          defaultLocale: "en-US",
          urlAllowlist: ["https://installed-host-agent.example.test"]
        }
      })
    );
    const prepared = dataOf(
      await client.callTool({
        name: "bc_prepare_agent_task",
        arguments: {
          systemId: system.id,
          agent: "planner",
          inputSummary: "Verify the installed MCP can hand work to the current Codex agent.",
          args: [],
          outputPaths: []
        }
      })
    );
    assert(prepared.status === "needs_agent_execution", "Installed MCP did not prepare a host-agent task");
    assert(
      prepared.submitTool === "bc_submit_agent_output",
      "Installed MCP did not return the host-agent submit tool"
    );
    assert(
      (await readFile(prepared.promptPath, "utf8")).includes("bc_submit_agent_output"),
      "Installed MCP task prompt is missing submission guidance"
    );

    const submitted = dataOf(
      await client.callTool({
        name: "bc_submit_agent_output",
        arguments: {
          taskId: prepared.task.id,
          status: "succeeded",
          stdout: "installed host agent completed planner task",
          stderr: "",
          outputPaths: []
        }
      })
    );
    assert(submitted.agentRun.status === "succeeded", "Installed MCP did not record agent output");

    const agentRuns = dataOf(
      await client.callTool({
        name: "bc_list_agent_runs",
        arguments: { systemId: system.id }
      })
    );
    assert(
      agentRuns.some((run: { id: string }) => run.id === submitted.agentRun.id),
      "Installed MCP did not persist the submitted AgentRun"
    );
  } finally {
    await client.close();
  }

  assert(
    (await readOptionalFile(sourceDataFile)) === sourceSnapshot,
    "Source repository Brain Creator assets changed during package install smoke"
  );

  console.log("Package install smoke passed.");
  console.log(`Business project: ${businessDir}`);
  console.log(`Package: ${tarballName}`);
} finally {
  if (!keepArtifacts) {
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

async function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {}
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out: ${command} ${args.join(" ")}`));
    }, 120000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          [
            `Command failed: ${command} ${args.join(" ")}`,
            `cwd: ${cwd}`,
            `stdout:\n${stdout}`,
            `stderr:\n${stderr}`
          ].join("\n")
        )
      );
    });
  });
}

async function readOptionalFile(path: string) {
  return readFile(path, "utf8").catch(() => "");
}

async function findTarball(dir: string) {
  const tarball = (await readdir(dir)).find((file) => file.endsWith(".tgz"));
  assert(tarball, "npm pack did not create a package tarball");
  return tarball;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function childEnv(overrides: Record<string, string>) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
    ),
    ...overrides
  };
}

function dataOf(result: Awaited<ReturnType<Client["callTool"]>>): any {
  if (!("content" in result)) {
    throw new Error(`Installed MCP returned an unsupported task result: ${JSON.stringify(result)}`);
  }
  const parsed = CallToolResultSchema.parse(result);
  const content = parsed.content?.[0];
  if (parsed.isError || !content || content.type !== "text") {
    throw new Error(`Installed MCP call failed: ${JSON.stringify(result)}`);
  }
  const envelope = JSON.parse(content.text);
  if (!envelope.success) {
    throw new Error(`Installed MCP call failed: ${content.text}`);
  }
  return envelope.data;
}
