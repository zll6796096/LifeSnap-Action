# LifeSnap Action

**Turn paper notices into phone calendar events.**

Snap a photo of a school notice, invoice, or appointment letter → AI extracts the event details → confirm and add to your iOS calendar.

## Architecture

```
┌─────────────┐      POST /api/extract      ┌──────────────┐
│  iOS App    │ ──── multipart image ──────▶ │ Cloud Run    │
│  (SwiftUI)  │ ◀─── JSON extraction ────── │ Express API  │
│             │                              │              │
│  EventKit ──┼──▶ iOS System Calendar       │ Gemini API ──┼──▶ Google AI
└─────────────┘                              └──────────────┘
```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/healthz` | GET | Health check |
| `/privacy` | GET | Public privacy policy for App Store review and in-app link |
| `/api/extract` | POST | Extract event data from image |

### `POST /api/extract`

Accepts `multipart/form-data` with an `image` field (JPEG, PNG, or WebP, max 10 MB).

Also accepts JSON body with `{ image: "<base64>", mimeType: "image/jpeg" }` for backward compatibility.

**Response:**
```json
{
  "route": "calendar_action",
  "title": "保護者会",
  "start_datetime": "2026-10-25T14:00",
  "end_datetime": "2026-10-25T15:00",
  "location": "体育館",
  "summary": "...",
  "confidence": 0.92,
  "calendar_event": {
    "title": "保護者会",
    "start": "2026-10-25T14:00",
    "end": "2026-10-25T15:00",
    "description": "...",
    "location": "体育館"
  }
}
```

Routes: `calendar_action` | `needs_review` | `no_action_detected`

## Development

```bash
cp .env.example .env
# Add your GEMINI_API_KEY

npm install
npm run dev       # Start dev server on :8080
npm test          # Run tests
npm run build     # Build for production
npm run lint      # TypeScript type check
```

## Deploy to Cloud Run

Production must inject `GEMINI_API_KEY` on the backend only. Do not put the key in
the iOS app or commit it to source control.

```bash
gcloud services enable secretmanager.googleapis.com

printf '%s' "$GEMINI_API_KEY" | gcloud secrets create lifesnap-gemini-api-key \
  --data-file=- \
  --replication-policy=automatic

gcloud run deploy lifesnap-action \
  --source . \
  --region asia-northeast1 \
  --set-secrets GEMINI_API_KEY=lifesnap-gemini-api-key:latest \
  --set-env-vars NODE_ENV=production,MOCK_MODE=false
```

Production must use a paid Gemini API project/key with billing enabled. `MOCK_MODE`
is development-only and the server exits if it is enabled with `NODE_ENV=production`.
Remove any unused OAuth/client-login environment variables from Cloud Run before
release; LifeSnap Action v1.0 does not use Google login.

The Gemini call uses inline image data only for the extraction request. This
backend does not configure Google Search grounding, Maps grounding, File API
persistent upload, `cached_content`, or stateful Interactions storage.

## iOS App

The iOS app is in the `ios/` directory. See [ios/README.md](ios/README.md) for setup instructions.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | — | Backend-held Gemini API key |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini model name |
| `PORT` | No | `8080` | Server port |
| `MOCK_MODE` | No | `false` | Use mock data in dev only; forbidden when `NODE_ENV=production` |

## Privacy and Logging

Selected images are sent to the LifeSnap backend and Gemini API only for
calendar-action extraction. LifeSnap does not intentionally store original
images.

Production logs must not include image bytes, base64 payloads, OCR/full extracted
text, full personal data, addresses, amounts, or request bodies. Keep any future
logging limited to route/status/error metadata.

## License

Private
