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

export interface AuthRefreshAdapter {
  provider: AuthRefreshProvider;
  supports(input: AuthRefreshInput): boolean;
  refresh(input: AuthRefreshInput): Promise<AuthRefreshAttempt>;
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

export class AuthStateRefreshRegistry {
  private readonly adapters: AuthRefreshAdapter[];

  constructor(adapters: AuthRefreshAdapter[] = []) {
    this.adapters = [...adapters];
  }

  register(adapter: AuthRefreshAdapter) {
    this.adapters.push(adapter);
    return this;
  }

  async refresh(input: AuthRefreshInput): Promise<AuthRefreshAttempt> {
    const adapter = this.adapters.find((candidate) => candidate.supports(input));
    if (!adapter) {
      return {
        provider: providerHint(input.authProfile),
        status: "needs-user",
        reason: "No registered authentication refresh provider can refresh this profile."
      };
    }
    const timeoutMs = Math.max(100, Math.min(120_000, input.timeoutMs ?? 30_000));
    try {
      const result = await withTimeout(adapter.refresh(input), timeoutMs);
      if (result.status === "succeeded" && !result.storageStatePath) {
        return {
          provider: adapter.provider,
          status: "failed",
          reason: "The refresh provider did not return a protected storageState path."
        };
      }
      return {
        ...result,
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
  hostRefresher?: AuthStateRefresher
) {
  const registry = new AuthStateRefreshRegistry();
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
  }
  return registry;
}

function providerHint(profile: AuthProfile): AuthRefreshProvider {
  const explicit = (profile as AuthProfile & { refreshProvider?: AuthRefreshProvider }).refreshProvider;
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
