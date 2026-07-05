# LifeSnap Action v1.0 TestFlight Release Gate

Date: 2026-07-05

## Scope

This gate prepares LifeSnap Action for TestFlight upload only. It does not submit the app for public App Store Review.

Approved product flow remains Scan -> Confirm -> Schedule.

Out of scope: account system, Google login, dashboard, document archive, history center, cloud sync, payment/subscription, Android, OpenAI migration, App Store Review submission, and any core-flow change.

## Decision

Final TestFlight upload status: **NO-GO**.

Backend release gate: **PASS**. Gemini credits are now effective for the Secret Manager-backed key, candidate extraction passed, and Cloud Run live traffic was moved to the secret-backed candidate revision.

Apple/TestFlight gate: **BLOCKED_BY_APPLE_ID_VERIFICATION**. The user has paid the Apple Developer Program fee and uploaded identity documents, but Apple identity verification is still pending. Local signing evidence also remains insufficient for TestFlight: `altool` could not list providers in the current CLI auth context, and the keychain has only an Apple Development identity, not an Apple Distribution identity. No exportArchive retry was run.

## Required Output Summary

| Required item | Result | Evidence |
|---|---|---|
| Files changed | PASS | Verification run changed only `docs/release/lifesnap-v1.0-app-store-release-gate.md`; the follow-up GitHub PR also packages backend/privacy/App Store docs and excludes Apple signing/export metadata |
| Gemini direct text-only result | PASS | HTTP 200, `finishReason=STOP`, `modelVersion=gemini-2.5-flash` |
| Gemini direct tiny-image result | PASS | HTTP 200, `modelVersion=gemini-2.5-flash` |
| Candidate `/health` | PASS | HTTP 200 |
| Candidate `/privacy` | PASS | HTTP 200 |
| Candidate invalid upload | PASS | HTTP 400 |
| Candidate oversized upload | PASS | HTTP 400 |
| Candidate exact `/healthz` | NON-APP-STORE-CRITICAL | HTTP 404 from Google Frontend; not a cutover blocker because `/health` and `/privacy` pass |
| Candidate `/api/extract` | PASS | HTTP 200 with structured `no_action_detected` response |
| Cloud Run live cutover | PASS | 100% live traffic routed to `lifesnap-action-00029-yed` |
| Live `/health` | PASS | HTTP 200 |
| Live `/privacy` | PASS | HTTP 200 |
| Live `/api/extract` | PASS | HTTP 200 with structured `no_action_detected` response |
| Old plain-env revision serving live traffic | PASS | `lifesnap-action-00025-tq6` is no longer in live traffic |
| Apple signing status | BLOCKED_BY_APPLE_ID_VERIFICATION | Provider listing did not pass in current CLI auth context; no Apple Distribution identity installed |
| Final TestFlight upload | NO-GO | Apple identity verification and App Store Connect distribution export are not confirmed |

No API key values, image bytes, OCR full text, names, addresses, private document contents, or full extraction payloads were logged into this document.

## Cloud Run and Secret Manager Gate

Google Cloud project: `zhang23-23` (`projects/788259830737`)

| Item | Status | Evidence |
|---|---|---|
| Secret Manager key readable | PASS | `gcloud secrets versions access latest --secret=lifesnap-gemini-api-key --project zhang23-23` returned a nonempty value; value was not printed |
| Secret-backed Gemini text generateContent | PASS | HTTP 200, `finishReason=STOP`, `modelVersion=gemini-2.5-flash` |
| Secret-backed Gemini tiny-image generateContent | PASS | HTTP 200, `modelVersion=gemini-2.5-flash` |
| Candidate revision | PASS | `lifesnap-action-00029-yed` |
| Candidate URL | PASS | `https://candidate---lifesnap-action-sxielk4wua-an.a.run.app` |
| Candidate revision secret-backed key | PASS | `GEMINI_API_KEY` is from Secret Manager |
| Candidate revision removed `GOOGLE_CLIENT_ID` | PASS | Candidate env has no `GOOGLE_CLIENT_ID` |
| Candidate `/health` | PASS | HTTP 200 |
| Candidate `/privacy` | PASS | HTTP 200 |
| Candidate invalid upload | PASS | HTTP 400 |
| Candidate oversized upload | PASS | HTTP 400 |
| Candidate exact `/healthz` | NON-APP-STORE-CRITICAL | HTTP 404 from Google Frontend |
| Candidate `/api/extract` | PASS | HTTP 200, structured `no_action_detected` response |
| Live traffic cutover | PASS | 100% routed to `lifesnap-action-00029-yed` |
| Live production URL | PASS | `https://lifesnap-action-sxielk4wua-an.a.run.app` |
| Live `/health` | PASS | HTTP 200 |
| Live `/privacy` | PASS | HTTP 200 |
| Live `/api/extract` | PASS | HTTP 200, structured `no_action_detected` response |
| Old live revision removed from traffic | PASS | `lifesnap-action-00025-tq6` is no longer in service traffic |
| Old revision plain env risk | CONTAINED | Old revision still has plain `GEMINI_API_KEY` and `GOOGLE_CLIENT_ID`, but receives 0% live traffic |

