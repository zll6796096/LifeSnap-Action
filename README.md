# LifeSnap Action

**紙のお知らせを、カレンダーへ。**

Scan paper documents (school notices, invoices, appointment confirmations) with your camera or photo library. Gemini AI extracts event details, you review and confirm, and the event is created directly in your Google Calendar via the Calendar API.

## How It Works

```
📷 Scan → 🤖 Gemini Extraction → 👀 User Review → 📅 Calendar API → ✅ Done
```

1. **Scan** — Take a photo or upload an image of a paper document
2. **AI Extraction** — Gemini analyzes the image and extracts event details (title, date, time, location, etc.)
3. **Review & Edit** — Review the extracted information, edit if needed
4. **Create Event** — Confirm to create the event in your Google Calendar via Calendar API
5. **Success** — See the created event with a direct link to open it

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Tailwind CSS v4, Framer Motion |
| Backend | Express.js, Node.js |
| AI | Gemini 2.5 Flash (structured output) |
| Calendar | Google Calendar API (`events.insert`) |
| Auth | Google Identity Services (Sign-In + Calendar OAuth) |
| Validation | Zod (runtime schema validation) |
| Testing | Vitest |
| Deployment | Docker, Cloud Run |

## Prerequisites

- Node.js 20+
- A Google Cloud project with:
  - **Gemini API key** from [AI Studio](https://aistudio.google.com/)
  - **OAuth 2.0 Client ID** (Web application) from [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
  - **Google Calendar API** enabled

## Setup

1. **Clone and install**
   ```bash
   git clone https://github.com/zll6796096/LifeSnap-Action.git
   cd LifeSnap-Action
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your values:
   ```env
   GEMINI_API_KEY=your-gemini-api-key
   GOOGLE_CLIENT_ID=your-oauth-client-id
   GOOGLE_CLIENT_SECRET=your-oauth-client-secret
   GEMINI_MODEL=gemini-2.5-flash
   MOCK_MODE=false
   ```
   *   `GEMINI_MODEL`: The specific Gemini model version to use for extraction.
   *   `MOCK_MODE`: If set to `true`, the API returns mock data instead of calling the live Gemini API (useful for testing UI/UX).

3. **Configure OAuth Client**
   - Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
   - Create or edit an OAuth 2.0 Client ID (Web application)
   - Add **Authorized JavaScript Origins**: `http://localhost:8080`
   - Add **Authorized Redirect URIs**: `http://localhost:8080` (for production, add your Cloud Run URL)
   - Enable the **Google Calendar API** in [APIs & Services](https://console.cloud.google.com/apis/library)

4. **Run locally**
   ```bash
   npm run dev
   ```
   Open [http://localhost:8080](http://localhost:8080)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Health check. Returns `{ status: "ok" }` |
| `GET` | `/api/config` | Frontend configuration (client ID) |
| `POST` | `/api/auth/google` | Verify Google ID token |
| `POST` | `/api/auth/google/calendar` | Exchange OAuth code for Calendar access token |
| `POST` | `/api/extract` | Extract event details from image using Gemini |
| `POST` | `/api/create-calendar-event` | Create Google Calendar event via API |

### POST `/api/extract`

Accepts a base64 encoded image and returns structured extraction:

```json
{
  "route": "calendar_action | needs_review | no_action_detected",
  "document_type": "school_notice",
  "task_type": "event",
  "title": "保護者会",
  "start_datetime": "2026-07-15T14:00",
  "end_datetime": "2026-07-15T15:30",
  "amount": 0,
  "issuer": "〇〇小学校",
  "location": "体育館",
  "summary": "7月の保護者会。スリッパ持参。",
  "confidence": 0.92,
  "risk_flags": [],
  "calendar_event": { "title": "...", "start": "...", "end": "...", "description": "...", "location": "..." }
}
```

### POST `/api/create-calendar-event`

```json
// Request
{ "extraction": { ... }, "accessToken": "ya29.xxx" }

// Response
{ "eventId": "abc123", "htmlLink": "https://calendar.google.com/event?eid=..." }
```

## Gemini AI Routing

| Route | Meaning |
|-------|---------|
| `calendar_action` | Clear future event found with explicit date/time |
| `needs_review` | Potential event but date/time/action is ambiguous |
| `no_action_detected` | No future actionable event in the image |

**Important**: The AI never guesses dates. If a date is not explicitly stated in the document, the route is set to `needs_review` so the user can manually enter the correct date.

## Testing

```bash
npm test
```

Tests cover:
- Gemini schema Zod validation (all 3 routes)
- Validation error cases
- Calendar event payload mapping (timed and all-day events)
- Date/time parsing and normalization
- Description building with amount/issuer
- Fallback behavior

## Cloud Run Deployment

The app is Cloud Run compatible out of the box:

```bash
# Build
npm run build

# Docker
docker build -t lifesnap-action .
docker run -p 8080:8080 \
  -e GEMINI_API_KEY=xxx \
  -e GOOGLE_CLIENT_ID=xxx \
  -e GOOGLE_CLIENT_SECRET=xxx \
  lifesnap-action
```

- Listens on `process.env.PORT` (default 8080)
- Binds to `0.0.0.0`
- No secrets in the image — pass via environment variables or Secret Manager

## Privacy

- **Images are not stored.** Uploaded images are processed in memory for Gemini extraction and immediately discarded. No image data is persisted to disk or database.
- **Images are only used for task extraction.** Image content is sent to the Gemini API solely to extract event information. It is not used for any other purpose.
- **Events are created only after user confirmation.** The app never creates calendar events automatically. Every event requires explicit user review and confirmation before being sent to the Google Calendar API.
- **Access tokens are not stored on the server.** Calendar OAuth tokens are held in the client session only for the duration of the interaction.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build for production (Vite + esbuild) |
| `npm start` | Start production server |
| `npm test` | Run tests |
| `npm run lint` | TypeScript type checking |
| `npm run clean` | Remove build artifacts |

## License

Private project.
