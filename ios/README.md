# LifeSnap Action — iOS App

SwiftUI app that turns paper notices into iOS calendar events.

## Requirements

- Xcode 15.0+
- iOS 17.0+ deployment target
- Physical device for camera testing
- iPhone 15 is supported

The app uses Swift Observation APIs such as `@Observable` and `@Bindable`, which require iOS 17.0 or newer. Keep the deployment target at iOS 17.0+ unless the app is later migrated away from Swift Observation.

## Setup

1. Open `ios/LifeSnapAction.xcodeproj` directly in Xcode.
2. Ensure you configure your Team/Signing settings under the **LifeSnapAction** target settings to deploy to a physical device.

### Project Generation (Optional)

The project is managed using **XcodeGen**. If you make changes to files or target configurations and want to regenerate the project file:
1. Install XcodeGen: `brew install xcodegen`
2. Run `xcodegen` in the `ios/` folder. This will regenerate `LifeSnapAction.xcodeproj` using `project.yml`.

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
