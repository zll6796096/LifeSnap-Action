# LifeSnap Action Privacy Policy

Last updated: 2026-07-04

LifeSnap Action helps users extract calendar-action candidates from selected document images.

## Data Processed

When the user takes or selects an image, the image is sent to the LifeSnap backend and Gemini API for the sole purpose of extracting possible calendar-event fields such as title, date, time, location, memo, issuer, and amount.

LifeSnap does not intentionally store original images.

## Calendar Access

LifeSnap Action requests calendar access only so the user can add confirmed events to the iOS system calendar. The app does not upload or read the user's existing calendar contents.

## Backend and Gemini

The iOS app sends selected images to the LifeSnap backend. The backend sends the image content to Gemini for calendar-action extraction. The Gemini API key is stored only on the backend and is not included in the iOS app.

Production Gemini usage must use a paid Gemini API project/key with billing enabled. The backend does not use Google Search grounding, Maps grounding, File API persistent uploads, `cached_content`, or stateful Interactions storage.

## Logs

Production logs are designed not to include image bytes, base64 payloads, full OCR/extracted text, full extracted personal data, addresses, amounts, or request bodies.

## Storage

LifeSnap does not intentionally store original images. Calendar events are created in the user's system calendar only after user confirmation.

## Contact

For privacy questions, contact the app owner through the App Store support channel.
