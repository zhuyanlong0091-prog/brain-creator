import type { AuthProfile, SystemProfile } from "../domain/types.js";

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
