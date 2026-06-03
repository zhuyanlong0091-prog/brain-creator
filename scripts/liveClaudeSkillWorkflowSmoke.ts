import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const timeoutMs = Number(process.env.BRAIN_CREATOR_AGENT_TIMEOUT_MS ?? 600000);
const rootDir = process.cwd();
const dataDir = await mkdtemp(join(rootDir, ".brain-creator-test", "live-claude-skill-"));
const fixture = await startFixtureServer();
const seenTools = new Set<string>();
const beforeArtifacts = await liveArtifactSnapshot();
let resultText = "";

try {
  await mkdir(dataDir, { recursive: true });
  const prompt = [
    'Your first assistant action must be calling Skill("brain-creator").',
    "After the skill is loaded, run this exact Brain Creator MCP workflow without open-ended exploration:",
    `1. Create system name=Claude Skill Workflow Smoke environment=local-smoke baseUrl=${fixture.url} defaultLocale=en-US urlAllowlist=[${fixture.url}].`,
    "2. Create script auth for that system with secrets {note: 'no real secret'} and verify it.",
    "3. Add one block business rule: Generated tests must assert Order total: 42.",
    "4. Generate a test plan using exactly this one scenario format:",
    "## Scenario: Claude Skill workflow order total",
    "Priority: critical",
    `- navigate: ${fixture.url}`,
    "- assert: Brain Creator Skill Workflow => visible",
    "- assert: Order total: 42 => visible",
    "5. I approve this exact scenario; call approve, then run the chain with maxHealAttempts=0.",
    "6. Show artifact overview. Do not browse beyond the local fixture URL.",
    "Keep the final response concise."
  ].join("\n");

  const output = await runClaude(prompt);
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    collectToolCalls(line);
  }
  assertSeen("Skill");
  assertSeen("mcp__brain-creator__bc_create_system");
  assertSeen("mcp__brain-creator__bc_create_auth");
  assertSeen("mcp__brain-creator__bc_add_rule");
  assertSeen("mcp__brain-creator__bc_generate_plan");
  assertSeen("mcp__brain-creator__bc_approve_plan");
  assertSeen("mcp__brain-creator__bc_run_chain");
  assertSeen("mcp__brain-creator__bc_artifact_overview");
  assertIncludes(resultText, "succeeded", "successful chain status");
  console.log("Live Claude Code Skill workflow smoke passed.");
  console.log([...seenTools].filter((tool) => tool.includes("brain-creator") || tool === "Skill").join("\n"));
} finally {
  await stopFixtureServer(fixture.server);
  await rm(dataDir, { recursive: true, force: true });
  await cleanupNewLiveArtifacts(beforeArtifacts);
}

function runClaude(prompt: string) {
  const env = {
    ...process.env,
    BRAIN_CREATOR_AGENT_COMMAND: process.env.BRAIN_CREATOR_AGENT_COMMAND ?? "claude",
    BRAIN_CREATOR_AGENT_ARGS:
      process.env.BRAIN_CREATOR_AGENT_ARGS ?? '["--print","--permission-mode","acceptEdits"]',
    BRAIN_CREATOR_AGENT_TIMEOUT_MS: String(timeoutMs)
  };
  const args = [
    "--print",
    "--verbose",
    "--output-format",
    "stream-json",
    "--permission-mode",
    "acceptEdits",
    "--mcp-config",
    ".mcp.json",
    "--allowedTools",
    [
      "Skill",
      "mcp__brain-creator__bc_list_systems",
      "mcp__brain-creator__bc_create_system",
      "mcp__brain-creator__bc_create_auth",
      "mcp__brain-creator__bc_verify_auth",
      "mcp__brain-creator__bc_generate_seed",
      "mcp__brain-creator__bc_add_rule",
      "mcp__brain-creator__bc_generate_plan",
      "mcp__brain-creator__bc_update_plan",
      "mcp__brain-creator__bc_approve_plan",
      "mcp__brain-creator__bc_run_chain",
      "mcp__brain-creator__bc_artifact_overview",
      "mcp__brain-creator__bc_list_gaps"
    ].join(",")
  ];
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.env.BRAIN_CREATOR_CLAUDE_COMMAND ?? "claude", args, {
      cwd: rootDir,
      env,
      shell: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          [
            `Claude Code skill workflow timed out after ${timeoutMs}ms`,
            "Seen tools:",
            [...seenTools].join(", ") || "(none)",
            "stdout tail:",
            stdout.slice(-4000),
            "stderr tail:",
            stderr.slice(-2000)
          ].join("\n")
        )
      );
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        collectToolCalls(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (exitCode !== 0) {
        reject(new Error(`Claude Code skill workflow failed with exit ${exitCode}\n${stdout}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(prompt);
  });
}

function collectToolCalls(line: string) {
  try {
    const event = JSON.parse(line);
    if (event?.type === "assistant") {
      for (const content of event.message?.content ?? []) {
        if (content.type === "tool_use") {
          seenTools.add(content.name);
        }
      }
    }
    if (event?.type === "result") {
      resultText = event.result ?? "";
    }
  } catch {
    // Ignore non-json hook output lines.
  }
}

function startFixtureServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><h1>Brain Creator Skill Workflow</h1><p>Order total: 42</p>");
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Fixture server did not expose a TCP port"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function stopFixtureServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function assertSeen(tool: string) {
  if (!seenTools.has(tool)) {
    throw new Error(`Expected Claude Code to call ${tool}; saw ${[...seenTools].join(", ")}`);
  }
}

function assertIncludes(content: string, expected: string, label: string) {
  if (!content.includes(expected)) {
    throw new Error(`Missing ${label}: ${expected}\n${content}`);
  }
}

async function liveArtifactSnapshot() {
  const files = new Set<string>();
  for (const file of await listMatching(join(rootDir, "tests"), /^seed-system_.*\.spec\.ts$/)) {
    files.add(file);
  }
  for (const file of await listMatching(join(rootDir, "tests", "generated"), /^case_.*\.spec\.ts$/)) {
    files.add(file);
  }
  for (const file of await listMatching(join(rootDir, "specs"), /^case_.*\.md$/)) {
    files.add(file);
  }
  for (const file of await listMatching(join(rootDir, "specs", "_context"), /^system_.*-prompt\.md$/)) {
    files.add(file);
  }
  return files;
}

async function cleanupNewLiveArtifacts(before: Set<string>) {
  const after = await liveArtifactSnapshot();
  await Promise.all(
    [...after]
      .filter((file) => !before.has(file))
      .map((file) => rm(file, { force: true, recursive: true }))
  );
}

async function listMatching(directory: string, pattern: RegExp) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && pattern.test(entry.name))
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
}
