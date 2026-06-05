import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

export type PackageJsonLike = {
  name?: string;
  version?: string;
  private?: boolean;
  license?: string;
  bin?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
};

export type ReleaseCheck = {
  name: string;
  status: "pass" | "blocker";
  message: string;
  remediation?: string;
};

export type ReleaseReadinessReport = {
  ready: boolean;
  checks: ReleaseCheck[];
};

export type ReleaseReadinessInput = {
  packageJson: PackageJsonLike;
  npmAuth: "authenticated" | "missing" | "unknown";
  packageNameStatus: "available" | "taken" | "unknown";
};

const requiredBins = [
  "brain-creator-mcp",
  "brain-creator-doctor",
  "brain-creator-install-assets",
  "brain-creator-write-mcp-config"
];

const requiredFiles = [
  "dist/",
  "skills/",
  ".claude/agents/",
  "plugin/",
  "README.md"
];

export function buildReleaseReadinessReport(
  input: ReleaseReadinessInput
): ReleaseReadinessReport {
  const checks = [
    privateFlagCheck(input.packageJson),
    licenseCheck(input.packageJson),
    packageNameCheck(input.packageNameStatus),
    npmAuthCheck(input.npmAuth),
    binCheck(input.packageJson),
    filesCheck(input.packageJson),
    scriptCheck(input.packageJson, "verify:package-contents"),
    scriptCheck(input.packageJson, "verify:package-install")
  ];

  return {
    ready: checks.every((check) => check.status === "pass"),
    checks
  };
}

export function formatReleaseReadinessReport(report: ReleaseReadinessReport) {
  return [
    `Release readiness: ${report.ready ? "ready" : "blocked"}`,
    "",
    ...report.checks.flatMap((check) => [
      `${check.status.toUpperCase()} ${check.name}: ${check.message}`,
      ...(check.remediation ? [`  Fix: ${check.remediation}`] : [])
    ])
  ].join("\n");
}

async function main() {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as PackageJsonLike;
  const [npmAuth, packageNameStatus] = await Promise.all([
    detectNpmAuth(),
    detectPackageNameStatus(packageJson.name)
  ]);
  const report = buildReleaseReadinessReport({
    packageJson,
    npmAuth,
    packageNameStatus
  });

  console.log(formatReleaseReadinessReport(report));
  if (process.argv.includes("--strict") && !report.ready) {
    process.exit(1);
  }
}

function privateFlagCheck(packageJson: PackageJsonLike): ReleaseCheck {
  if (packageJson.private === true) {
    return {
      name: "private flag",
      status: "blocker",
      message: "package.json is still private and cannot be published.",
      remediation: "Remove private:true only after the package name, license, and publish account are approved."
    };
  }
  return {
    name: "private flag",
    status: "pass",
    message: "package.json is publishable from the private flag perspective."
  };
}

function licenseCheck(packageJson: PackageJsonLike): ReleaseCheck {
  if (!packageJson.license) {
    return {
      name: "license",
      status: "blocker",
      message: "package.json has no license.",
      remediation: "Choose and document a license before publishing."
    };
  }
  return {
    name: "license",
    status: "pass",
    message: `license is ${packageJson.license}.`
  };
}

function packageNameCheck(status: ReleaseReadinessInput["packageNameStatus"]): ReleaseCheck {
  if (status === "taken") {
    return {
      name: "package name",
      status: "blocker",
      message: "configured package name is already taken on npm.",
      remediation: "Choose a new package name or a scoped package name."
    };
  }
  if (status === "unknown") {
    return {
      name: "package name",
      status: "blocker",
      message: "package name availability could not be confirmed.",
      remediation: "Run npm view <package-name> before publishing."
    };
  }
  return {
    name: "package name",
    status: "pass",
    message: "package name appears available."
  };
}

function npmAuthCheck(status: ReleaseReadinessInput["npmAuth"]): ReleaseCheck {
  if (status !== "authenticated") {
    return {
      name: "npm authentication",
      status: "blocker",
      message: "npm authentication is not ready.",
      remediation: "Run npm adduser or npm login with the publishing account."
    };
  }
  return {
    name: "npm authentication",
    status: "pass",
    message: "npm is authenticated; publish may still require --otp when 2FA is enabled."
  };
}

function binCheck(packageJson: PackageJsonLike): ReleaseCheck {
  const missing = requiredBins.filter((bin) => !packageJson.bin?.[bin]);
  if (missing.length > 0) {
    return {
      name: "bin entries",
      status: "blocker",
      message: `missing bin entries: ${missing.join(", ")}.`,
      remediation: "Add all Brain Creator CLI entries before publishing."
    };
  }
  return {
    name: "bin entries",
    status: "pass",
    message: "all Brain Creator CLI entries are present."
  };
}

function filesCheck(packageJson: PackageJsonLike): ReleaseCheck {
  const missing = requiredFiles.filter((file) => !packageJson.files?.includes(file));
  if (missing.length > 0) {
    return {
      name: "package files",
      status: "blocker",
      message: `missing package file entries: ${missing.join(", ")}.`,
      remediation: "Add required runtime files to package.json files."
    };
  }
  return {
    name: "package files",
    status: "pass",
    message: "package file allowlist includes runtime assets."
  };
}

function scriptCheck(packageJson: PackageJsonLike, scriptName: string): ReleaseCheck {
  if (!packageJson.scripts?.[scriptName]) {
    return {
      name: scriptName,
      status: "blocker",
      message: `${scriptName} is missing.`,
      remediation: `Add ${scriptName} before publishing.`
    };
  }
  return {
    name: scriptName,
    status: "pass",
    message: `${scriptName} is configured.`
  };
}

async function detectNpmAuth(): Promise<ReleaseReadinessInput["npmAuth"]> {
  const result = await run("npm", ["whoami"]);
  return result.exitCode === 0 ? "authenticated" : "missing";
}

async function detectPackageNameStatus(
  packageName: string | undefined
): Promise<ReleaseReadinessInput["packageNameStatus"]> {
  if (!packageName) {
    return "unknown";
  }
  const result = await run("npm", ["view", packageName, "name", "--json"]);
  if (result.exitCode === 0) {
    return "taken";
  }
  if (result.stderr.includes("E404") || result.stdout.includes("E404")) {
    return "available";
  }
  return "unknown";
}

function run(command: string, args: string[]) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
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
    child.on("error", (error) => {
      resolve({ exitCode: 1, stdout, stderr: String(error) });
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

if (process.argv[1]?.endsWith("releaseReadiness.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
