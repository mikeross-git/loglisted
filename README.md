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
`Overall Score`, each of the ten named category score fields, `Genre Category`, `Genre Dropdown`,
`IMDB`, `Professional Website`, and `Format`. `Genre Category` is the reference used for the Genres relationship;
`Genre Dropdown` is the existing enum used by some Framer views. The backend keeps both values
consistent. Framer's `Slug` is a built-in item property and is therefore not returned by
`getFields()` or mapped as a custom field. `Test` may be Boolean, text, or an enum containing
Yes/No. Scores must be Number. IMDB and Professional Website may be Link or text. Enum values are resolved by their
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

## Screenplay report interface and benchmarking

The uploader renders a responsive analysis loader while the existing blocking `/api/analyze`
request is active, then maps the validated result into a presentation-only `ScreenplayReport`.
The loader percentage is explicitly labeled as an estimate because the backend does not currently
expose category-level job progress or cancellation. It does not poll, invent completed stages, or
make additional AI calls. Mock results are held for a minimum of ten seconds from authorization so
the loader can be reviewed locally and in staging; production evaluations are never delayed.

Every displayed screenplay score remains on the 0–10 report scale. The report adapter maps API
format values such as `halfHourPilot` to `Half-Hour TV Pilot` and genre values such as `comedy` to
`Comedy`; an observed peer cohort is accepted only when both displayed values match exactly.

