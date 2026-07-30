# よていスナップ (Yotei Snap) App Review Notes Draft

## App Summary

よていスナップ helps users turn selected document images into calendar events. The core flow is:

1. Scan or select a document image.
2. Review the explicit AI upload consent screen.
3. Tap `同意して続ける` to upload the image for AI analysis, or tap `キャンセル` to refuse.
4. Review the extracted calendar-action candidate.
5. Add the confirmed event to the iOS system calendar.

## Review Access

- No account is required.
- No Google login is required.
- No subscription or payment is required.
- The app does not include a dashboard, document archive, history center, or cloud sync.

## Backend

- Production API base URL: `https://lifesnap-action-sxielk4wua-an.a.run.app`
- Health check: `https://lifesnap-action-sxielk4wua-an.a.run.app/health`
- Privacy policy: `https://lifesnap-action-sxielk4wua-an.a.run.app/privacy`
- The Gemini API key is held only by the backend and is not included in the iOS app.
- Production deployment uses Secret Manager injection for `GEMINI_API_KEY`.
- The production Gemini API key has been verified to belong to an active-billing Google Cloud project, so Gemini is used as a Paid Service.
- `MOCK_MODE` is development-only and forbidden in production.

## AI Upload Consent

Before each image upload, including retries, よていスナップ shows a dedicated consent screen. The screen discloses:

- The selected document image may contain names, addresses, dates, amounts, organizations, appointment details, and other personal information.
- The image is sent to the よていスナップ Google Cloud Run backend and third-party AI service Google Gemini by Google LLC.
- The purpose is only to extract schedule or task information.
- よていスナップ processes the image in request-time memory and does not persist uploaded images, base64 payloads, OCR text, raw Gemini output, titles, names, addresses, amounts, or summaries.
- Google does not use Gemini Paid Service inputs or outputs to improve Google products, but may process limited logs for safety, security, abuse prevention, and legal obligations.
- Users can refuse. If the user taps `キャンセル`, no `/api/extract` request is made, the pending image is cleared, and no calendar event is created.

## Reviewer Test Steps

1. Launch よていスナップ.
2. Tap `カメラで撮影` or `ライブラリから選択`.
3. Confirm that the upload-consent screen appears before processing.
4. Tap `キャンセル`; verify that no image is uploaded.
5. Select the sample again and tap `同意して続ける`.
6. Review the proposed event fields.
7. Grant Calendar access when prompted.
8. Add the confirmed event to Calendar.
9. If retry appears, verify that `同意してもう一度試す` is required before another upload.

## Expected Permission Prompts

- Camera: used to capture a document image for calendar-action extraction.
- Photo Library: used to select a document image for calendar-action extraction.
- Calendar: used to add user-confirmed events to the system calendar.

## Privacy Notes

よていスナップ does not persist uploaded images or extracted document contents. Existing calendar contents are not uploaded. Production application logs are structured operational metadata only and do not include image bytes, request bodies, raw Gemini output, OCR text, titles, names, addresses, amounts, or summaries.
