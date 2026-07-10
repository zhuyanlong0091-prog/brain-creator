import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
const smokeRoot = await mkdtemp(join(tmpdir(), "brain-codex-plugin-install-"));
const keepArtifacts = process.env.BRAIN_CREATOR_KEEP_LIVE_ARTIFACTS === "1";

try {
  await verifyPluginInstallFromMarketplaceRoot("source checkout", repoRoot);

  const packageRoot = await installPackedPackage();
  await verifyPluginInstallFromMarketplaceRoot("packed npm install", packageRoot);

  console.log("Codex plugin install smoke passed.");
  console.log(`Source marketplace root: ${repoRoot}`);
  console.log(`Package marketplace root: ${packageRoot}`);
} finally {
  if (!keepArtifacts) {
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

async function installPackedPackage() {
  const packageDir = join(smokeRoot, "package");
  const businessDir = join(smokeRoot, "business-project");
  await mkdir(packageDir, { recursive: true });
  await mkdir(businessDir, { recursive: true });
  await run("npm", ["pack", "--pack-destination", packageDir], repoRoot);
  const tarballName = join(packageDir, await findTarball(packageDir));
  await writeFile(join(businessDir, "package.json"), "{\"type\":\"module\"}", "utf8");
  await run("npm", ["install", tarballName], businessDir);
  return join(businessDir, "node_modules", "brain-creator");
}

async function verifyPluginInstallFromMarketplaceRoot(label: string, marketplaceRoot: string) {
  const codexHome = join(smokeRoot, `codex-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);
  await mkdir(codexHome, { recursive: true });
  const env = { CODEX_HOME: codexHome };

  const marketplace = await run(
    "codex",
    ["plugin", "marketplace", "add", marketplaceRoot, "--json"],
    repoRoot,
    env
  );
  assert(
    marketplace.stdout.includes('"marketplaceName": "personal"'),
    `Codex did not register the ${label} marketplace:\n${marketplace.stdout}\n${marketplace.stderr}`
  );

  const install = await run(
    "codex",
    ["plugin", "add", "brain-creator@personal", "--json"],
    repoRoot,
    env
  );
  assert(
    install.stdout.includes('"name": "brain-creator"'),
    `Codex did not install the brain-creator plugin from ${label}:\n${install.stdout}\n${install.stderr}`
  );
  assert(
    install.stdout.includes(`"version": "${packageJson.version}"`),
    `Codex installed an unexpected plugin version from ${label}:\n${install.stdout}`
  );

  const list = await run("codex", ["plugin", "list"], repoRoot, env);
  assert(
    list.stdout.includes("brain-creator@personal") && list.stdout.includes("installed, enabled"),
    `Codex plugin list did not show brain-creator installed and enabled from ${label}:\n${list.stdout}\n${list.stderr}`
  );
  assert(
    list.stdout.includes("plugins\\brain-creator") || list.stdout.includes("plugins/brain-creator"),
    `Codex plugin list did not point at the Brain Creator plugin path from ${label}:\n${list.stdout}`
  );
}

async function findTarball(dir: string) {
  const tarball = (await readdir(dir)).find((file) => file.endsWith(".tgz"));
  assert(tarball, "npm pack did not create a package tarball");
  return tarball;
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
