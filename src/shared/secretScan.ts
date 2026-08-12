export type SecretScanFinding = {
  secretKey: string;
  matchedLength: number;
};

export type SecretPatternFinding = {
  rule: string;
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

/** Detect high-confidence credential material when the original value is unavailable. */
export function scanSensitivePatterns(content: string): SecretPatternFinding[] {
  const patterns: Array<[string, RegExp]> = [
    ["private-key", /-----BEGIN (?:RSA |OPENSSH |EC |PGP )?PRIVATE KEY-----/],
    ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
    ["bearer-token", /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i],
    [
      "sensitive-field-literal",
      /\b(?:password|passwd|token|cookie|secret|api[_-]?key)\s*[:=]\s*["'](?!redacted|masked|your[_-]|<)[^"'\r\n]{8,}["']/i
    ]
  ];
  return patterns.flatMap(([rule, pattern]) => {
    const match = content.match(pattern);
    return match ? [{ rule, matchedLength: match[0].length }] : [];
  });
}
