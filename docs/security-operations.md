# Security, privacy, and cost operations

## Confirmed controls

- No login, account, password, email service, Gmail check, mandatory IMDb requirement, or
  identity/profile scoring path exists. Submission contact fields are private result metadata, not
  authentication or scoring inputs.
- LLM credentials are consumed only by the backend OpenAI provider.
- PDFs are held in request memory and are not written to object storage, disk, result storage, or
  cache.
- The allowlisted structured logger rejects screenplay/chunk/summary fields, binary PDFs, upload
  and Turnstile tokens, and raw IP fields.
- Raw IPs are normalized transiently and HMAC-derived before normal telemetry storage.
- Every authorization uses backend Turnstile verification with expected hostname/action and an
  atomically consumed token hash.
- Upload tokens default to five minutes, bind session/device/file hash/size/MIME/project claims,
  and have atomically consumed nonces.
- Result IDs are random UUIDs. Retrieval requires an unexpired result token bound to the ID and
  anonymous session, the matching signed session cookie, and a matching stored owner session.
- CORS echoes only configured exact origins; Origin is mandatory and Referer must agree when
  present. State-changing authorization requires CSRF.
- The server checks PDF signature and recalculates SHA-256 before consuming authorization.
- Version/config-bound distributed locks and stage caches prevent duplicate LLM work.
- Projected spend is reserved before each call, actual usage is reconciled after it, and hourly,
  daily, per-script, token, and global-capacity limits fail closed.
- Final prompts are built only from validated reduced screenplay evidence, objective metadata,
  excerpts, rubric, and anchors. Risk/session/IP/device/history/writer identity are absent and
  schema boundaries reject extra fields.
- Optional project information cannot alter the public score because it is not supplied to the
  scoring payload.

## Data retention

Default policy:

- raw PDF: request lifetime only;
- anonymous signed cookie: 7 days in the browser;
- original extracted text: request memory only, not cached;
- redacted parsed metadata and chunks: at most 1 day;
- chunk summaries and reduced representation: at most 30 days;
- representative excerpts: request memory only, not cached;
- anonymous results and same-session index: 30 days;
- abuse telemetry and completed quotas: up to 90 days;
- active upload and Turnstile nonce hashes: about 5 minutes;
- spend counters: 2 hours for hourly keys and 2 days for daily/reservation keys.

Cached redacted chunks contain screenplay text even though the PDF is not retained. This must be
disclosed in the privacy policy, protected as sensitive content, application-encrypted in
production, and deleted through TTL/operational purge procedures. Do not enable Redis persistence or backups
that conflict with the stated retention policy.

Rotating an HMAC secret changes pseudonymous identifiers; rotating signing secrets invalidates
outstanding sessions/tokens. Legal/privacy owners must approve production TTLs and deletion terms.

## Threat model

Protected assets: screenplay content, scoring results, signing/HMAC/LLM/Redis secrets, LLM budget,
and service availability.

Primary threats and mitigations:

- automated submissions: Turnstile, honeypot/timing signals, rate limits, quotas, global limits;
- direct API calls: mandatory Origin, signed session, CSRF, Turnstile, and upload-token binding;
- token theft/replay: HTTPS, HttpOnly session cookie, short expiry, HMAC signatures, nonce
  consumption, session binding;
- result enumeration: random IDs plus independent scoped access token and owner check;
- forged file declarations: signature detection, server-side size/MIME binding and SHA-256;
- duplicate LLM spend: file/config processing lock and versioned summary/result reuse;
- prompt contamination by identity/risk data: typed prompt builders with narrow inputs and tests;
- log leakage: field allowlist and no content-bearing operational logs;
- proxy spoofing: forwarded headers accepted only from configured direct proxy IPs;
- budget exhaustion: pre-call reservation, hard script limits, hourly/daily atomic breakers;
- cache poisoning/version drift: schema validation on read, invalid-entry deletion, versioned keys.

Residual risks:

- a compromised backend/runtime can access in-memory PDF text and secrets;
- HMAC-derived IP/device identifiers remain pseudonymous personal data;
- a stolen browser session plus result token permits access until expiry;
- cache/result Redis contains sensitive derived artifacts during TTL;
- a processing lease must outlive the maximum expected analysis duration; configure platform
  timeouts and monitor unusually long jobs;
- third-party providers process submitted evidence under their own contractual retention terms;
- CORS is a browser control, not an anti-bot boundary.

## Cost model

For each model:

```text
cost =
  (uncachedInputTokens / 1,000,000 × inputPerMillion) +
  (cachedInputTokens / 1,000,000 × cachedInputPerMillion) +
  (outputTokens / 1,000,000 × outputPerMillion)
```

Before a call, the application estimates input and maximum output, checks remaining token/cost
budgets, and atomically reserves global projected spend. After a call it stores actual token use,
calculates cost from `MODEL_PRICING_JSON`, reconciles the reservation, and rejects results exceeding
hard limits. Missing active pricing produces a startup warning and call-time cost calculation fails
closed.

The target is approximately `$0.10` per screenplay, not a guarantee. Actual cost varies with pages,
text density, chunk count, model prices, provider tokenization, cache hits, and retries. Set
`MAX_LLM_COST_USD_PER_SUBMISSION` above the target but below the maximum acceptable loss. Keep
hourly/daily limits low during launch and alert on reservation age, capacity rejection rate, average
tokens, cache-hit rate, and cost percentiles.

`DRY_RUN` is for plumbing checks only. Mock pricing and scores do not represent real quality or
provider cost.

## Privacy-policy configuration support

Only publish values that have been reviewed and are not `unknown`:

- provider: `AI_PROVIDER`;
- provider terms/privacy/DPA:
  `AI_PROVIDER_TERMS_URL`, `AI_PROVIDER_PRIVACY_URL`, `AI_PROVIDER_DPA_URL`;
- training default and confirmed opt-out:
  `AI_PROVIDER_DATA_TRAINING_DEFAULT`, `AI_PROVIDER_TRAINING_OPT_OUT_CONFIRMED`;
- stated provider retention: `AI_PROVIDER_RETENTION_DAYS`;
- approved retention controls:
  `AI_PROVIDER_ZERO_DATA_RETENTION_ENABLED`,
  `AI_PROVIDER_MODIFIED_ABUSE_MONITORING_ENABLED`;
- request storage: `AI_PROVIDER_REQUEST_STORAGE_DISABLED`;
- regional processing: `AI_PROVIDER_CONFIGURED_REGION` and its reviewed capability flag;
- derived-data TTLs:
  `CHUNK_CACHE_TTL_HOURS`, `SUMMARY_CACHE_TTL_DAYS`,
  `COMPRESSED_REPRESENTATION_TTL_DAYS`;
- application results and abuse telemetry: `RESULT_TTL_SECONDS`,
  `ABUSE_TELEMETRY_TTL_SECONDS`.

`AI_PROVIDER_PRIVACY_REVIEW_DATE` records when these statements were last checked. It is not proof
of a contract or provider setting. Do not describe ZDR as enabled unless both the provider approval
and the applicable organization/project technical setting have been verified.

## Deletion implementation limits

Application result and ownership-index deletion is atomic within the Redis result store. File-scoped
cache deletion uses Redis scan/delete and is best-effort rather than one cross-key transaction.
The result becomes inaccessible immediately; a cache purge may finish afterward. Deletion does not
remove bounded abuse/deduplication records and cannot promise deletion from provider systems beyond
the provider's documented controls and retention behavior.
