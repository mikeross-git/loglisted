# Production deployment

## Platform requirements

- Node.js 22-compatible serverless runtime with Web `Request`, `Response`, `File`, and `FormData`.
- HTTPS on API and Framer origins.
- Request-body allowance above `MAX_PDF_BYTES` plus multipart overhead.
- Execution timeout longer than PDF extraction and configured LLM timeouts.
- Redis-compatible service supporting `GET`, `SET`, `DEL`, sorted sets, sets, expiry, and Lua
  `EVAL`. Production must use `STORAGE_DRIVER=redis`.

Create thin platform route adapters for the four exported handlers. Construct dependencies once per
warm runtime where safe; do not instantiate a new in-memory store per request.

The deployment adapter must construct `VersionedCache` with
`cacheTtlsForRetention(createDataRetentionPolicy(...))` and wrap production Redis caching with
`EncryptedCacheStore`. It must also disable request/response body capture for `/api/analyze`,
result routes, internal summary work, and provider HTTP calls. Do not enable APM, tracing,
analytics, error reporting, crash reporting, session replay, proxy logging, or Redis command-value
logging for prompts, responses, multipart bodies, cookies, authorization headers, or derived
screenplay content.

## Environment-variable reference

| Variable                                | Purpose / production guidance                                          |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `APP_ENV`                               | Use `production`; staging uses a separate executable and schema.       |
| `SCREENPLAY_SCORING_MODE`               | Use `production`; staging accepts only `mock`.                         |
| `NODE_ENV`                              | Use `production`.                                                      |
| `LOG_LEVEL`                             | Structured log threshold. Do not bypass `SafeLogger`.                  |
| `PUBLIC_APP_ORIGIN`                     | Canonical Framer/custom-domain origin.                                 |
| `API_ORIGIN`                            | Canonical API origin.                                                  |
| `CORS_ALLOWED_ORIGINS`                  | Comma-separated exact production and preview origins; never `*`.       |
| `SESSION_SIGNING_SECRET`                | At least 32 random characters; signs session cookies.                  |
| `DEVICE_HMAC_SECRET`                    | At least 32 random characters; pseudonymizes browser UUIDs.            |
| `CSRF_SIGNING_SECRET`                   | At least 32 random characters; signs CSRF tokens.                      |
| `IP_HMAC_SECRET`                        | At least 32 random characters; pseudonymizes normalized IPs.           |
| `RESULT_TOKEN_SIGNING_SECRET`           | At least 32 random characters; signs result access.                    |
| `DELETION_TOKEN_SIGNING_SECRET`         | At least 32 random characters; signs deletion credentials.             |
| `UPLOAD_TOKEN_SIGNING_SECRET`           | At least 32 random characters; signs upload authorization.             |
| `ANONYMOUS_SESSION_TTL_SECONDS`         | Default `604800` (7 days).                                             |
| `UPLOAD_TOKEN_TTL_SECONDS`              | Default `300` (5 minutes).                                             |
| `RESULT_TTL_SECONDS`                    | Default `2592000` (30 days).                                           |
| `ABUSE_TELEMETRY_TTL_SECONDS`           | Default `7776000` (90 days).                                           |
| `TRUSTED_PROXY_IPS`                     | Direct proxy addresses allowed to supply `X-Forwarded-For`.            |
| `TRUSTED_PROXY_HOPS`                    | Number of trusted hops selected from the right of the forwarded chain. |
| `GLOBAL_ANALYSES_PER_MINUTE`            | Authorization admission ceiling.                                       |
| `TURNSTILE_SITE_KEY`                    | Public widget key; also supplied to Framer.                            |
| `TURNSTILE_SECRET_KEY`                  | Backend-only verification secret.                                      |
| `TURNSTILE_EXPECTED_HOSTNAME`           | Exact hostname returned by Turnstile.                                  |
| `TURNSTILE_EXPECTED_ACTION`             | Use `screenplay_upload`.                                               |
| `STORAGE_DRIVER`                        | Use `redis` in production.                                             |
| `UPSTASH_REDIS_REST_URL`                | Redis REST endpoint when using the Upstash adapter.                    |
| `UPSTASH_REDIS_REST_TOKEN`              | Backend-only Redis credential.                                         |
| `CACHE_ENCRYPTION_KEY`                  | Base64-encoded 32-byte application cache-encryption key.               |
| `LLM_PROVIDER`                          | `openai` or `mock`; mock is blocked in production by default.          |
| `MOCK_FIXTURE_MODE`                     | `deterministic`.                                                       |
| `MOCK_FIXTURE`                          | Named development/test fixture.                                        |
| `ALLOW_MOCK_IN_PRODUCTION`              | Leave `false`; explicit emergency/demo override only.                  |
| `AI_PROVIDER_*`                         | Reviewed training, retention, storage, region, and legal settings.     |
| `ALLOW_LLM_CONTENT_IN_OBSERVABILITY`    | Must remain `false`.                                                   |
| `ALLOW_SCRIPT_CONTENT_IN_ERROR_REPORTS` | Must remain `false`.                                                   |
| `ALLOW_REQUEST_BODY_LOGGING`            | Must remain `false`.                                                   |
| `RAW_PDF_PERSISTENCE_ENABLED`           | Must remain `false`.                                                   |
| `RAW_TEXT_PERSISTENCE_ENABLED`          | Must remain `false`.                                                   |
| `REDACT_TITLE_PAGE_PII`                 | Must remain `true` in production.                                      |
| `CHUNK_CACHE_TTL_HOURS`                 | Redacted chunk TTL; maximum/default 24.                                |
| `SUMMARY_CACHE_TTL_DAYS`                | Summary TTL; maximum/default 30.                                       |
| `COMPRESSED_REPRESENTATION_TTL_DAYS`    | Reduced representation TTL; maximum/default 30.                        |
| `PRIVACY_STATUS_ENABLED`                | Disabled by default; enables the protected internal route.             |
| `PRIVACY_STATUS_ADMIN_SECRET`           | Required when privacy status is enabled.                               |
| `PRIVACY_CONFIG_VERSION`                | Auditable privacy-configuration version.                               |
| `OPENAI_API_KEY`                        | Backend-only; required for production OpenAI mode.                     |
| `SUMMARY_MODEL`                         | Low-cost structured-output model identifier.                           |
| `SCORING_MODEL`                         | Final structured-output model identifier.                              |
| `VERIFICATION_MODEL`                    | Reserved optional model role.                                          |
| `ADJUDICATOR_MODEL`                     | Reserved optional model role.                                          |
| `MODEL_PRICING_JSON`                    | Pricing table for every active model. Startup warns for omissions.     |
| `DRY_RUN`                               | Skips billable OpenAI calls; do not use for real evaluations.          |
| `LLM_TIMEOUT_MS`                        | Per-attempt timeout, default `45000`.                                  |
| `LLM_CONCURRENCY`                       | Chunk-summary concurrency, default `3`.                                |
| `MAX_LLM_COST_USD_PER_SUBMISSION`       | Hard per-script ceiling, default `0.15`.                               |
| `DAILY_LLM_BUDGET_USD`                  | Legacy deployment budget input; keep aligned with daily limit.         |
| `MAX_TOTAL_INPUT_TOKENS_PER_SCRIPT`     | Hard cumulative input-token limit.                                     |
| `MAX_TOTAL_OUTPUT_TOKENS_PER_SCRIPT`    | Hard cumulative output-token limit.                                    |
| `MAX_CHUNK_SUMMARY_OUTPUT_TOKENS`       | Maximum summary output per chunk.                                      |
| `MAX_SCORING_INPUT_TOKENS`              | Maximum final-scoring evidence input.                                  |
| `MAX_SCORING_OUTPUT_TOKENS`             | Maximum scoring JSON output.                                           |
| `REPRESENTATIVE_EXCERPT_TOKEN_BUDGET`   | Original-text evidence limit, default `4000`.                          |
| `TARGET_COST_PER_SCRIPT_USD`            | Operational target, default `0.10`; not a hard limit.                  |
| `DAILY_LLM_SPEND_LIMIT_USD`             | Atomic global daily reservation ceiling.                               |
| `HOURLY_LLM_SPEND_LIMIT_USD`            | Atomic global hourly reservation ceiling.                              |
| `MAX_ANALYSES_PER_HOUR_GLOBAL`          | Atomic global analysis admission ceiling.                              |
| `MAX_PDF_BYTES`                         | Default `15728640` (15 MiB).                                           |
| `MAX_PDF_PAGES`                         | Default `150`.                                                         |
| `MIN_READABLE_TEXT_LENGTH`              | Minimum locally extracted characters, default `1000`.                  |
| `PDF_LOW_TEXT_PAGE_THRESHOLD`           | Low-text warning threshold per page.                                   |
| `CHUNK_TARGET_TOKENS`                   | Target `1500`–`2500`, default `2000`.                                  |
| `CHUNK_HARD_MAX_TOKENS`                 | Hard chunk target, default `2500`.                                     |

