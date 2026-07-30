# よていスナップ Privacy Policy

Last updated: 2026-07-30

よていスナップ (`紙の案内を予定に変える`) helps users extract calendar-action candidates from selected document images and add confirmed events to the iOS system calendar.

## Data Sent Before AI Analysis

The user can take a photo with `カメラで撮影` (`写真を撮る`) or choose one with `写真から選ぶ` (`写真を選ぶ`). よていスナップ sends that document image only after the user explicitly taps `同意して続ける` or, for retry, `同意してもう一度試す`.

The image may contain personal information such as names, addresses, dates, amounts, organizations, appointment details, or other document text.

If the user taps `キャンセル`, the image is not uploaded, AI analysis is not started, the app clears the pending in-memory image (`画像を削除`), and no calendar event is created.

## Processing Chain

The iOS app sends the selected image over HTTPS to the よていスナップ Google Cloud Run backend. The backend sends the image to Google Gemini by Google LLC only to extract possible schedule or task fields.

The Gemini API key is stored only on the backend. It is not included in the iOS app.

## Retention

よていスナップ does not persist uploaded images, base64 payloads, raw Gemini responses, OCR text, extracted titles, names, addresses, amounts, summaries, or document archives in a database, object store, or file storage.

The backend uses request-time memory processing. After the request completes, よていスナップ does not keep a server-side document copy for the user to delete later.

## Google Gemini Paid Service

Production Gemini requests use an API key that belongs to an active-billing Google Cloud project, so the Gemini API is used as a Paid Service.

Google states that Paid Service prompts and responses are not used to improve Google products. Google may still process limited logs for safety, security, abuse prevention, and legal obligations for a limited period. Google processing may occur across countries or regions.

## Calendar Access

Calendar permission is used only when the user reviews the extracted fields, taps `カレンダーに追加`, and confirms `追加する` (`予定を追加`). よていスナップ does not upload or read the user's existing calendar contents.

## Logging

Production application logs are limited to operational metadata such as request ID, MIME type, image byte size, latency, model name, HTTP status, route category, and safe error codes.

Production logs must not include image bytes, base64 payloads, request bodies, raw Gemini output, OCR text, extracted titles, names, addresses, amounts, summaries, or full document content.

## Withdrawal and Deletion

The user can refuse each upload on the consent screen. Because よていスナップ has no account system, no server document archive, and no persistent uploaded-image storage, there is no retained よていスナップ document record to delete after a canceled or completed request.

Calendar events are stored only in the user's system calendar after confirmation and can be edited or deleted in Calendar.

## Contact and Updates

For privacy questions, contact the app owner through the App Store support channel. If this policy changes, the update date on this page will be revised.
