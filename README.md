# Loglisted

Loglisted is an anonymous screenplay-scoring MVP. A visitor uses a Framer component to establish
an anonymous browser session, pass Cloudflare Turnstile, authorize one PDF upload, and receive ten
category scores plus an application-calculated overall score.

No login, account, password, or email-verification service exists. Submission contact fields are
stored only with the private result record, are deleted with that result, are never returned by the
public result API, and are isolated from screenplay evaluation and operational abuse signals.

## Status

Complete:

- strict TypeScript and Zod validation at application boundaries;
- signed anonymous sessions, CSRF tokens, short-lived single-use upload tokens, and scoped result
  tokens;
- exact-origin CORS and Referer validation;
- backend Turnstile verification, privacy-preserving IP/device HMACs, rate limits, quotas, and risk
  decisions;
- in-memory PDF signature validation, hashing, text extraction, parsing, metadata, chunking,
  reduction, and excerpt sampling;
- structured-output summary and scoring calls with retries, timeouts, token accounting, budgets,
  spend circuit breakers, versioned caching, and distributed locks;
- memory stores for development and Redis-compatible atomic stores for production;
- anonymous result storage and session-scoped retrieval;
- Framer-compatible React uploader;
- deterministic mock provider and end-to-end tests requiring no external LLM.

Mocked:

- `LLM_PROVIDER=mock` produces deterministic fixture data. These responses include
  `evaluationMode: "mock"` and are not genuine evaluations.
- tests inject Turnstile responses and use memory storage unless a store is under direct test.

External configuration required:

- a production Node.js host and route adapters for the exported API handlers;
- Cloudflare Turnstile site/secret keys and approved hostnames;
- Redis-compatible production storage and an adapter implementing the included Redis client
  interfaces;
- an OpenAI API key, model identifiers, and current pricing when using `LLM_PROVIDER=openai`;
- DNS, HTTPS, Framer component installation, privacy/acceptable-use pages, monitoring, and secret
  management.

Intentionally out of scope:

- accounts, login, email verification, identity verification, browser fingerprinting;
- permanent PDF/object storage, frontend LLM calls, prose feedback, recommendations;
- optional multi-model verification and adjudication execution (configuration roles are reserved);
- provider-specific deployment adapters and infrastructure-as-code.

The repository now includes a separate Render-compatible public **mock staging** executable and
Blueprint. It is intentionally not the production adapter.

## Architecture

The API performs security admission before PDF parsing or LLM calls. PDFs remain in process memory
and are discarded after the request. Derived text artifacts can be cached with bounded TTLs; raw
PDF bytes are rejected by the cache layer.

```text
Framer
  -> POST /api/session
  -> POST /api/upload-authorize (session + CSRF + Turnstile)
  -> POST /api/analyze (session + single-use token + PDF)
       -> signature/hash/quotas/lock/spend admission
       -> extract -> parse -> chunk -> summarize -> reduce -> sample -> score
  -> GET /api/result/:resultId (session + result token)
```

## Local development

Requirements: Node.js 22 or later and npm.

## Run the App Locally Without API Costs

The local preview uses the deterministic mock LLM, a single-use mock Turnstile token, and in-memory
stores. It requires no Redis, OpenAI API key, or external AI/Turnstile request.
Completed-upload, browser, session, and local request-count limits are disabled only by the
development server; concurrency protection and all production limits remain unchanged.

1. Copy the environment template:

   ```sh
   cp .env.local.example .env.local
   ```

2. Install dependencies:

   ```sh
   npm install
   ```

3. Start both servers:

   ```sh
   npm run dev
   ```

