# Framer uploader installation

`FramerScreenplayUploader.tsx` is a standard React code component designed for a Framer site. It
does not include accounts, login, email verification, or mandatory professional-credit fields. The
submission form collects a contact name and email plus an optional IMDb name-profile URL; those
fields are private result metadata and never scoring inputs.

## Loglisted visual controls

Use `FramerScreenplayUploader.framer.tsx` as the Framer code-component entry point. It registers
design controls for accent, surface, primary text, muted text, border, radius, maximum width, and
compact mode. The entry point delegates all behavior to `FramerScreenplayUploader.tsx`; it does not
duplicate the uploader flow.

The component imports the reusable files in `styles/`. They use stable `loglisted-uploader` class
names and CSS custom properties rather than generated Framer class names. Add the three CSS files
alongside the component files when installing it in Framer. The local-only page reset is imported
by `src/App.tsx`, not by the Framer component entry point.

## 1. Configure matching domains

Use the same registrable domain for the site and API whenever possible:

```text
Site: https://www.example.com
API:  https://api.example.com
```

Add every exact production and Framer preview origin to the applicable allowlist
(`CORS_ALLOWED_ORIGINS` in production or `ALLOWED_ORIGINS` in public staging). Do not use a
wildcard. Production uses its existing cookie policy. The cross-site staging adapter explicitly
uses `HttpOnly`, `Secure`, and `SameSite=None`; browser third-party-cookie restrictions still make
a same-site custom API domain preferable.

Configure the same production and preview hostnames in the Cloudflare Turnstile widget. The backend
must use `screenplay_upload` as the expected Turnstile action.

In Cloudflare:

1. Open **Turnstile → Add widget**.
2. Add the custom production hostname and every preview hostname that will submit.
3. Choose the managed widget mode.
4. Copy the site key to the Framer component and store the secret key only in backend secrets.
5. Set `TURNSTILE_EXPECTED_ACTION=screenplay_upload`; the component sends that action explicitly.
6. Set `TURNSTILE_EXPECTED_HOSTNAME` to the exact hostname Cloudflare returns. Deploy separate
   backend configurations if production and preview use different expected hostnames.

## 2. Add the code component

In Framer:

1. Open **Assets → Code → New code file**.
2. Add `FramerScreenplayUploader.tsx`, `FramerScreenplayUploader.framer.tsx`, the `styles/`
   directory, and the four adjacent modules: `api-client.ts`, `device-session.ts`, `file-hash.ts`,
   and `types.ts`.
3. Keep those files in the same Framer code-module folder, or update their import paths.
4. Place the default `FramerScreenplayUploader` export on the canvas.
5. Pass the production API base URL and public Turnstile site key.

Example:

```tsx
<FramerScreenplayUploader
  apiBaseUrl="https://api.example.com/"
  turnstileSiteKey="YOUR_PUBLIC_TURNSTILE_SITE_KEY"
  maximumFileSizeMb={15}
  maximumPages={150}
  privacyPolicyUrl="https://www.example.com/privacy"
  acceptableUseUrl="https://www.example.com/acceptable-use"
  accentColor="#6457ff"
  theme="light"
/>
```

The Turnstile site key is public. Never put the Turnstile secret, session signing keys, HMAC keys,
Redis credentials, upload-token key, result-token key, or LLM key in Framer.

## 3. Backend routes

The component expects:

```text
POST /api/session
POST /api/upload-authorize
POST /api/analyze
GET  /api/result/:resultId
```

All browser requests use `credentials: "include"`. `/api/upload-authorize` also sends the in-memory
CSRF token. `/api/analyze` sends the signed upload token as a Bearer token with a multipart `file`
field. Result retrieval sends the scoped result-access token as a Bearer token.

For cached-result authorization, the response must include:

```json
{
  "cachedResultAvailable": true,
  "resultId": "opaque-result-id",
  "resultAccessToken": "opaque-token",
  "uploadToken": null,
  "expiresAt": null
}
```

The result ID is unguessable but is not sufficient for access; the matching anonymous-session
cookie and result-access token are both required.

## 4. Browser behavior

Only a random UUID is persisted in localStorage under `loglisted.anonymous-device.v1`. The CSRF
token stays in React memory, and the anonymous session ID remains inside the HTTP-only cookie.

The component:

- validates PDF type and configured size;
- checks the `%PDF-` signature;
- calculates SHA-256 locally with progress;
- estimates page count where the PDF structure makes that practical;
- shows a non-blocking warning when browser inspection cannot confirm readable text;
- resets Turnstile after every authorization attempt;
- never sends security scores or browser-derived identity fields;
- renders only the ten public category scores and overall score.

Client checks improve usability only. The API must independently repeat all security, size,
signature, hash, quota, and PDF readability checks.

## 5. Preview and production verification

Test from both the published custom domain and the exact Framer preview domain:

1. A new browser establishes a session.
2. Reloading preserves the device UUID but creates no account.
3. Turnstile resets after authorization.
4. An expired authorization asks the visitor to retry.
5. Cached and new results both render.
6. Cross-origin requests from an unlisted domain fail.
7. Clearing cookies prevents retrieval until a valid session/result token pair is restored.

The component intentionally does not display risk scores, IP/device limits, token costs, confidence,
model disagreement, or internal security rules.

The required AI-processing acknowledgement explains that selected screenplay portions are sent to
a third-party AI provider and qualifies the no-training statement by current terms and technical
controls. Do not replace it with an absolute promise about training, third-party access, or
retention. The backend records only policy/notice versions and confirmation time, not identity.
