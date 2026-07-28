# Troubleshooting

## Session or CORS failures

- Confirm the browser sends credentials and the API uses HTTPS.
- Compare the exact Origin (scheme, hostname, port) with `CORS_ALLOWED_ORIGINS`.
- Ensure preview and production Framer origins are both configured when needed.
- Confirm the platform has not stripped `Origin`, `Referer`, `Cookie`, or `Authorization`.
- Cookies marked `SameSite=Lax` may require the Framer site and API to be same-site. Prefer a custom
  API subdomain under the same registrable domain and test the final browser topology.

## Turnstile rejection

- Match `TURNSTILE_EXPECTED_HOSTNAME` and `TURNSTILE_EXPECTED_ACTION=screenplay_upload`.
- Use the site key in Framer and keep the secret on the backend.
- Reset the widget after every authorization attempt; tokens are fresh and single-use.
- Verify outbound access to Cloudflare and the backend timeout.

## Upload rejected

- Ensure the browser and server limits match and the platform body limit is higher than both.
- MIME must be `application/pdf`, bytes must start with `%PDF-`, and the server hash must match.
- Image-only, encrypted, malformed, over-page-limit, and insufficient-text PDFs are rejected.
- Authorization expires after five minutes and cannot be replayed.

## Processing capacity

- Inspect only aggregate safe counters; never log request tokens or screenplay content.
- Check global analyses/hour, hourly/daily spend, per-session/IP concurrency, and processing locks.
- Reconcile or allow TTL expiry for abandoned spend reservations after confirming no calls remain.
- Verify current `MODEL_PRICING_JSON`; stale or missing prices must not be bypassed.

## Result unavailable

- The same anonymous-session cookie and matching result-access token are both required.
- Results and tokens default to 30 days; clearing browser cookies removes session access.
- A guessed result ID is intentionally indistinguishable from an expired or unauthorized result.

## Redis issues

- Confirm Lua `EVAL` support; simple key/value-only services are insufficient.
- Check TLS credentials, eviction policy, memory limits, clock consistency, and key-prefix access.
- Do not manually edit JSON lock/cache/result values.
- Purge by the narrow versioned prefix only after validating the target; cache keys are
  reconstructible, result keys are not.

## OpenAI or mock-provider issues

- OpenAI mode requires a backend API key, model IDs supporting structured output, and pricing.
- Mock mode needs no API key and performs no external LLM request.
- Production intentionally rejects mock mode unless explicitly overridden.
- Malformed structured output receives one retry; a second invalid response fails the analysis.

## Pre-deployment verification

```sh
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
```
