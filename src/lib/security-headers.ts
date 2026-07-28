export const securityHeaders = Object.freeze({
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "cache-control": "no-store",
});

export function withSecurityHeaders(headers: HeadersInit = {}): Headers {
  const result = new Headers(headers);
  for (const [key, value] of Object.entries(securityHeaders)) result.set(key, value);
  return result;
}