Current live/candidate environment state, sanitized:

| Revision | Traffic | Key state |
|---|---:|---|
| `lifesnap-action-00029-yed` | 100% live, tag `candidate` | `GEMINI_API_KEY` comes from Secret Manager; no `GOOGLE_CLIENT_ID` |
| `lifesnap-action-00025-tq6` | 0% live | Plain `GEMINI_API_KEY` and plain `GOOGLE_CLIENT_ID` remain on the old revision only |

## Apple Developer and Signing Gate

| Item | Status | Evidence |
|---|---|---|
| Apple Developer Program fee | PASS REPORTED | User reports fee completed |
| Apple identity verification | BLOCKED_BY_APPLE_ID_VERIFICATION | User reports identity documents were uploaded and Apple approval is pending |
| Provider visibility from local CLI | BLOCKED | `xcrun altool --list-providers --output-format xml` exited 1 because JWT or username/app-password authentication was required in the current CLI context |
| Installed signing identities | FAIL FOR TESTFLIGHT | `security find-identity -v -p codesigning` found one valid Apple Development identity and no Apple Distribution identity |
| App Store Connect app record | NOT RECHECKED | Provider/account gate is not ready |
| Explicit App ID | NOT RECHECKED | Provider/account gate is not ready |
| Apple Distribution certificate | FAIL FOR TESTFLIGHT | No Apple Distribution identity installed locally |
| App Store Connect provisioning profile | NOT RECHECKED | Provider/account gate is not ready |
| Archive/export | SKIPPED | No export retry because identity verification/provider/distribution signing prerequisites are not met |

TestFlight remains **NO-GO** until Apple identity verification completes, provider access is visible, Apple Distribution signing exists, and an App Store Connect export succeeds with distribution signing.

## Exact Commands Run

Secret-backed Gemini direct checks:

```bash
KEY="$(gcloud secrets versions access latest --secret=lifesnap-gemini-api-key --project zhang23-23)"

curl -sS -o "$RUN_DIR/text-response.json" -w '%{http_code}' \
  -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: ${KEY}" \
  --data-binary "@$RUN_DIR/text-body.json"

curl -sS -o "$RUN_DIR/image-response.json" -w '%{http_code}' \
  -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: ${KEY}" \
  --data-binary "@$RUN_DIR/image-body.json"
```

Candidate backend checks:

```bash
curl -sS -L -o "$RUN_DIR/health.json" -w '%{http_code}' \
  "https://candidate---lifesnap-action-sxielk4wua-an.a.run.app/health"

curl -sS -L -o "$RUN_DIR/privacy.html" -w '%{http_code}' \
  "https://candidate---lifesnap-action-sxielk4wua-an.a.run.app/privacy"

curl -sS -L -o "$RUN_DIR/healthz.body" -w '%{http_code}' \
  "https://candidate---lifesnap-action-sxielk4wua-an.a.run.app/healthz"

curl -sS -o "$RUN_DIR/invalid.json" -w '%{http_code}' \
  -X POST "https://candidate---lifesnap-action-sxielk4wua-an.a.run.app/api/extract"

dd if=/dev/zero of="$RUN_DIR/oversized.jpg" bs=1m count=11

curl -sS -o "$RUN_DIR/oversized.json" -w '%{http_code}' \
  -X POST "https://candidate---lifesnap-action-sxielk4wua-an.a.run.app/api/extract" \
  -F "image=@${RUN_DIR}/oversized.jpg;type=image/jpeg"

curl -i -sS -X POST \
  -F "image=@test-assets/receipt.png" \
  "https://candidate---lifesnap-action-sxielk4wua-an.a.run.app/api/extract" \
  > "$RUN_DIR/extract-raw.http"
```

Cloud Run traffic cutover and live checks:

