# Public mock staging deployment

## Purpose and isolation boundary

The staging backend is a public HTTPS test surface for the existing Framer uploader. It executes
the real admission, PDF extraction, parsing, chunking, caching, orchestration, result-access, and
deletion paths, but returns deterministic mock summaries and scores. Those scores are not genuine
screenplay evaluations.

Staging is deliberately separate from production:

- `APP_ENV=staging` and `SCREENPLAY_SCORING_MODE=mock` are both mandatory.
- Zod rejects `SCREENPLAY_SCORING_MODE=production` before the server starts.
- `src/staging-server.ts` imports `MockLlmProvider` directly. It does not import the OpenAI adapter
  or the general provider factory.
- `OPENAI_API_KEY` is not declared in `render.yaml` or `.env.staging.example`. If a host-level key
  is accidentally present, the staging executable ignores it.
- startup emits `APP_ENV=staging`, `SCREENPLAY_SCORING_MODE=mock`, and
  `Production scoring disabled`.
- staging uses only in-memory cache, abuse, lock, nonce, and result stores.
- PDFs remain in request memory. Both the Multer buffer and its analysis copy are overwritten after
  the request, and neither raw PDFs nor raw extracted text is persisted.

Do not run `staging-server.ts` as a production service. Production continues to use its existing
validated configuration, Redis-backed stores, provider privacy checks, and provider adapter.

## Why Render

Render Web Services are the least disruptive fit for the existing Express/Node 22 development
adapter. The service can run the compiled server without converting APIs to a new framework or
edge runtime, provides HTTPS and an `onrender.com` hostname, understands `render.yaml`, and supports
health checks. Vercel Functions' documented request/response body limit is below this application's
15 MiB PDF limit; a Cloudflare Workers deployment would require a more substantial runtime and
state adaptation.

The Render free tier is suitable only for temporary testing. Free services sleep after inactivity,
can take roughly a minute to wake, use an ephemeral filesystem, and provide no durable in-memory
state across restarts or multiple instances.

## Localhost development (unchanged)

```sh
cp .env.local.example .env.local
npm install
npm run dev
```

Open `http://localhost:5173`. This continues to start the existing frontend on port 5173 and
development backend on port 3000. Development upload quotas remain disabled only in the local
development server.

## Run staging locally

```sh
cp .env.staging.example .env.staging
```

Replace the placeholder origins, expected Turnstile hostnames, and all seven independent staging
secrets. Then run:

```sh
npm install
npm run dev:staging
```

Check:

```sh
curl http://localhost:10000/health
```

Expected:

```json
{ "ok": true, "environment": "staging", "scoringMode": "mock" }
```

The watch command is for local verification only. The deployed start command is:

```sh
npm ci --include=dev
npm run build
npm run start:staging
```

## Render deployment

No deployment is performed automatically by this repository change. `autoDeployTrigger: off`
also prevents later Git pushes from silently replacing the reviewed staging build.

1. Commit and push the reviewed changes to a dedicated staging branch.
2. Sign in to Render and choose **New → Blueprint**.
3. Select this repository and the staging branch. Render reads the root `render.yaml`.
4. Supply every environment value marked `sync: false`.
5. Review the plan, create the Blueprint, and manually start the deploy.
6. In the service page, copy the **External URL**.

Render runs these exact commands:

```sh
npm ci --include=dev && npm run build
npm run start:staging
```

Optionally validate the Blueprint first with the Render CLI:

```sh
render blueprints validate render.yaml
```

The expected public URL format is:

```text
https://<render-service-name>.onrender.com
```

With the default service name, try:

```text
https://loglisted-staging-api.onrender.com
```

Render may assign another suffix if that name is unavailable. The exact value to paste into the
Framer component's **API URL** property is the service's External URL, without `/api`, for example:

```text
https://loglisted-staging-api.onrender.com
```

The component appends `/api/session`, `/api/upload-authorize`, `/api/analyze`, and result paths.

## Required staging environment

