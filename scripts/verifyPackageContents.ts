import { spawn } from "node:child_process";

const requiredPaths = [
  "dist/cli/brainCreatorMcp.js",
  "dist/cli/doctor.js",
  "dist/cli/installAssets.js",
  "dist/cli/writeMcpConfig.js",
  "skills/brain-creator/SKILL.md",
  ".claude/agents/playwright-test-planner.md",
  ".claude/agents/playwright-test-generator.md",
  ".claude/agents/playwright-test-healer.md",
  "docs/mcp-installation.md",
  "plugin/manifest.json",
  "README.md",
  "package.json"
];

const forbiddenPrefixes = [
  ".brain-creator/",
  ".brain-creator-test/",
  ".obsidian/",
  ".playwright-mcp/",
  ".gstack/",
  "test-results/",
  "node_modules/",
  "src/",
  "scripts/"
];

const result = await run("npm", ["pack", "--dry-run", "--json"]);
const pack = parsePackJson(result.stdout);
const paths = pack.files.map((file) => file.path);

for (const requiredPath of requiredPaths) {
  assert(paths.includes(requiredPath), `Package is missing ${requiredPath}`);
}

const forbidden = paths.filter((path) =>
  forbiddenPrefixes.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix))
);
assert(forbidden.length === 0, `Package includes forbidden paths: ${forbidden.join(", ")}`);

console.log("Package contents verification passed.");
console.log(`Entries: ${paths.length}`);
console.log(`Size: ${pack.size} bytes`);

type PackFile = {
  path: string;
};

type PackJson = {
  files: PackFile[];
  size: number;
};

function parsePackJson(stdout: string): PackJson {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  assert(start >= 0 && end > start, "npm pack did not return JSON output");
  const parsed = JSON.parse(stdout.slice(start, end + 1));
  assert(Array.isArray(parsed) && parsed.length === 1, "npm pack returned unexpected JSON");
  return parsed[0] as PackJson;
}

function run(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          [
            `Command failed: ${command} ${args.join(" ")}`,
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