```bash
gcloud run services update-traffic lifesnap-action \
  --project zhang23-23 \
  --region asia-northeast1 \
  --to-revisions lifesnap-action-00029-yed=100 \
  --quiet

gcloud run services describe lifesnap-action \
  --project zhang23-23 \
  --region asia-northeast1 \
  --format='json(status.traffic,status.url,status.latestCreatedRevisionName)'

curl -sS -L -o "$RUN_DIR/health.json" -w '%{http_code}' \
  "https://lifesnap-action-sxielk4wua-an.a.run.app/health"

curl -sS -L -o "$RUN_DIR/privacy.html" -w '%{http_code}' \
  "https://lifesnap-action-sxielk4wua-an.a.run.app/privacy"

curl -sS -o "$RUN_DIR/extract.json" -w '%{http_code}' \
  -X POST "https://lifesnap-action-sxielk4wua-an.a.run.app/api/extract" \
  -F "image=@test-assets/receipt.png;type=image/jpeg"

gcloud run revisions describe lifesnap-action-00025-tq6 \
  --project zhang23-23 \
  --region asia-northeast1 \
  --format=json

gcloud run revisions describe lifesnap-action-00029-yed \
  --project zhang23-23 \
  --region asia-northeast1 \
  --format=json
```

The revision describe outputs were sanitized before review/documentation so no plain env values were copied.

Apple signing check:

```bash
xcrun altool --list-providers --output-format xml
security find-identity -v -p codesigning
```

## Verification Evidence

| Check | Result |
|---|---|
| Secret Manager key access | PASS, nonempty key read into shell variable only |
| Direct Gemini text-only generateContent | PASS, HTTP 200 |
| Direct Gemini tiny-image generateContent | PASS, HTTP 200 |
| Candidate `/health` | PASS, HTTP 200 |
| Candidate `/privacy` | PASS, HTTP 200 |
| Candidate invalid upload | PASS, HTTP 400 |
| Candidate oversized upload | PASS, HTTP 400 |
| Candidate `/api/extract` exact multipart curl | PASS, HTTP 200, structured `no_action_detected` |
| Cloud Run traffic update | PASS, 100% `lifesnap-action-00029-yed` |
| Live `/health` | PASS, HTTP 200 |
| Live `/privacy` | PASS, HTTP 200 |
| Live `/api/extract` | PASS, HTTP 200, structured `no_action_detected` |
| Service traffic describe | PASS, only `lifesnap-action-00029-yed` receives 100% traffic |
| Old revision env audit | PASS WITH CAVEAT, old plain env values remain but old revision is not live |
| Candidate revision env audit | PASS, `GEMINI_API_KEY` is Secret Manager-backed and `GOOGLE_CLIENT_ID` absent |
| `xcrun altool --list-providers --output-format xml` | BLOCKED, current CLI auth context requires JWT or username/app-password authentication |
| `security find-identity -v -p codesigning` | FAIL FOR TESTFLIGHT, one Apple Development identity and no Apple Distribution identity |

## Release Test Matrix

| Case | Expected result | Status |
|---|---|---|
| Backend health | Production `/health` returns 200 | PASS |
| Privacy policy URL | Production `/privacy` returns 200 | PASS |
| Invalid upload | Backend returns 400 without leaking internals | PASS |
| Oversized upload | Backend returns 400 without leaking internals | PASS |
| Successful extraction path | Backend returns structured route response | PASS, `no_action_detected` on tested receipt image |
| Old plain-env revision not live | Old revision receives 0% traffic | PASS |
| Install TestFlight build | App installs with final icon and launch screen | BLOCKED BY APPLE IDENTITY/SIGNING |
| First launch | Capture screen appears without account/login | PENDING TESTFLIGHT |
| Camera permission | Camera opens; permission copy is specific | PENDING DEVICE |
| Photo permission | Photos picker opens; permission copy is specific if prompted | PENDING DEVICE |
| Calendar permission | Calendar write prompt appears; denial path is clear | PENDING DEVICE |
| `calendar_action` extraction | Review screen shows event and can create calendar event | PENDING DEVICE/TESTFLIGHT |
| `needs_review` extraction | Needs-review screen appears for ambiguous extraction | PENDING DEVICE/TESTFLIGHT |
| `no_action_detected` extraction | No-action screen appears | BACKEND PASS, PENDING DEVICE/TESTFLIGHT |

## Remaining TestFlight Blockers

1. Apple identity verification is still pending after document upload.
2. Provider visibility was not confirmed from the current CLI context.
3. No Apple Distribution identity is installed locally.
4. App Store Connect app record, explicit App ID, App Store provisioning profile, and app-store-connect export were not rechecked because the provider/signing gate is not ready.

Known non-critical issue: candidate exact `/healthz` returns HTTP 404 from Google Frontend, while `/health` and `/privacy` pass. This is not an App Store/TestFlight hard blocker per the current release rule.

## Next Required Actions

1. Wait for Apple identity verification approval.
2. After approval, run a single provider/signing recheck with authenticated App Store Connect access.
3. Confirm the App Store Connect app record, explicit App ID, Apple Distribution certificate, and App Store Connect provisioning profile for `com.zll.lifesnapaction`.
4. Only then run archive/export with `method=app-store-connect` and confirm distribution signing.
5. Keep TestFlight upload as NO-GO until that export succeeds.
