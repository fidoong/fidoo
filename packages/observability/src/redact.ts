const SENSITIVE_KEYS = new Set([
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "password",
  "private_key",
  "privatekey",
  "secret",
  "session_token",
  "sessiontoken",
  "set_cookie",
  "token",
]);

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? "[redacted]" : redact(item);
  }
  return output;
}

export function redactText(value: string): string {
  return value
    .replaceAll(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[redacted private key]",
    )
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replaceAll(/\b(?:sk|key|token)-[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replaceAll(
      /\b(api[_-]?key|access[_-]?token|password|secret)(\s*[=:]\s*)(["']?)[^\s,"']+\3/gi,
      "$1$2[redacted]",
    );
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replaceAll(/[^A-Za-z0-9_]/g, "").toLowerCase();
  return SENSITIVE_KEYS.has(normalized) || SENSITIVE_KEYS.has(normalized.replaceAll("_", ""));
}
