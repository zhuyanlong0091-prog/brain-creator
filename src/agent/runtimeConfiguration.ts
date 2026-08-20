import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export type RuntimeBridgeProvider = "auto" | "claude" | "codex" | "host-agent" | "disabled";

export type RuntimeConfiguration = {
  schemaVersion: 1;
  bridgeProvider: RuntimeBridgeProvider;
  bridgeCommand?: string;
  bridgeArgs?: string[];
  bridgeTimeoutMs?: number;
  providerConfigs: Record<string, string>;
  connectorConfigs: Record<string, string>;
  updatedAt: string;
};

export type RuntimeConfigurationPatch = Partial<Omit<RuntimeConfiguration, "schemaVersion" | "updatedAt">>;

export function resolveRuntimeConfigurationPath(
  workDir: string,
  environment: Record<string, string | undefined> = process.env
) {
  if (environment.BRAIN_CREATOR_RUNTIME_CONFIG) return resolve(environment.BRAIN_CREATOR_RUNTIME_CONFIG);
  return join(resolve(workDir), ".brain-creator", "config", "runtime.json");
}

export function readRuntimeConfiguration(workDir: string): RuntimeConfiguration | undefined {
  const path = resolveRuntimeConfigurationPath(workDir);
  if (!existsSync(path)) return undefined;
  return validateRuntimeConfiguration(JSON.parse(readFileSync(path, "utf8")));
}

export function defaultRuntimeConfiguration(): RuntimeConfiguration {
  return {
    schemaVersion: 1,
    bridgeProvider: "auto",
    providerConfigs: {},
    connectorConfigs: {},
    updatedAt: new Date().toISOString()
  };
}

export function mergeRuntimeConfiguration(
  current: RuntimeConfiguration | undefined,
  patch: RuntimeConfigurationPatch
): RuntimeConfiguration {
  const base = current ?? defaultRuntimeConfiguration();
  return validateRuntimeConfiguration({
    ...base,
    ...patch,
    providerConfigs: { ...base.providerConfigs, ...(patch.providerConfigs ?? {}) },
    connectorConfigs: { ...base.connectorConfigs, ...(patch.connectorConfigs ?? {}) },
    updatedAt: new Date().toISOString()
  });
}

export function validateRuntimeConfiguration(value: unknown): RuntimeConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Runtime configuration must be an object");
  }
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) throw new Error("Runtime configuration schemaVersion must be 1");
  const providers: RuntimeBridgeProvider[] = ["auto", "claude", "codex", "host-agent", "disabled"];
  if (!providers.includes(input.bridgeProvider as RuntimeBridgeProvider)) {
    throw new Error("Runtime configuration bridgeProvider is invalid");
  }
  if (input.bridgeCommand !== undefined && !validText(input.bridgeCommand, 512)) {
    throw new Error("Runtime configuration bridgeCommand is invalid");
  }
  if (input.bridgeArgs !== undefined && (
    !Array.isArray(input.bridgeArgs) ||
    input.bridgeArgs.length > 32 ||
    input.bridgeArgs.some((item) => !validText(item, 512))
  )) {
    throw new Error("Runtime configuration bridgeArgs are invalid");
  }
  if (input.bridgeTimeoutMs !== undefined && (
    typeof input.bridgeTimeoutMs !== "number" ||
    !Number.isInteger(input.bridgeTimeoutMs) ||
    input.bridgeTimeoutMs < 1_000 ||
    input.bridgeTimeoutMs > 600_000
  )) {
    throw new Error("Runtime configuration bridgeTimeoutMs must be between 1000 and 600000");
  }
  const providerConfigs = referenceMap(input.providerConfigs, "providerConfigs");
  const connectorConfigs = referenceMap(input.connectorConfigs, "connectorConfigs");
  return {
    schemaVersion: 1,
    bridgeProvider: input.bridgeProvider as RuntimeBridgeProvider,
    ...(typeof input.bridgeCommand === "string" ? { bridgeCommand: input.bridgeCommand } : {}),
    ...(Array.isArray(input.bridgeArgs) ? { bridgeArgs: [...input.bridgeArgs] as string[] } : {}),
    ...(typeof input.bridgeTimeoutMs === "number" ? { bridgeTimeoutMs: input.bridgeTimeoutMs } : {}),
    providerConfigs,
    connectorConfigs,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString()
  };
}

export function writeRuntimeConfiguration(workDir: string, configuration: RuntimeConfiguration) {
  const path = resolveRuntimeConfigurationPath(workDir);
  const validated = validateRuntimeConfiguration(configuration);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
  return path;
}

export function runtimeEnvironment(
  configuration: RuntimeConfiguration | undefined,
  baseEnvironment: Record<string, string | undefined>
) {
  if (!configuration) return { ...baseEnvironment };
  const environment = { ...baseEnvironment };
  setIfAbsent(environment, "BRAIN_CREATOR_AGENT_PROVIDER", configuration.bridgeProvider);
  if (configuration.bridgeCommand) {
    const commandKey = configuration.bridgeProvider === "codex"
      ? "BRAIN_CREATOR_CODEX_COMMAND"
      : configuration.bridgeProvider === "claude"
        ? "BRAIN_CREATOR_CLAUDE_COMMAND"
        : "BRAIN_CREATOR_AGENT_COMMAND";
    setIfAbsent(environment, commandKey, configuration.bridgeCommand);
  }
  if (configuration.bridgeArgs) {
    const argsKey = configuration.bridgeProvider === "codex"
      ? "BRAIN_CREATOR_CODEX_ARGS"
      : configuration.bridgeProvider === "claude"
        ? "BRAIN_CREATOR_CLAUDE_ARGS"
        : "BRAIN_CREATOR_AGENT_ARGS";
    setIfAbsent(environment, argsKey, JSON.stringify(configuration.bridgeArgs));
  }
  if (configuration.bridgeTimeoutMs !== undefined) {
    setIfAbsent(environment, "BRAIN_CREATOR_AGENT_TIMEOUT_MS", String(configuration.bridgeTimeoutMs));
  }
  for (const [key, reference] of Object.entries(configuration.connectorConfigs)) {
    const value = resolveReference(reference, baseEnvironment);
    if (value === undefined) continue;
    if (key === "feishuAppId") setIfAbsent(environment, "BRAIN_CREATOR_FEISHU_APP_ID", value);
    if (key === "feishuAppSecret") setIfAbsent(environment, "BRAIN_CREATOR_FEISHU_APP_SECRET", value);
  }
  return environment;
}

function referenceMap(value: unknown, name: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Runtime configuration ${name} must be an object`);
  }
  const result: Record<string, string> = {};
  for (const [key, reference] of Object.entries(value)) {
    if (!validText(key, 128) || !validReference(reference)) {
      throw new Error(`Runtime configuration ${name} must contain only env:/file: references`);
    }
    result[key] = reference;
  }
  return result;
}

function validReference(value: unknown): value is string {
  return typeof value === "string" && /^(env|file):[^\r\n]+$/.test(value);
}

function validText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !/[\r\n]/.test(value);
}

function setIfAbsent(environment: Record<string, string | undefined>, key: string, value: string) {
  if (environment[key] === undefined) environment[key] = value;
}

function resolveReference(reference: string, environment: Record<string, string | undefined>) {
  const [kind, ...rest] = reference.split(":");
  const target = rest.join(":");
  if (kind === "env") return environment[target];
  if (kind === "file") {
    try {
      return readFileSync(resolve(target), "utf8").trim();
    } catch {
      return undefined;
    }
  }
  return undefined;
}