Generate independent secrets with a cryptographically secure secret manager. Never reuse signing or
HMAC keys and never expose them through Framer environment properties.

## Redis key schema

Prefixes are versioned so migrations can invalidate data safely.

| Pattern                                                       | Contents                                    | Typical retention                       |
| ------------------------------------------------------------- | ------------------------------------------- | --------------------------------------- |
| `loglisted:cache:v1:<stage>:<fileHash>:<fingerprint>`         | Validated derived artifact; never PDF bytes | 1 hour–30 days by stage                 |
| `loglisted:lock:v1:<fileHash>:<configHash>`                   | processing/completed/failed lease state     | 15-minute active lease; 30-day terminal |
| `loglisted:production:v1:result:<resultId>`                   | private stored result                       | 30 days                                 |
| `loglisted:production:v1:result:index:<fileHash>:<sessionId>` | same-session lookup                         | 30 days                                 |
| `loglisted:production:v1:abuse:<signal>`                      | windows, nonces, quotas, distinct sets      | signal TTL; at most telemetry TTL       |
| `loglisted:production:v1:spend:hour:<UTC-hour>`               | reserved/reconciled USD                     | 2 hours                                 |
| `loglisted:production:v1:spend:day:<UTC-day>`                 | reserved/reconciled USD                     | 2 days                                  |
| `loglisted:production:v1:spend:analyses:<UTC-hour>`           | admitted analysis count                     | 2 hours                                 |
| `loglisted:production:v1:spend:reservation:<uuid>`            | pending projected cost                      | 2 days                                  |

