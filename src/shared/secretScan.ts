export type SecretScanFinding = {
  secretKey: string;
  matchedLength: number;
};

export function scanSensitiveValues(
  content: string,
  secrets: Record<string, string>
): SecretScanFinding[] {
  return Object.entries(secrets)
    .filter(([, value]) => value.length >= 8)
    .filter(([, value]) => content.includes(value))
    .map(([secretKey, value]) => ({ secretKey, matchedLength: value.length }));
}

export function assertNoSensitiveValues(
  content: string,
  secrets: Record<string, string>,
  label: string
) {
  const findings = scanSensitiveValues(content, secrets);
  if (findings.length > 0) {
    throw new Error(
      `Sensitive values detected in ${label}: ${findings
        .map((finding) => finding.secretKey)
        .join(", ")}`
    );
  }
}
