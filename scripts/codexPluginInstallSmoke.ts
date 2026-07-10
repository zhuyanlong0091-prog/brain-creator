import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const smokeRoot = await mkdtemp(join(tmpdir(), "brain-codex-plugin-install-"));
const keepArtifacts = process.env.BRAIN_CREATOR_KEEP_LIVE_ARTIFACTS === "1";

try {
  const env = { CODEX_HOME: smokeRoot };

  const marketplace = await run("codex", ["plugin", "marketplace", "add", ".", "--json"], repoRoot, env);
  assert(
    marketplace.stdout.includes('"marketplaceName": "personal"'),
    `Codex did not register the repo-local marketplace:\n${marketplace.stdout}\n${marketplace.stderr}`
  );

  const install = await run(
    "codex",
    ["plugin", "add", "brain-creator@personal", "--json"],
    repoRoot,
    env
  );
  assert(
    install.stdout.includes('"name": "brain-creator"'),
    `Codex did not install the brain-creator plugin:\n${install.stdout}\n${install.stderr}`
  );
  assert(
    install.stdout.includes('"version": "2.0.2"'),
    `Codex installed an unexpected plugin version:\n${install.stdout}`
  );

  const list = await run("codex", ["plugin", "list"], repoRoot, env);
  assert(
    list.stdout.includes("brain-creator@personal") && list.stdout.includes("installed, enabled"),
    `Codex plugin list did not show brain-creator installed and enabled:\n${list.stdout}\n${list.stderr}`
  );
  assert(
    list.stdout.includes("plugins\\brain-creator") || list.stdout.includes("plugins/brain-creator"),
    `Codex plugin list did not point at the repo-local plugin path:\n${list.stdout}`
  );

  console.log("Codex plugin install smoke passed.");
  console.log(`Marketplace root: ${repoRoot}`);
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
