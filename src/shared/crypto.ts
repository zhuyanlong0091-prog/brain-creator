import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";

export function redactSecrets(secrets: Record<string, string>) {
  return Object.fromEntries(Object.keys(secrets).map((key) => [key, "[REDACTED]"]));
}

export function encryptSecrets(secrets: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(secrets).map(([key, value]) => [key, encryptSecretValue(value)])
  );
}

export function decryptSecrets(secrets: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(secrets)
      .filter(([, value]) => value.startsWith("enc:"))
      .map(([key, value]) => [key, decryptSecretValue(value)])
  );
}

function encryptSecretValue(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "enc",
    "v2",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

function decryptSecretValue(value: string) {
  const [, version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1") {
    if (version !== "v2") {
      return Buffer.from(value.slice("enc:".length), "base64").toString("utf8");
    }
    return decryptWithKey(value, secretKey(), iv, tag, encrypted);
  }
  return decryptWithKey(value, legacySecretKey(), iv, tag, encrypted);
}

function decryptWithKey(value: string, key: Buffer, iv: string, tag: string, encrypted: string) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function legacySecretKey() {
  return createHash("sha256")
    .update(process.env.BRAIN_CREATOR_SECRET_KEY ?? process.cwd())
    .digest();
}

function secretKey() {
  if (process.env.BRAIN_CREATOR_SECRET_KEY) {
    return createHash("sha256").update(process.env.BRAIN_CREATOR_SECRET_KEY).digest();
  }
  const keyPath = resolve(
    process.env.BRAIN_CREATOR_SECRET_KEY_FILE ??
      resolve(process.env.BRAIN_CREATOR_WORKSPACE ?? process.cwd(), ".brain-creator", "secret.key")
  );
  if (!existsSync(keyPath)) {
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      // Windows does not expose POSIX file modes; ACLs remain the host control.
    }
  }
  return createHash("sha256").update(readFileSync(keyPath)).digest();
}

export function migrateEncryptedSecrets(encryptedSecrets: Record<string, string>) {
  const migrated: Record<string, string> = {};
  let changed = false;
  for (const [key, value] of Object.entries(encryptedSecrets)) {
    if (value.startsWith("enc:v1:")) {
      migrated[key] = encryptSecretValue(decryptSecretValue(value));
      changed = true;
    } else {
      migrated[key] = value;
    }
  }
  return { encryptedSecrets: migrated, changed };
}
