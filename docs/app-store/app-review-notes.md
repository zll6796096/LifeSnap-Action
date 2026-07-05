# App Review Notes Draft

## App Summary

LifeSnap Action helps users turn selected document images into calendar events. The core flow is:

1. Scan or select a document image.
2. Review the extracted calendar-action candidate.
3. Add the confirmed event to the iOS system calendar.

## Review Access

- No account is required.
- No Google login is required.
- No subscription or payment is required.
- The app does not include a dashboard, document archive, history center, or cloud sync.

## Backend

- Production API base URL: `https://lifesnap-action-788259830737.asia-northeast1.run.app`
- Health check: `https://lifesnap-action-788259830737.asia-northeast1.run.app/healthz`
- Privacy policy: `https://lifesnap-action-788259830737.asia-northeast1.run.app/privacy`
- The Gemini API key is held only by the backend and is not included in the iOS app.
- Production deployment must use Secret Manager injection for `GEMINI_API_KEY`.
- `MOCK_MODE` is development-only and forbidden in production.

## Test Steps

1. Launch the app.
2. Read the visible disclosure that selected images are sent to the LifeSnap backend and Gemini API for calendar-action extraction.
3. Tap the privacy policy link if needed.
4. Choose a clear notice image from Photos or take a photo with the camera.
5. Wait for extraction.
6. Review the proposed event fields.
7. Grant calendar access when prompted.
8. Add the event to the system calendar.

## Expected Permission Prompts

- Camera: used to capture a document image for calendar-action extraction.
- Photo Library: used to select a document image for calendar-action extraction.
- Calendar: used to add user-confirmed events to the system calendar.

## Privacy Notes

Selected images are sent to the LifeSnap backend and Gemini API only for calendar-action extraction. LifeSnap does not intentionally store original images. Existing calendar contents are not uploaded.
