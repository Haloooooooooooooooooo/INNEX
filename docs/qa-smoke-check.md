# QA Smoke Check

## Purpose
- Run a one-command pre-release check for AI QA core paths:
  - session create
  - notes mode QA
  - online mode QA
  - session messages
  - qa metrics

## Script
- Path: `apps/web/scripts/qa-smoke-check.mjs`
- NPM command: `npm run qa:smoke`

## Required Environment Variables
- `QA_SMOKE_BASE_URL` (e.g. `http://localhost:3000`)
- `QA_SMOKE_AUTH_HEADER` (e.g. `cookie` or `authorization`)
- `QA_SMOKE_AUTH_VALUE` (auth value for logged-in user context)

Optional:
- `QA_SMOKE_TIMEOUT_MS` (default `30000`)

## Example (PowerShell)
```powershell
$env:QA_SMOKE_BASE_URL="http://localhost:3000"
$env:QA_SMOKE_AUTH_HEADER="cookie"
$env:QA_SMOKE_AUTH_VALUE="sb-access-token=YOUR_TOKEN; sb-refresh-token=YOUR_REFRESH"
npm run qa:smoke
```

## Pass Criteria
- Script exits with code `0`
- Console includes:
  - `[ok] create session`
  - `[ok] notes qa response shape`
  - `[ok] online qa response shape`
  - `[ok] session messages`
  - `[ok] qa metrics shape`
  - `[qa:smoke] PASS`

## Failure Handling
- Script exits with code `1`
- Check the failing step message and corresponding API route logs.