4. Open [http://localhost:5173](http://localhost:5173).
5. Upload a text-based screenplay PDF and complete the labeled mock challenge.
6. Mock results are deterministic fixtures and are not genuine screenplay evaluations.

Stop both servers with `Ctrl+C`. In-memory sessions, quotas, caches, locks, and results disappear
when the backend restarts.

Change `MOCK_LLM_SCENARIO` in `.env.local` and restart the backend to use another fixture. Supported
scenarios include `successful_pilot`, `successful_feature`, `malformed_summary_once`,
`malformed_score_once`, `provider_timeout`, `provider_failure`, `low_confidence`, `high_score`, and
`cost_limit_exceeded`.

Run each process separately when debugging:

```sh
npm run dev:backend
npm run dev:frontend
```

URLs:

```text
Backend: http://localhost:3000
Frontend: http://localhost:5173
Health: http://localhost:3000/api/health
```

If port 3000 or 5173 is occupied, stop the process using it. Vite uses `strictPort` and fails rather
than silently switching ports. Keep these ports aligned with the exact development-only CORS
origins.

Useful commands:

```sh
npm test             # full Vitest suite
npm run test:watch   # watch mode
npm run lint         # ESLint
npm run typecheck    # strict TypeScript without output
npm run format:check # Prettier verification
npm run build        # production TypeScript build
```

## Public mock staging

Public staging exists so the Framer uploader can be exercised over HTTPS without a paid AI API.
It uses the existing API contracts and deterministic mock pipeline, but a separate executable,
configuration schema, and in-memory runtime:

```env
APP_ENV=staging
SCREENPLAY_SCORING_MODE=mock
```

The staging schema accepts no other values. The staging executable imports `MockLlmProvider`
directly and never imports the OpenAI adapter or general provider factory. An accidentally present
`OPENAI_API_KEY` is ignored. Invalid mode combinations fail before Express begins listening.

Test staging locally:

```sh
cp .env.staging.example .env.staging
# Replace placeholder origins, hostnames, and staging-only secrets.
npm run dev:staging
curl http://localhost:10000/health
```

Deploy manually with the repository's `render.yaml`:

1. Push the reviewed commit to a dedicated staging branch.
2. In Render, choose **New → Blueprint**, select the repository and staging branch, and apply
   `render.yaml`.
3. Supply the `sync: false` values, especially the exact Framer origin and staging Turnstile
   values. Do not add `OPENAI_API_KEY`.
4. Manually trigger the first deploy. Automatic deploys are disabled.
5. Open `https://<render-service-name>.onrender.com/health` and confirm the response says
   `environment: "staging"` and `scoringMode: "mock"`.

The Framer API URL is the Render External URL with no trailing `/api`, for example:

```text
https://loglisted-staging-api.onrender.com
```

The real assigned hostname is shown on the Render service page after creation. Set the same exact
Framer published origin in `ALLOWED_ORIGINS`. For reliable credentialed cookies across browsers,
prefer a staging API custom domain under the same registrable domain as the Framer site.

See [Public mock staging deployment](docs/staging-deployment.md) for all variables, Turnstile
choices, verification, limitations, and rollback.

## Mock LLM mode

```env
LLM_PROVIDER=mock
DRY_RUN=false
MOCK_FIXTURE_MODE=deterministic
MOCK_FIXTURE=successful_feature
SUMMARY_MODEL=mock-summary
SCORING_MODEL=mock-scoring
MODEL_PRICING_JSON={"models":{"mock-summary":{"inputPerMillion":0.1,"outputPerMillion":0.2,"cachedInputPerMillion":0.05},"mock-scoring":{"inputPerMillion":0.2,"outputPerMillion":0.4,"cachedInputPerMillion":0.1}}}
```

Fixtures: `successful_pilot`, `successful_feature`, `malformed_summary_once`,
`malformed_score_once`, `provider_timeout`, `provider_failure`, `low_confidence`, `high_score`,
and `cost_limit_exceeded`.

Production rejects mock mode unless `ALLOW_MOCK_IN_PRODUCTION=true` is explicit.

## Documentation

- [API and request examples](docs/api.md)
- [Production deployment, environment variables, Redis, and checklist](docs/deployment.md)
- [Public mock staging deployment](docs/staging-deployment.md)
- [Security, privacy, retention, threat model, and cost model](docs/security-operations.md)
- [Framer and Turnstile setup](docs/framer-installation.md)
- [Troubleshooting](docs/troubleshooting.md)

## AI provider privacy and retention

Model training and provider retention are different controls. A provider may exclude API content
from training while temporarily retaining prompts/responses for abuse monitoring or application
state. A system prompt cannot control either behavior.

Before launch, the operator must confirm the provider's current contract, terms, organization or
project data-sharing settings, training opt-out, request-storage behavior, retention, regional
processing, and any DPA. These facts are configuration and are not inferred from a provider name.
Unknown values warn in development; required unknown production values fail startup.

For the OpenAI Responses adapter, every request explicitly includes `store: false`. That is the
documented request-level application-state control, but it does not itself disable abuse-monitoring
retention or establish Zero Data Retention. ZDR or Modified Abuse Monitoring must be approved and
enabled at the provider account/project level and then truthfully reflected in configuration.

Summary calls receive one locally redacted chunk plus minimal structural identifiers. Scoring calls
receive only the compressed representation, deterministic metadata, selected redacted excerpts,
rubric, and anchors. The PDF, IP/device/session/risk/history data, contact fields, profiles,
representation details, and prior/external scores are never scoring inputs.

Likely title-page email, phone, street address, URL, social handle, representation/contact lines,
and writer names are deterministically replaced before model submission. The original file is not
modified. Automated redaction is best-effort and cannot guarantee every PII format.

Raw PDF and original extracted text are request-memory-only. Redacted chunks may be cached for at
most 24 hours; summaries and compressed representations for at most 30 days. Representative
excerpts are regenerated and not cached. Production Redis caches require application-level
AES-256-GCM encryption. Deployment adapters must explicitly construct cache TTLs from the validated
retention policy; environment values do not wire infrastructure by themselves.

Provider facts must be rechecked against the
[current OpenAI data-controls documentation](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
before launch and on every privacy review date.

Each completed result receives an opaque deletion token. `DELETE /api/result/:resultId` requires
that token and the matching session and removes the result and file-scoped cached artifacts.
Bounded abuse/deduplication records may remain. The application cannot promise deletion from
provider systems beyond documented provider behavior.

### AI privacy launch checklist

- [ ] Verify current provider API terms and privacy documentation.
- [ ] Verify training opt-out and account/project data-sharing settings.
- [ ] Verify request-storage control on every call.
- [ ] Verify retention and approved ZDR/MAM status, if applicable.
- [ ] Verify regional processing settings, if applicable.
- [ ] Verify DPA availability and execution when required.
- [ ] Confirm logging, tracing, analytics, replay, and error tools capture no content bodies.
- [ ] Run PII-redaction, prompt-isolation, logging, retention, and deletion tests.
- [ ] Publish actual provider and retention values; do not publish unknown values.

## Security invariants

- LLM and Turnstile secrets are backend-only.
- Raw PDFs are never placed in application cache or result storage.
- The structured logger rejects screenplay text, summaries, PDFs, security tokens, and raw IPs.
- IP addresses and browser UUIDs are HMAC-derived before abuse telemetry storage.
- The server verifies Turnstile, Origin, CSRF, PDF signature, size, MIME binding, and SHA-256.
- Upload nonces and Redis reservations use atomic operations.
- Result identifiers are random UUIDs and retrieval requires both the matching session and token.
- Prompt builders accept only validated screenplay evidence; risk, IP, session, identity, history,
  and optional writer information are not inputs.

See [security-operations.md](docs/security-operations.md) for assumptions and residual risks.

## Server-side Framer CMS synchronization

CMS synchronization is an optional backend-only secondary operation. It runs only after a scoring
result has been validated and persisted. A Framer failure is sanitized, bounded to three attempts
for transient failures, and never changes the successful scoring response.

The integration uses Framer's current Server API (`framer-api`), resolves collection fields by
their exact display names, and then writes values using the returned field IDs. No field ID is
guessed or committed. New records are drafts by default. Their deterministic slug combines the
writer-name slug with the first eight alphanumeric characters of the result ID, so retries and
cached-result synchronization find the same item without putting an email address in the URL.

The configured collection appears to feed the public `/loglist` page. Treat it as public-facing:
do not bind the `Email` field to any public component, export, search result, or client query.
Separating private submission contacts from a public ranking collection is strongly recommended
before production. This integration preserves the requested Email field but never returns it from
the public API.

### Configure and inspect

1. In Framer, open the project, use **Settings → API Keys**, and create a server API key.
2. Copy `.env.local.example` to `.env.local`; keep `FRAMER_CMS_SYNC_ENABLED=false`.
3. Set `FRAMER_API_TOKEN`, `FRAMER_PROJECT_ID`, and `FRAMER_COLLECTION_ID` only in the backend
   environment. Never prefix them with `VITE_`.
4. Run `npm run framer:inspect`. It prints the collection name, exact resolved field map, and field
   types, but not the token or submitted data. Fix missing/duplicate names or incompatible field
   types before enabling writes.
5. Set `FRAMER_CMS_SYNC_ENABLED=true` and leave `FRAMER_CMS_PUBLISH_MODE=draft`.
6. Start locally with `npm run dev`, submit one mock screenplay, and verify one draft item with
   `Test = Yes`. Submitting/retrieving the same cached result must not add another item.

The exact required display names are `Writer S Name`, `Email`, `Test`, `Script Title`, `Logline`,
`Overall Score`, each of the ten named category score fields, `Genre Category`, `IMDB`, and
`Format`. Framer's `Slug` is a built-in item property and is therefore not returned by
`getFields()` or mapped as a custom field. `Test` may be Boolean, text, or an enum containing
Yes/No. Scores must be Number. IMDB may be Link or text. Enum values are resolved by their
displayed option name.

For staging, add the five Framer variables in Render's server environment, run the inspection
command from a trusted local shell first, then explicitly change `FRAMER_CMS_SYNC_ENABLED` to
`true` and manually deploy the reviewed commit. Staging remains mock-only and defaults to draft.
Confirm `/health` reports `framerCmsSyncEnabled: true` and `framerCmsConfigured: true`; it never
returns IDs or credentials.

To disable or roll back immediately, set `FRAMER_CMS_SYNC_ENABLED=false` and restart/redeploy the
backend. Scoring continues normally. A failed sync remains retryable because the persisted result
contains the result ID and approved submission fields; retrieving the cached result invokes the
idempotent sync again. Framer records must be published manually unless
`FRAMER_CMS_PUBLISH_MODE=published` is explicitly configured.
