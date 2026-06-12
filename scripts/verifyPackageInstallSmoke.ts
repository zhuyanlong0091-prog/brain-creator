import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  await run(
    join(binDir, "brain-creator-agent.cmd"),
    ["Use Brain Creator to connect https://shop.example.test"],
    businessDir
  );

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
    BRAIN_CREATOR_AGENT_COMMAND: "node",
    BRAIN_CREATOR_AGENT_ARGS: "[\"--print\"]",
    BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
  });

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
