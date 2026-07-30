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
- Current Gemini Paid Plan verification is `VERIFIED` as of 2026-07-31 JST: AI Studio displayed `Paid 1`; the LifeSnap key belongs to project `zhang23-23` and displayed `Tier 1` / prepaid; the masked AI Studio key identity matched Secret Manager `lifesnap-gemini-api-key:latest`.
- The Cloud Billing API was not enabled or called, and no billing or payment setting was changed.
- Production revision `lifesnap-action-00039-rwn` runs Cloud Build `14c3eff7-a07c-479b-81c5-453b0d5e7256` source `8e1b6f5eb679c95a420c7307f5bedf4fe5a5a50d` at image digest `sha256:8bb5f60e05db572fa9232c1bec894620567025ee61b1d19f44cd3fe3ce338a26`.
- The zero-traffic candidate and unchanged production URL both passed strict `/health`, current `/privacy`, and synthetic `/api/extract` smoke checks. The extraction response was schema-complete with `Cache-Control: no-store`; no document contents or raw AI output were recorded.
- Production traffic is one untagged `100%` target to `lifesnap-action-00039-rwn`; rollback revision `lifesnap-action-00037-89l` is at `0%`.
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
2. Tap `カメラで撮影` (`写真を撮る`) or `写真から選ぶ` (`写真を選ぶ`).
3. Confirm that the upload-consent screen appears before processing.
4. Tap `キャンセル`; verify that no image is uploaded and the pending image is cleared (`画像を削除`).
5. Select the sample again and tap `同意して続ける`.
6. Review the proposed event fields.
7. Tap `カレンダーの使用を許可`.
8. Grant Calendar access when prompted.
9. Tap `カレンダーに追加`, then `追加する`, to add the confirmed event (`予定を追加`).
10. If retry appears, verify that `同意してもう一度試す` is required before another upload.

## Expected Permission Prompts

- Camera: used to capture a document image for calendar-action extraction.
- Photo Library: used to select a document image for calendar-action extraction.
- Calendar: used to add user-confirmed events to the system calendar.

## Privacy Notes

よていスナップ does not persist uploaded images or extracted document contents. Existing calendar contents are not uploaded. Production application logs are structured operational metadata only and do not include image bytes, request bodies, raw Gemini output, OCR text, titles, names, addresses, amounts, or summaries.
