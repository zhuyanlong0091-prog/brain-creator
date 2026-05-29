import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

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
  const cipher = createCipheriv("aes-256-gcm", localSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "enc",
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

function decryptSecretValue(value: string) {
  const [, version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1") {
    return Buffer.from(value.slice("enc:".length), "base64").toString("utf8");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    localSecretKey(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function localSecretKey() {
  return createHash("sha256")
    .update(process.env.BRAIN_CREATOR_SECRET_KEY ?? process.cwd())
    .digest();
}
