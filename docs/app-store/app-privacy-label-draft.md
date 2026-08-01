# App Privacy Label Draft

This is a conservative draft for App Store Connect. It is based on the implemented production data flow and should be reviewed before final App Store submission.

## Tracking

- Tracking: No
- Third-party advertising: No
- Data broker sharing: No

## Data Types

### User Content: Photos or Videos

- Collected/transmitted: Yes, when the user explicitly agrees before each upload.
- Purpose: App Functionality.
- Used for tracking: No.
- よていスナップ persistence: No. よていスナップ does not persist uploaded images in a database, object store, or file storage.
- Third-party processing: Yes. After the user chooses `同意して続ける` or, for a retry, `同意してもう一度試す`, the image is sent through the よていスナップ backend to Google Gemini by Google LLC for AI extraction.
- Conservative linked status: Treat as potentially linked to the user. The app has no account system, but the document itself may contain names, addresses, appointment details, or other identifying information.

### User Content: Other User Content

- Collected/transmitted: Yes, during request-time AI extraction. The content may include document text and extracted title, date, time, location, issuer, amount, or summary.
- Purpose: App Functionality.
- Used for tracking: No.
- よていスナップ persistence: No persistent よていスナップ storage.
- Third-party processing: Yes, by Google Gemini Paid Service.
- Conservative linked status: Treat as potentially linked because the document content may identify a person.

### Diagnostics

- Collected by よていスナップ application logs: Operational metadata only, such as request ID, MIME type, byte size, latency, model name, route category, HTTP status, and safe error code.
- Not logged by よていスナップ: Image bytes, base64 payloads, request bodies, raw Gemini output, OCR text, titles, names, addresses, amounts, summaries, or full document content.
- Purpose: App Functionality and crash/performance diagnosis.
- Used for tracking: No.
- Linked status: Not intended to be linked to the user by よていスナップ.

### Identifiers: Device ID (App-Generated Installation Identifier)

- Collected/transmitted: Yes. The app generates a random installation UUID and stores it only in the device Keychain. It sends the UUID to the backend in a request header for quota enforcement.
- Server storage: The backend immediately derives an HMAC digest. Firestore stores only the HMAC digest and quota counters, not the original UUID.
- Purpose: App Functionality and Fraud Prevention.
- Used for tracking: No.
- Linked status: No. The identifier is not associated with an account, uploaded document content, advertising identity, or user profile.
- Retention: Short-window Firestore quota counters expire logically after 24 hours; daily quota records expire within 30 days.

### App Integrity Data

- Firebase App Check with Apple App Attest processes attestation and assertion objects to confirm app integrity and reject replayed tokens.
- Purpose: App Functionality and Fraud Prevention.
- Used for tracking: No.
- Linked status: Not linked by よていスナップ.
- Separate retention boundary: Firebase may retain consumed App Check tokens for replay protection for up to 30 days. This is separate from Firestore quota-record retention.

## Data Not Used

- Contact information: Not requested by the app.
- Precise location: Not requested by the app.
- Contacts: Not requested by the app.
- Browsing history: Not collected.
- Search history: Not collected.
- Purchases/payment information: Not collected.
- Advertising or cross-app tracking identifiers: Not used.

## Calendar Data

The app requests Calendar permission only after the user reviews the extracted fields. On first use, the user taps `カレンダーの使用を許可` and grants the system permission, then taps `カレンダーに追加` and confirms `追加する` (`予定を追加`). Existing calendar contents are not uploaded to よていスナップ.

## Why Not Select "Data Not Collected"

Apple's "Data Not Collected" exception may apply only when data is processed on-device or transmitted solely for immediate request fulfillment and discarded in a way that satisfies Apple's definition. よていスナップ itself does not persist the uploaded image, but the request is sent to Google Gemini Paid Service, and Google may process limited logs for safety, security, abuse prevention, and legal obligations for a limited period.

Because third parties may process limited Gemini logs and App Check integrity objects after the real-time request, the conservative App Store Connect answer should not be `Data Not Collected`. Use the User Content and unlinked Identifier categories above unless Apple Support or legal review confirms a different form classification.

The app does not use Firebase Analytics, Firebase Authentication, Crashlytics, advertising services, cross-app tracking, or user profiling. App Check and Firestore quota enforcement must not be described as any of those products or uses.
