# よていスナップ (Yotei Snap) App Review Notes

This reviewer note is the current version 1.1 Build 6 App Review note. Build 5 was invalidated by Apple with `ITMS-90111` and is not the production review build. Build 6 passed App Store Connect processing, was bound to version 1.1, and was submitted to App Review on 2026-08-05 JST.

## Submitted Build 6 App Store Connect Review Note

```text
Build 6 (version 1.1) is the production review build.

No account, login, subscription, or payment is required.

Review path:
1. Launch the app.
2. Tap “カメラで撮影” or “写真から選ぶ”.
3. Review the data-sharing consent screen. No image is uploaded before consent.
4. Tap “キャンセル” to refuse; the pending image is cleared and nothing is sent.
5. Select an image again and tap “同意して続ける”.
6. Review the extracted event fields.
7. Tap “カレンダーの使用を許可”.
8. Grant Calendar access when prompted.
9. Tap “カレンダーに追加”, then tap “追加する”.

Privacy and data handling:
- Consent is required before every image upload, including retries.
- The selected image is sent through the よていスナップ backend on Google Cloud Run to Google Gemini, a third-party AI service provided by Google LLC, only to extract calendar or task information.
- The backend processes images transiently for the request and does not persist uploaded images or extracted calendar content.
- Existing Calendar contents are not uploaded.
- Production extraction requests are protected by Firebase App Check backed by Apple App Attest.

Permissions:
- Camera and Photo Library: capture or select the document chosen by the user.
- Calendar: add only the event confirmed by the user.

Privacy Policy:
https://lifesnap-action-sxielk4wua-an.a.run.app/privacy
```

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
- Production revision `lifesnap-action-00041-n9n` runs source `5accd522373d8fbc813ace52baae78e9638466f0` at image digest `sha256:0b36c6e32b81d71692df0d181220b712ec6fc246398fd1d95ba391c90880e3a5`.
- The zero-traffic candidate and unchanged production URL both passed strict `/health`, current `/privacy`, and synthetic `/api/extract` smoke checks. The extraction response was schema-complete with `Cache-Control: no-store`; no document contents or raw AI output were recorded.
- Production traffic is one untagged `100%` target to `lifesnap-action-00041-n9n`.
- `MOCK_MODE` is development-only and forbidden in production.

## App Integrity and Quota Protection

- The production binary sends extraction requests to `/api/v2/extract` with a fresh Firebase App Check token backed by Apple App Attest. Apple and Firebase process the attestation/assertion objects needed to validate app integrity and reject replayed tokens.
- The app generates a random installation UUID on first use and stores it only in the device Keychain. It sends that UUID in the extraction request header for quota enforcement.
- The backend immediately derives an HMAC digest. Firestore stores only the HMAC digest and quota counters, never the original UUID.
- This unlinked identifier is used only for App Functionality and Fraud Prevention. It is not used for advertising, cross-app tracking, or user profiling.
- Short-window Firestore quota counters expire logically after 24 hours. Daily quota records expire within 30 days.
- Separately, Firebase may retain consumed App Check tokens for replay protection for up to 30 days. This is not the Firestore quota-record retention.

## AI Upload Consent

Before each image upload, including retries, よていスナップ shows a dedicated consent screen. The screen discloses:

- The selected document image may contain names, addresses, dates, amounts, organizations, appointment details, and other personal information.
- The image is sent to the よていスナップ Google Cloud Run backend and third-party AI service Google Gemini by Google LLC.
- The purpose is only to extract schedule or task information.
- よていスナップ processes the image in request-time memory and does not persist uploaded images, base64 payloads, OCR text, raw Gemini output, titles, names, addresses, amounts, or summaries.
- Google does not use Gemini Paid Service inputs or outputs to improve Google products, but may process limited logs for safety, security, abuse prevention, and legal obligations.
- Users can refuse. If the user taps `キャンセル`, no `/api/v2/extract` request is made, the pending image is cleared, and no calendar event is created.

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

よていスナップ does not persist uploaded images, raw Gemini output, or extracted document contents. Existing calendar contents are not uploaded. Production application logs are structured operational metadata only and do not include image bytes, request bodies, raw Gemini output, OCR text, titles, names, addresses, amounts, or summaries.

The only application-persisted server data introduced for quota enforcement is the HMAC digest/counter record described above. Records become logically expired at their configured 24-hour or 30-day boundary; Firestore TTL cleanup is asynchronous. The original random UUID remains only in the device Keychain; the backend receives it in a request header but does not persist it. The app does not use Firebase Analytics, Firebase Authentication, Crashlytics, advertising services, tracking, or profiling.
