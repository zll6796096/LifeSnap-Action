# App Store Connect Privacy Answers

Prepared for よていスナップ 1.1 Build 4 on 2026-08-01 JST.

Do not mark these answers as already submitted in App Store Connect. They are implementation-backed recommendations for the human App Store Connect form.

## Recommended Answer Summary

| App Store Connect area | Recommended answer | Basis |
|---|---|---|
| Tracking | No | よていスナップ has no ads, data broker sharing, cross-app tracking, or user profiling. |
| User Content - Photos or Videos | Yes | The user-selected document image is transmitted to the よていスナップ backend and Google Gemini after explicit consent. |
| Purpose | App Functionality | The image is used only to extract schedule/task fields. |
| Linked to user | Conservative: Yes / potentially linked | The app has no account, but the document itself may contain names, addresses, appointments, or other identifying information. |
| Tracking use | No | The image and extracted content are not used for advertising or tracking. |
| Third-party processing | Yes | Google Gemini by Google LLC processes the image as a Paid Service. |
| Identifiers - Device ID | Yes, unlinked | A random installation UUID/HMAC is used for App Functionality and Fraud Prevention only. |
| App integrity | Yes | Firebase App Check and Apple App Attest process attestation/assertion objects to validate genuine-app requests and reject replay. |
| Data Not Collected | Do not select | Google may process limited safety/security/abuse/legal logs, and Firebase processes App Check integrity data. |

## Photos or Videos

Select `User Content -> Photos or Videos`.

- Collected/transmitted: Yes, only after the user taps `同意して続ける` or `同意してもう一度試す`.
- Purpose: App Functionality.
- Tracking: No.
- よていスナップ persistence: No persistent image storage.
- Third-party: Google Gemini by Google LLC.
- Linked: Use the conservative answer that it may be linked to the user because the image may contain personal information, even though よていスナップ does not maintain accounts.

## Other User Content

Select `User Content -> Other User Content` if App Store Connect asks about text extracted or processed from the document.

- Examples: title, date/time, location, issuer, amount, memo, OCR-like document content.
- Purpose: App Functionality.
- Tracking: No.
- よていスナップ persistence: No persistent storage.
- Third-party: Google Gemini Paid Service.
- Linked: Conservative answer is potentially linked for the same reason as images.

## Diagnostics

If asked about diagnostics, よていスナップ application logs should be described as operational metadata only.

Logged metadata may include request ID, MIME type, byte size, latency, model name, route category, HTTP status, and safe error code.

Not logged: image bytes, base64 payloads, request bodies, raw Gemini responses, OCR text, titles, names, addresses, amounts, summaries, or full document content.

## Identifiers and Fraud Prevention

Select `Identifiers -> Device ID` for the app-generated installation identifier, using the conservative classification available in App Store Connect.

- The app generates a random installation UUID and stores it only in the device Keychain.
- The UUID is sent to the backend in a request header for quota enforcement. The backend immediately derives an HMAC digest.
- Firestore stores only the HMAC digest and quota counters; it does not store the original UUID.
- Linked: No / unlinked. There is no account association, advertising identity, cross-app tracking, or user profile.
- Purposes: App Functionality and Fraud Prevention.
- Firestore retention: short-window counters expire logically after 24 hours; daily quota records expire within 30 days.

## Firebase App Check / Apple App Attest

Disclose that Firebase App Check with Apple App Attest processes attestation and assertion objects to validate app integrity and reject replayed tokens.

- Purposes: App Functionality and Fraud Prevention.
- Linked: Not linked by よていスナップ.
- Tracking: No.
- Firebase may retain consumed App Check tokens for replay protection for up to 30 days. This retention is separate from the Firestore quota-record retention above.
- Do not describe this implementation as Firebase Analytics, Firebase Authentication, Crashlytics, advertising, tracking, or profiling.

## Google Gemini Paid Service Disclosure

Production use has been verified as a Gemini Paid Service because the production API key belongs to a Google Cloud project with active billing.

Google states that Paid Service inputs and outputs are not used to improve Google products. Google may still process limited logs for safety, security, abuse prevention, and legal obligations for a limited period, and processing may occur across regions.

## Calendar

Do not report existing calendar contents as collected by LifeSnap. The app uses Calendar permission to add user-confirmed events locally to the iOS system calendar and does not upload existing calendar contents.
