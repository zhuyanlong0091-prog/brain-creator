import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const forbiddenPaths = [
  /^(?:output|outputs|artifacts)\//i,
  /(^|\/)\.brain-creator\//i,
  /(^|\/)storage-state\.json$/i,
  /\.trace\.zip$/i,
  /(^|\/)tests\/generated\/(?:probe|setup)-.+\.spec\.ts$/i
];

const forbiddenContent = [
  /https?:\/\/test\d+-ghr\.eminxing\.com/i,
  /internal-api-drive-stream[^\r\n"']*authcode=/i
];

const pathViolations = trackedFiles.filter((file) => forbiddenPaths.some((pattern) => pattern.test(file)));
const contentViolations: string[] = [];

for (const file of trackedFiles) {
  if (!existsSync(file) || !statSync(file).isFile()) continue;
  const content = readFileSync(file, "utf8");
  if (forbiddenContent.some((pattern) => pattern.test(content))) {
    contentViolations.push(file);
  }
}

if (pathViolations.length || contentViolations.length) {
  console.error("Repository hygiene check failed.");
  if (pathViolations.length) {
    console.error("Forbidden tracked runtime artifacts:");
    for (const file of pathViolations) console.error(`- ${file}`);
  }
  if (contentViolations.length) {
    console.error("Potential real-system or credential content:");
    for (const file of contentViolations) console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log(`Repository hygiene check passed for ${trackedFiles.length} tracked files.`);