Result value and session/file index writes are one Lua operation. Upload/Turnstile nonce
consumption, processing-lock transitions, windows, concurrency, and spend reservations use atomic
Redis operations.

## Deployment checklist

- [ ] `NODE_ENV=production`, `STORAGE_DRIVER=redis`, and `LLM_PROVIDER=openai`.
- [ ] All six security secrets are independent, random, stored in the platform secret manager.
- [ ] OpenAI and Redis credentials exist only in backend configuration.
- [ ] Provider terms, training opt-out, data sharing, request storage, retention, region, and DPA
      fields reflect a dated review.
- [ ] Every active model has verified current pricing.
- [ ] Production and required Framer preview origins are listed exactly; no wildcard.
- [ ] Trusted proxies/hops match the actual platform chain.
- [ ] Turnstile hostname and action match the widget.
- [ ] Platform upload/body and execution limits exceed configured application needs.
- [ ] Redis persistence, eviction policy, TLS, and access controls are reviewed.
- [ ] Redis derived-content cache is wrapped with `EncryptedCacheStore`.
- [ ] Privacy TTL configuration is wired through `createDataRetentionPolicy` and
      `cacheTtlsForRetention`.
- [ ] Request/error/APM/tracing body capture is disabled at the adapter, proxy, and vendor levels.
- [ ] Spend limits start conservatively and capacity errors are monitored.
- [ ] Cache/result/telemetry TTLs match the published privacy policy.
- [ ] `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm test`, and
      `npm run build` pass.
- [ ] Mock mode is rejected and a smoke test confirms real responses omit `evaluationMode`.
- [ ] Session, authorization, analysis, and result routes are tested from every allowed origin.
- [ ] Logs are sampled to confirm no raw text, token, PDF, or raw IP data.
- [ ] Incident response includes key rotation, Redis purge, provider-key revocation, and spend halt.
