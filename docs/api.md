# API reference

All routes require an exact allowed `Origin`. Cookies use `Secure`, `HttpOnly`, and `SameSite=Lax`.
Error bodies are intentionally generic.

## POST `/api/session`

Headers: `Content-Type: application/json`

```json
{ "deviceId": "019f9e5d-0710-7220-a1d2-8bb230517924" }
```

`201 Created` sets the anonymous-session cookie:

```json
{
  "csrfToken": "opaque-token",
  "sessionExpiresAt": "2026-08-02T12:00:00.000Z"
}
```

## POST `/api/upload-authorize`

Requires the session cookie, `X-CSRF-Token`, `Content-Type: application/json`, and a fresh
Turnstile token.

```json
{
  "turnstileToken": "opaque-cloudflare-token",
  "deviceId": "019f9e5d-0710-7220-a1d2-8bb230517924",
  "fileHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "fileSize": 245760,
  "fileName": "pilot.pdf",
  "mimeType": "application/pdf",
  "project": {
    "projectTitle": "Example Pilot",
    "format": "halfHourPilot",
    "primaryGenre": "Comedy",
    "secondaryGenres": ["Drama"],
    "approximatePageCount": 32,
    "logline": "",
    "originalWorkConfirmed": true,
    "uploadRightsConfirmed": true,
    "privacyTermsAccepted": true,
    "acceptableUseAccepted": true
  },
  "antiBot": {
    "website_confirm": "",
    "formMountedAt": "2026-07-26T12:00:00.000Z",
    "fileSelectedAt": "2026-07-26T12:00:03.000Z",
    "formSubmittedAt": "2026-07-26T12:00:04.000Z"
  }
}
```

New analysis:

```json
{
  "uploadToken": "signed-single-use-token",
  "expiresAt": "2026-07-26T12:05:04.000Z",
  "cachedResultAvailable": false,
  "resultAccessToken": null
}
```

Same-session cached result:

```json
{
  "uploadToken": null,
  "expiresAt": null,
  "cachedResultAvailable": true,
  "resultId": "8be77991-3bfd-43fd-a148-e18f0d6dba70",
  "resultAccessToken": "opaque-result-token"
}
```

## POST `/api/analyze`

Requires the session cookie, `Authorization: Bearer <uploadToken>`, and
`Content-Type: multipart/form-data`. The multipart field name is `file`.

```sh
curl -X POST https://api.example.com/api/analyze \
  -H 'Origin: https://www.example.com' \
  -H 'Authorization: Bearer TOKEN' \
  -b 'loglisted_session=COOKIE' \
  -F 'file=@pilot.pdf;type=application/pdf'
```

```json
{
  "resultId": "8be77991-3bfd-43fd-a148-e18f0d6dba70",
  "resultAccessToken": "opaque-result-token",
  "deletionToken": "opaque-deletion-token",
  "categoryScores": {
    "premise": 7.1,
    "story": 6.9,
    "structure": 7.2,
    "characters": 7.0,
    "dialogue": 7.4,
    "pacing": 6.8,
    "theme": 6.7,
    "tone": 7.3,
    "marketability": 6.9,
    "craft": 7.2
  },
  "overallScore": 7.1
}
```

Development mock responses additionally contain `"evaluationMode": "mock"`.

## GET `/api/result/:resultId`

Requires the matching session cookie and `Authorization: Bearer <resultAccessToken>`.

```json
{
  "projectTitle": "Example Pilot",
  "declaredFormat": "halfHourPilot",
  "declaredGenre": "Comedy",
  "categoryScores": {
    "premise": 7.1,
    "story": 6.9,
    "structure": 7.2,
    "characters": 7.0,
    "dialogue": 7.4,
    "pacing": 6.8,
    "theme": 6.7,
    "tone": 7.3,
    "marketability": 6.9,
    "craft": 7.2
  },
  "overallScore": 7.1,
  "completedAt": "2026-07-26T12:01:30.000Z"
}
```

The route never returns risk, IP/device data, usage, cost, confidence, disagreement, raw text, or
internal metadata.

## DELETE `/api/result/:resultId`

Requires the matching session cookie and `Authorization: Bearer <deletionToken>`. Success returns
`204 No Content`. It deletes the result, approved project metadata, and file-scoped cached
artifacts. Bounded abuse/deduplication records may remain under their security retention policy.

## GET `/api/privacy-status`

Disabled by default and not part of the public Framer API. When enabled, it requires
`Authorization: Bearer <PRIVACY_STATUS_ADMIN_SECRET>`. Disabled and unauthorized requests both
return `404`.

## Errors

Errors use `{ "error": { "code": "...", "message": "..." } }`. Clients must branch primarily on
HTTP status and must not depend on internal security reasons. Expected statuses include `400`,
`403`, `409`, `415`, `422`, `429`, `502`, and `503`.
