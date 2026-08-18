import type { AuthProfile, SystemProfile } from "../domain/types.js";

export type AuthRefreshProvider = "token" | "cookie" | "oauth" | "cas" | "saml" | "host-agent";

export type AuthRefreshInput = {
  workDir: string;
  system: SystemProfile;
  authProfile: AuthProfile;
  reason: string;
  timeoutMs?: number;
};

export type AuthRefreshAttempt = {
  provider: AuthRefreshProvider | string;
  status: "succeeded" | "failed" | "needs-user";
  storageStatePath?: string;
  reason?: string;
  evidenceRefs?: string[];
  expiresAt?: string;
};

export type AuthRefreshResult = Partial<Pick<AuthRefreshAttempt, "provider" | "status" | "expiresAt" | "evidenceRefs" | "reason">> & {
  storageStatePath?: string;
};

export interface AuthRefreshAdapter {
  provider: AuthRefreshProvider;
  supports(input: AuthRefreshInput): boolean;
  refresh(input: AuthRefreshInput): Promise<AuthRefreshResult>;
}

/**
 * Host-provided refresh hook for short-lived sessions.
 * The hook returns a protected storageState path, never raw credentials.
 */
export type AuthStateRefresher = (input: {
  workDir: string;
  system: SystemProfile;
  authProfile: AuthProfile;
  reason: string;
}) => Promise<{
  storageStatePath: string;
  provider?: string;
}>;

/**
 * Host/plugin supplied implementation for one explicitly configured provider.
 * The implementation must return a protected storageState path and must not
 * return raw credentials in the result.
 */
export type AuthRefreshProviderHandler = (
  input: AuthRefreshInput
) => Promise<AuthRefreshResult>;

export type AuthRefreshAdapterOptions = {
  provider: AuthRefreshProvider;
  handler: AuthRefreshProviderHandler;
  supports?: (input: AuthRefreshInput) => boolean;
};

export class AuthStateRefreshRegistry {
  private readonly adapters: AuthRefreshAdapter[];

  constructor(adapters: AuthRefreshAdapter[] = []) {
    this.adapters = [...adapters];
  }

  register(adapter: AuthRefreshAdapter) {
    if (this.adapters.some((candidate) => candidate.provider === adapter.provider)) {
      throw new Error(`Authentication refresh provider is already registered: ${adapter.provider}`);
    }
    this.adapters.push(adapter);
    return this;
  }

  async refresh(input: AuthRefreshInput): Promise<AuthRefreshAttempt> {
    const explicitProvider = explicitProviderHint(input.authProfile);
    const candidates = explicitProvider
      ? this.adapters.filter((candidate) => candidate.provider === explicitProvider)
      : this.adapters;
    const adapter = candidates.find((candidate) => candidate.supports(input));
    if (!adapter) {
      return {
        provider: explicitProvider ?? providerHint(input.authProfile),
        status: "needs-user",
        reason: explicitProvider
          ? `No registered authentication refresh provider can refresh this profile: ${explicitProvider}.`
          : "No registered authentication refresh provider can refresh this profile."
      };
    }
    const timeoutMs = Math.max(100, Math.min(120_000, input.timeoutMs ?? 30_000));
    try {
      const result = await withTimeout(adapter.refresh(input), timeoutMs);
      const status = result.status ??
        (result.storageStatePath ? "succeeded" : "failed");
      if (status === "succeeded" && !result.storageStatePath) {
        return {
          provider: adapter.provider,
          status: "failed",
          reason: "The refresh provider did not return a protected storageState path."
        };
      }
      return {
        ...result,
        status,
        provider: result.provider ?? adapter.provider,
        ...(result.reason ? { reason: redactAuthText(result.reason, input.authProfile) } : {})
      };
    } catch (error) {
      return {
        provider: adapter.provider,
        status: "failed",
        reason: redactAuthText(
          error instanceof Error ? error.message : String(error),
          input.authProfile
        ) || "Authentication refresh failed."
      };
    }
  }
}

export function createDefaultAuthRefreshRegistry(
  hostRefresher?: AuthStateRefresher,
  providerAdapters: AuthRefreshAdapter[] = []
) {
  const registry = new AuthStateRefreshRegistry();
  const registeredProviders = new Set<AuthRefreshProvider>();
  if (hostRefresher) {
    registry.register({
      provider: "host-agent",
      supports: () => true,
      refresh: async (input) => {
        const refreshed = await hostRefresher({
          workDir: input.workDir,
          system: input.system,
          authProfile: input.authProfile,
          reason: input.reason
        });
        return {
          provider: refreshed.provider ?? "host-agent",
          status: "succeeded",
          storageStatePath: refreshed.storageStatePath
        };
      }
    });
    registeredProviders.add("host-agent");
  }
  for (const adapter of providerAdapters) {
    if (registeredProviders.has(adapter.provider)) continue;
    registry.register(adapter);
    registeredProviders.add(adapter.provider);
  }
  return registry;
}

/**
 * Build the default registry from host/plugin callbacks. This keeps provider
 * credentials and refresh protocols outside Brain Creator while making the
 * provider choice explicit and testable.
 */
export function createConfiguredAuthRefreshRegistry(input: {
  hostRefresher?: AuthStateRefresher;
  providers?: AuthRefreshAdapterOptions[];
} = {}) {
  const adapters = (input.providers ?? []).map((provider) => ({
    provider: provider.provider,
    supports: provider.supports ?? (() => true),
    refresh: provider.handler
  } satisfies AuthRefreshAdapter));
  return createDefaultAuthRefreshRegistry(input.hostRefresher, adapters);
}

function explicitProviderHint(profile: AuthProfile): AuthRefreshProvider | undefined {
  return (profile as AuthProfile & { refreshProvider?: AuthRefreshProvider }).refreshProvider;
}

function providerHint(profile: AuthProfile): AuthRefreshProvider {
  const explicit = explicitProviderHint(profile);
  if (explicit) return explicit;
  if (profile.loginMethod === "token") return "token";
  if (profile.loginMethod === "cookie") return "cookie";
  return "host-agent";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Authentication refresh timed out after ${timeoutMs}ms.`)),
      timeoutMs
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function redactAuthText(value: string, profile: AuthProfile) {
  let redacted = value;
  for (const secret of Object.values(profile.encryptedSecrets)) {
    if (secret) redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted
    .replace(/(bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/(token|cookie|password)=([^\s;&]+)/gi, "$1=[redacted]");
}
