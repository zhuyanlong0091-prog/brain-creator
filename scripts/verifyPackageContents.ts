import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const requiredPaths = [
  "dist/cli/brainCreator.js",
  "dist/cli/brainCreatorMcp.js",
  "dist/cli/doctor.js",
  "dist/cli/installAssets.js",
  "dist/cli/installCodexPlugin.js",
  "dist/cli/writeMcpConfig.js",
  "skills/brain-creator/SKILL.md",
  ".claude/agents/playwright-test-planner.md",
  ".claude/agents/playwright-test-generator.md",
  ".claude/agents/playwright-test-healer.md",
  "docs/README.md",
  "docs/getting-started.md",
  "docs/core-concepts.md",
  "docs/guides/requirement-to-test.md",
  "docs/cli-reference.md",
  "docs/mcp-installation.md",
  "docs/troubleshooting.md",
  "docs/zh-CN/index.md",
  "docs/zh-CN/getting-started.md",
  "docs/zh-CN/core-concepts.md",
  "docs/zh-CN/guides/requirement-to-test.md",
  "docs/zh-CN/agent-usage.md",
  "docs/zh-CN/e2e-session-resume-workflow.md",
  "docs/zh-CN/cli-reference.md",
  "docs/zh-CN/mcp-installation.md",
  "docs/zh-CN/troubleshooting.md",
  "docs/zh-CN/release-checklist.md",
  "docs/release-notes-2.1.1.md",
  "docs/release-candidate-2.2.0.md",
  "docs/zh-CN/release-candidate-2.2.0.md",
  "docs/llms.txt",
  "docs/public/brain-creator-mark.png",
  "LICENSE",
  "plugin/manifest.json",
  "plugins/brain-creator/.codex-plugin/plugin.json",
  "plugins/brain-creator/.mcp.json",
  "plugins/brain-creator/skills/brain-creator/SKILL.md",
  ".agents/plugins/marketplace.json",
  "playwright.config.ts",
  "README.md",
  "package.json"
];

const forbiddenPrefixes = [
  ".brain-creator/",
  ".brain-creator-test/",
  ".obsidian/",
  ".playwright-mcp/",
  ".playwright-cli/",
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

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
assert(
  packageJson.bin?.["brain-creator"] === "dist/cli/brainCreator.js",
  "Package does not expose the brain-creator CLI"
);
const pluginJson = JSON.parse(
  await readFile("plugins/brain-creator/.codex-plugin/plugin.json", "utf8")
);
assert(
  pluginJson.license === packageJson.license,
  `Codex plugin license ${pluginJson.license} does not match package license ${packageJson.license}`
);

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
