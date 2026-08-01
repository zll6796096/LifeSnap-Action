# よていスナップ Privacy Policy

Last updated: 2026-08-01

よていスナップ (`紙の案内を予定に変える`) helps users extract calendar-action candidates from selected document images and add confirmed events to the iOS system calendar.

## Data Sent Before AI Analysis

The user can take a photo with `カメラで撮影` (`写真を撮る`) or choose one with `写真から選ぶ` (`写真を選ぶ`). よていスナップ sends that document image only after the user explicitly taps `同意して続ける` or, for retry, `同意してもう一度試す`.

The image may contain personal information such as names, addresses, dates, amounts, organizations, appointment details, or other document text.

If the user taps `キャンセル`, the image is not uploaded, AI analysis is not started, the app clears the pending in-memory image (`画像を削除`), and no calendar event is created.

## Processing Chain

The iOS app sends the selected image over HTTPS to the よていスナップ Google Cloud Run backend. The backend sends the image to Google Gemini by Google LLC only to extract possible schedule or task fields.

The Gemini API key is stored only on the backend. It is not included in the iOS app.

## App Integrity and Abuse Prevention

よていスナップ uses Firebase App Check with Apple App Attest to confirm that extraction requests come from the genuine app and to reject replayed tokens. Apple and Firebase process the attestation and assertion objects required for this app-integrity check. Firebase may retain consumed App Check tokens for replay protection for up to 30 days. This statement does not describe or assume Google's internal implementation beyond the documented retention boundary.

On first use, the app generates a random installation UUID and stores it only in the device Keychain. The app sends that UUID to the backend in a request header for quota enforcement. The backend immediately derives an HMAC digest. Firestore stores only that HMAC digest and quota counters, not the original UUID. This unlinked identifier is used only for App Functionality and Fraud Prevention, not for tracking or user profiling.

## Retention

よていスナップ does not persist uploaded images, base64 payloads, raw Gemini responses, OCR text, extracted titles, names, addresses, amounts, summaries, or document archives in a database, object store, or file storage.

The backend uses request-time memory processing. After the request completes, よていスナップ does not keep a server-side document copy for the user to delete later.

Firestore quota records contain an HMAC digest, counter values, and bucket/expiry timestamps. Short-window quota counters expire logically after 24 hours. Daily quota records, including installation and service counters, expire within 30 days. These quota records do not contain the uploaded image, raw Gemini output, or extracted document content.

Separately, Firebase may retain consumed App Check tokens for replay protection for up to 30 days. This Firebase retention is not the Firestore quota-record retention described above.

## Google Gemini Paid Service

Production Gemini requests use an API key that belongs to an active-billing Google Cloud project, so the Gemini API is used as a Paid Service.

Google states that Paid Service prompts and responses are not used to improve Google products. Google may still process limited logs for safety, security, abuse prevention, and legal obligations for a limited period. Google processing may occur across countries or regions.

## Calendar Access

Calendar permission is used only after the user reviews the extracted fields. On first use, the user taps `カレンダーの使用を許可` and grants the system permission, then taps `カレンダーに追加` and confirms `追加する` (`予定を追加`). よていスナップ does not upload or read the user's existing calendar contents.

## Logging

Production application logs are limited to operational metadata such as request ID, MIME type, image byte size, latency, model name, HTTP status, route category, and safe error codes.

Production logs must not include image bytes, base64 payloads, request bodies, raw Gemini output, OCR text, extracted titles, names, addresses, amounts, summaries, or full document content.

## Withdrawal and Deletion

The user can refuse each upload on the consent screen. Because よていスナップ has no account system, no server document archive, and no persistent uploaded-image storage, there is no retained document record to delete after a canceled or completed request. Quota HMAC/counter records expire on the schedule above, and the backend does not persist the original installation UUID.

Calendar events are stored only in the user's system calendar after confirmation and can be edited or deleted in Calendar.

## Contact and Updates

For privacy questions, contact the app owner through the App Store support channel. If this policy changes, the update date on this page will be revised.