Production currently has no peer-aggregate API. Until observed Format/Genre aggregates are
available, the report uses the [published methodology prior](https://www.loglisted.com/methodology):
1,000 modeled submissions, mean 6.3, median 6.2, standard deviation 1.0, the published seven score
bands, and published category means. Category percentiles are deterministically estimated from
those category means using the illustrative 1.0 standard deviation. The interface calls this the
“Loglisted model,” while the benchmark note retains the explicit illustrative disclosure; the
modeled 1,000 is not presented as an observed Loglisted sample or an exact Format/Genre cohort.
Full observed benchmarking requires these additional backend fields:

- exact cohort label and sample size;
- overall percentile, mean, median, standard deviation, and distribution bins;
- optional top-decile threshold;
- category percentile and peer mean for each of the ten categories.

The “Download PDF Report” action uses the browser’s print dialog and a dedicated print stylesheet,
so no screenplay data is uploaded to a report service. “Copy share summary” creates a deterministic
title, score, and qualified cohort sentence without screenplay text or private submission data.

## Sortable public Loglist Code Component

`ScreenplayRankingsTable` is an optional replacement for the native Framer table. Keep the native
table published until this component has been verified. Framer Code Components cannot reliably
read all records from a Collection List: Framer documents those internals as unsupported. The
component therefore reads a sanitized public endpoint while the existing server-side Framer API
adapter continues to treat the `Scripts` collection as the source of truth.

### Data path and privacy boundary

1. `GET /api/rankings` accepts search, format, genre, score, minimum-score, direction, page, and
   page-size parameters. Page sizes are restricted to 25, 50, or 100.
2. The backend asks the Framer Server API for the configured collection only when its transformed
   snapshot cache expires. It resolves fields by exact display name, removes drafts, excludes records
   where `Show on Loglist` is not enabled, maps enum IDs, and clamps scores to the 0–10 display range.
3. Search, filtering, selected-score sorting, counts, and pagination run on the backend. The browser
   receives only the requested page rather than the complete CMS collection.
4. The response contains writer name, script title, logline, format, genre, slug, IMDb URL, professional website URL, updated
   timestamp, and eleven scores. It never contains `Email`, Framer credentials, internal field IDs,
   screenplay files, or screenplay text.
5. The transformed CMS snapshot is cached in memory for `FRAMER_RANKINGS_CACHE_TTL_SECONDS` (600
   seconds by default). Render still reads the complete CMS collection on a cache miss because the
   current Framer API exposes `getItems()` rather than queryable collection pagination.

Enable the endpoint on the backend only:

```dotenv
FRAMER_RANKINGS_ENABLED=true
FRAMER_RANKINGS_CACHE_TTL_SECONDS=600
FRAMER_API_TOKEN=server-only-token
FRAMER_PROJECT_ID=A3RwefBUP4USDJqrWaaE
FRAMER_COLLECTION_ID=F7qGD3E3z
ALLOWED_ORIGINS=https://www.loglisted.com,https://loglisted.com
```

Do not prefix any credential with `VITE_`, and do not paste a Framer token into a Code Component
property. CMS writing and public reading can be enabled independently. The endpoint returns `503`
when public rankings are disabled or unavailable.

### Exact CMS mapping

| Public value          | Framer display name                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Writer                | `Writer S Name`                                                                                                                                                            |
| Script title          | `Script Title`                                                                                                                                                             |
| Logline               | `Logline`                                                                                                                                                                  |
| Overall               | `Overall Score`                                                                                                                                                            |
| Premise through Craft | `Premise Score`, `Story Score`, `Structure Score`, `Characters Score`, `Dialogue Score`, `Pacing Score`, `Theme Score`, `Tone Score`, `Marketability Score`, `Craft Score` |
| Genre                 | `Genre Category` (string/reference label), falling back to `Genre Dropdown`                                                                                                |
| IMDb                  | `IMDB`                                                                                                                                                                     |
| Professional website  | `Professional Website`                                                                                                                                                     |
| Public eligibility    | `Show on Loglist` (Boolean; only enabled records are returned)                                                                                                             |
| Format                | `Format`                                                                                                                                                                   |
| Profile fallback      | CMS item `slug`                                                                                                                                                            |

The public reader resolves a `Genre Category` collection reference to its label when necessary and
uses the `Genre Dropdown` enum as a compatibility fallback for older records. `Email` and `Test`
are intentionally not serialized. Draft items are excluded, matching Framer publishing behavior.

### Framer installation

1. Add `ScreenplayRankingsTable.tsx` and `loglisted-rankings-styles.ts` to the Framer project. For
   Framer property controls, use the contents of `ScreenplayRankingsTable.framer.tsx` as the canvas
   component and keep all three files in the same Code folder. If Framer rewrites extensions, keep
   the relative filenames consistent with its generated imports.
2. Drag `FramerScreenplayRankingsTable` onto a duplicate/staging section below the native table.
   Do not remove or hide the native table yet.
3. Set **API URL** to the public backend origin only, for example
   `https://api-staging.loglisted.com` (no `/api/rankings` suffix).
4. Set **Profile Path** to the existing CMS detail-route prefix. The default is `/loglist/`.
5. Set the component width to Fill and height to Fit Content. The Framer canvas shows three sample
   rows; Preview and the published site fetch real published CMS records.
6. Confirm the published Framer origin is present exactly in backend `ALLOWED_ORIGINS`, redeploy the
   backend configuration, then test Preview and the published page.

### Verification

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
```

Also verify manually:

- `/api/rankings` returns JSON and contains no `Email` or token-like values.
- drafts do not appear; a newly published CMS item appears after the cache TTL.
- search matches writer, title, and logline together with format, genre, selected-score minimum,
  direction, and ranking category.
- the Score heading and each displayed score change together.
- 25/50/100 row pagination and URL query restoration work after refresh.
- at mobile width, rows become keyboard-operable native `details` accordions.
- IMDb links win when present; otherwise Professional Website is used. Older records without either value fall back to the existing slug route.

### Framer limitations and rollback

Framer does not expose Collection List records as a supported Code Component array, so this design
requires the backend and Framer Server API availability. Canvas data is illustrative only. Search
and filtering happen in the browser after one sanitized collection fetch; for very large future
collections, move query and pagination parameters server-side.

Rollback is non-destructive: remove or hide the Code Component instance and reveal the untouched
native CMS table. To disable only the JSON reader, set `FRAMER_RANKINGS_ENABLED=false` and redeploy
the backend. This does not disable CMS result synchronization and does not modify CMS records.

# Production Live-Canary Backend (Not Yet Deployed)

The repository includes a separate, fail-closed executable for a small live-provider canary. It
reuses the existing upload, security, parsing, summarization, scoring, result, and deletion APIs;
it does not replace the local mock server or public mock-staging server.

The three modes are intentionally separate:

- Local mock: `npm run dev`
- Public mock staging: `npm run start:staging`
- Live-provider canary/production executable: `npm run start:production`

The live executable refuses to start unless all of these invariants hold:

- `APP_ENV=production`, `NODE_ENV=production`, and `SCREENPLAY_SCORING_MODE=production`
- `LLM_PROVIDER=openai` and `AI_PROVIDER=openai`
- `DRY_RUN=false` and `ALLOW_MOCK_IN_PRODUCTION=false`
- `STORAGE_DRIVER=redis`, with Upstash REST credentials and a cache-encryption key
- current pricing exists for every configured active model
- provider training opt-out has been confirmed by the operator
- the provider privacy review date and terms URL are present
- request-level storage support is explicitly confirmed and request storage is disabled
- PDF/raw-text persistence and all content observability switches remain disabled

The provider adapter applies the documented Responses API request option `store: false` on every
LLM request. This is a request-storage control, not a promise of zero retention or a prompt-based
training prohibition. Account settings, provider terms, contractual retention controls, and any
approved zero-data-retention arrangement must still be reviewed independently.

## Prepare the canary without calling the provider

1. Keep the existing `loglisted-staging-api` service unchanged.
2. Copy `.env.canary.example` into a private password manager or the environment editor of a new,
   separate Render service. Do not commit a populated environment file.
3. Replace every blank secret and placeholder model name. Generate independent signing secrets for
   this service; do not reuse staging values.
4. Replace the zero prices in `MODEL_PRICING_JSON` with current prices from authoritative provider
   documentation. The keys must exactly match all configured model names.
5. Verify the provider project/account training and data-sharing settings, current terms, retention,
   request-storage behavior, and any regional or contractual controls. Only then set
   `AI_PROVIDER_TRAINING_OPT_OUT_CONFIRMED=true` and record the review date/URLs.
6. Configure the dedicated Upstash Redis database and a base64-encoded 32-byte
   `CACHE_ENCRYPTION_KEY`.
7. Configure a dedicated Turnstile widget/secret and exact hostname/action.
8. Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` locally.
9. Optionally validate fail-closed startup with intentionally incomplete placeholder values. Do not
   submit a screenplay and do not use a real provider key during this validation.

`render.canary.yaml` is an optional Blueprint for a **new** service named
`loglisted-live-canary-api`. Automatic deploys are disabled. Its secret values are deliberately
absent. Do not apply that Blueprint to the current mock-staging service.

Expected health output after a future operator-controlled deployment:

```json
{
  "ok": true,
  "environment": "production",
  "scoringMode": "production",
  "llmProvider": "openai",
  "dryRun": false,
  "framerCmsSyncEnabled": false,
  "rankingsEnabled": false
}
```

The health route performs no LLM call and exposes no secrets. A real provider request occurs only
after a browser completes session creation, Turnstile-backed upload authorization, token/file
binding validation, server-side PDF validation, quota checks, Redis-backed capacity admission, PII
redaction, and the existing pipeline reaches an LLM stage.

## Canary rollback

Disable or suspend only the separate live-canary service, remove its Framer/API URL from any test
page, and revoke its dedicated OpenAI key. The local and mock-staging commands and services remain
unchanged. Do not point the production Framer uploader at the canary until an explicitly approved
live test plan has passed.
