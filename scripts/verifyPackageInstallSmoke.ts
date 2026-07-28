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
  const codexPluginHelp = await run(
    join(binDir, "brain-creator-install-codex-plugin.cmd"),
    ["--help"],
    businessDir
  );
  assert(
    codexPluginHelp.stdout.includes("brain-creator-install-codex-plugin") &&
      codexPluginHelp.stdout.includes("--package-root"),
    "installed Codex plugin installer help is missing expected usage text"
  );

  const skill = await readFile(
    join(businessDir, ".claude", "skills", "brain-creator", "SKILL.md"),
    "utf8"
  );
  assert(skill.includes("bc_run_chain"), "installed Brain Creator skill is missing workflow guidance");
  assert(
    (await readFile(join(businessDir, "playwright.config.ts"), "utf8")).includes(
      "PLAYWRIGHT_CHROMIUM_EXECUTABLE"
    ),
    "installed business project is missing the portable Playwright config"
  );
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
  assert(
    mcpConfig.mcpServers?.["brain-creator"]?.env?.BRAIN_CREATOR_TOOL_PROFILE === "facade",
    "installed business project MCP config should default to the facade tool profile"
  );

  await run(join(binDir, "brain-creator-doctor.cmd"), [], businessDir, {
    BRAIN_CREATOR_WORKSPACE: businessDir,
    BRAIN_CREATOR_TOOL_PROFILE: "facade",
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
      BRAIN_CREATOR_TOOL_PROFILE: "facade",
      BRAIN_CREATOR_AGENT_PROVIDER: "host-agent",
      BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
    }),
    stderr: "pipe"
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const facadeTools = [
      "bc_prepare",
      "bc_command",
      "bc_intent_preview",
      "bc_status",
      "bc_run",
      "bc_review",
      "bc_configure",
      "bc_submit_agent_output"
    ];
    for (const name of facadeTools) {
      assert(tools.tools.some((tool) => tool.name === name), `Installed MCP is missing ${name}`);
    }
    assert(tools.tools.length === facadeTools.length, "Installed MCP exposed tools outside the facade profile");
    for (const name of ["bc_intent_preview", "bc_status", "bc_review"]) {
      assert(
        tools.tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint === true,
        `Installed MCP must mark ${name} read-only`
      );
    }
    assert(
      tools.tools.find((tool) => tool.name === "bc_run")?.annotations?.readOnlyHint !== true,
      "Installed MCP must not mark bc_run read-only"
    );

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

    const knowledgeProject = dataOf(
      await client.callTool({
        name: "bc_configure",
        arguments: {
          target: "knowledge-project",
          name: "Installed Requirement",
          key: "installed-requirement",
          defaultLocale: "en-US"
        }
      })
    );
    const requirementPath = join(businessDir, "requirement.md");
    await writeFile(
      requirementPath,
      "# Installed Requirement\n\nUsers create requests and managers approve them.",
      "utf8"
    );
    const prepared = dataOf(
      await client.callTool({
        name: "bc_prepare",
        arguments: {
          action: "ingest-requirement",
          knowledgeProjectId: knowledgeProject.id,
          source: requirementPath
        }
      })
    );
    assert(prepared.status === "draft-created", "Installed MCP did not ingest a requirement source");
    assert(
      prepared.requirementSet.status === "draft",
      "Installed MCP did not persist a draft requirement baseline"
    );
    const knowledgeStatus = dataOf(
      await client.callTool({
        name: "bc_status",
        arguments: {
          knowledgeProjectId: knowledgeProject.id
        }
      })
    );
    assert(
      knowledgeStatus.knowledge.requirementSets.total === 1,
      "Installed MCP knowledge status did not restore the requirement baseline"
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
    await removeSmokeRoot(smokeRoot);
  }
}

async function removeSmokeRoot(path: string) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(code) || attempt === 10) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 250));
    }
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
