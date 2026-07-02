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

```bash
gcloud run deploy lifesnap-action \
  --source . \
  --region asia-northeast1 \
  --set-env-vars GEMINI_API_KEY=your-key
```

## iOS App

The iOS app is in the `ios/` directory. See [ios/README.md](ios/README.md) for setup instructions.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | — | Google AI Studio API key |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini model name |
| `PORT` | No | `8080` | Server port |
| `MOCK_MODE` | No | `false` | Use mock data in dev (requires NODE_ENV ≠ production) |

## License

Private
