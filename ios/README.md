# LifeSnap Action — iOS App

SwiftUI app that turns paper notices into iOS calendar events.

## Requirements

- Xcode 15.0+
- iOS 16.0+ deployment target
- Physical device for camera testing

## Setup

1. Open `ios/LifeSnapAction.xcodeproj` in Xcode (or create a new project and add these source files).
2. Set the Bundle Identifier to `com.lifesnap.action`.
3. Set the deployment target to iOS 16.0.
4. Add the source files under `LifeSnapAction/` to the project.
5. Ensure `Info.plist` privacy keys are configured (camera, photos, calendar).

## API Configuration

The app points to the Cloud Run backend by default. To change the API URL:

Edit `Services/APIClient.swift` and update `baseURL`:

```swift
static let baseURL = "https://your-service.run.app"
```

For local development, set the `API_BASE_URL` environment variable in the Xcode scheme:
- Product → Scheme → Edit Scheme → Run → Arguments → Environment Variables
- Add `API_BASE_URL` = `http://localhost:8080`

## Architecture

```
App/            → @main entry point, screen navigation
Models/         → ExtractionResult (Codable), CalendarTask (@Observable)
Views/          → 6 SwiftUI views (Capture, Processing, Review, NeedsReview, NoAction, Success)
ViewModels/     → Capture, Extraction, Calendar view models
Services/       → APIClient (URLSession), CalendarService (EventKit)
Utilities/      → ImageCompressor (JPEG ≤ 2 MB)
```

## Screens

| Screen | Purpose |
|---|---|
| CaptureView | Camera + photo picker |
| ProcessingView | Loading animation during AI extraction |
| ReviewView | Editable task card with calendar confirm |
| NeedsReviewView | Ambiguous extraction — force manual edit |
| NoActionView | Neutral "no event found" |
| SuccessView | Event added confirmation |