| Variable                       | Required staging value or guidance                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `APP_ENV`                      | Exactly `staging`.                                                                  |
| `SCREENPLAY_SCORING_MODE`      | Exactly `mock`.                                                                     |
| `NODE_ENV`                     | `production` on Render. This does not enable production scoring.                    |
| `HOST`                         | `0.0.0.0`.                                                                          |
| `PORT`                         | Supplied by Render; use `10000` locally.                                            |
| `ALLOWED_ORIGINS`              | Comma-separated exact localhost and published Framer origins; never `*`.            |
| `MOCK_LLM_SCENARIO`            | A named deterministic fixture such as `successful_pilot`.                           |
| `DRY_RUN`                      | `true`.                                                                             |
| `TURNSTILE_MODE`               | `managed` for public abuse protection; `test` only for an explicitly public demo.   |
| `TURNSTILE_SITE_KEY`           | Staging widget's public site key.                                                   |
| `TURNSTILE_SECRET_KEY`         | Staging widget's backend-only secret.                                               |
| `TURNSTILE_EXPECTED_HOSTNAMES` | Comma-separated exact Framer hostnames returned by Turnstile.                       |
| `TURNSTILE_EXPECTED_ACTION`    | Exactly `screenplay_upload`.                                                        |
| seven signing/HMAC secrets     | Independent random values of at least 32 characters; never reuse production values. |
| `STORAGE_DRIVER`               | Exactly `memory`.                                                                   |
| `RAW_PDF_PERSISTENCE_ENABLED`  | Exactly `false`.                                                                    |
| `RAW_TEXT_PERSISTENCE_ENABLED` | Exactly `false`.                                                                    |
| `MAX_PDF_BYTES`                | At most `15728640` (15 MiB).                                                        |
| `MAX_PDF_PAGES`                | At most `150`.                                                                      |
| quota/rate variables           | Positive staging limits; defaults are in `.env.staging.example`.                    |
| `TRUST_PROXY_HOPS`             | `1` for Render's public proxy path; confirm if the host topology changes.           |

Never set a production AI key, Redis credential, production signing secret, or production
Turnstile secret in staging.

## Turnstile

### Managed staging widget (recommended)

Create a dedicated Turnstile widget, add the exact Framer staging/published hostname, put its public
site key in the Framer property, and put its secret only in Render. Set `TURNSTILE_MODE=managed`.
The backend sends every token to Cloudflare Siteverify and checks success, hostname, action, and
single use.

### Explicit test mode

Set `TURNSTILE_MODE=test` and use Cloudflare's published always-pass test keys from
`.env.staging.example`. The backend validates a nonempty test token locally, still consumes it once,
and makes no Siteverify request. This is intentionally labeled test mode and does **not** provide
meaningful bot resistance. The staging schema rejects other keys in test mode and rejects the test
secret in managed mode. Production behavior is unchanged.

## CORS, cookies, and Framer

Example:

```env
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://my-site.framer.website
TURNSTILE_EXPECTED_HOSTNAMES=my-site.framer.website
```

The Express CORS adapter supports `OPTIONS`, credentials, and only `GET`, `POST`, `DELETE`, and
`OPTIONS`, plus the headers needed by the existing client. It returns the matching configured
origin; it never sends `Access-Control-Allow-Origin: *`.

Staging session cookies use `Secure; HttpOnly; SameSite=None` because the default Framer and Render
hostnames are cross-site. Browser third-party-cookie controls can still block these cookies. A
custom staging API hostname sharing the Framer site's registrable domain is the most reliable
setup. Localhost keeps its existing cookie and development behavior.

## Verification checklist

- [ ] `/health` returns HTTP 200 and exactly identifies staging/mock mode.
- [ ] Startup logs contain the three mock-only safety lines.
- [ ] Render has no `OPENAI_API_KEY` or production provider credential.
- [ ] Changing `SCREENPLAY_SCORING_MODE` to `production` causes startup failure.
- [ ] The Framer API URL contains only the HTTPS origin, not `/api`.
- [ ] `ALLOWED_ORIGINS` includes the exact published Framer origin and no wildcard.
- [ ] An unlisted origin receives no CORS access.
- [ ] The Framer Turnstile site key and backend staging secret belong to the same staging widget.
- [ ] A text-based PDF between 25 and 150 pages and no larger than 15 MiB produces ten scores plus
      an overall score.
- [ ] The response is visibly identified as mock in development/staging UI behavior.
- [ ] A duplicate request reuses or rejects work without duplicate provider work.
- [ ] No screenplay text, PDF bytes, tokens, cookies, prompts, or results appear in logs.
- [ ] Restarting the service removes in-memory results.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass.

## Rollback

Render keeps deployment history. To roll back, open the service's **Deploys** page, select the last
known-good deployment, and choose **Rollback**. Render disables automatic deploys for that rollback.
Recheck the health endpoint and staging-mode startup lines afterward.

For immediate containment, suspend the staging service or remove its public Framer origin from
`ALLOWED_ORIGINS`. Rotate all staging signing/HMAC and Turnstile secrets before restoring traffic
if credentials may have been exposed. Never substitute production secrets during recovery.

## Remaining staging limitations

- Memory stores are process-local. Restarts, free-tier sleep, deploys, or horizontal instances lose
  sessions, nonces, rate windows, caches, and results.
- Process-local rate limiting is basic abuse protection, not a distributed production control.
- Cross-site cookies can be blocked by browser privacy settings.
- Free-tier cold starts may cause the first request to time out in the Framer UI.
- Test Turnstile mode is not bot protection; use a managed staging widget for a public link.
- Mock fixture scores must never be represented as real screenplay evaluations.
