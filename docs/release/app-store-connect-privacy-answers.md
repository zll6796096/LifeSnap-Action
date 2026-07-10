# App Store Connect Privacy Answers

Prepared for LifeSnap Action 1.0 Build 3.

Do not mark these answers as already submitted in App Store Connect. They are implementation-backed recommendations for the human App Store Connect form.

## Recommended Answer Summary

| App Store Connect area | Recommended answer | Basis |
|---|---|---|
| Tracking | No | LifeSnap has no ads, data broker sharing, or cross-app tracking identifiers. |
| User Content - Photos or Videos | Yes | The user-selected document image is transmitted to the LifeSnap backend and Google Gemini after explicit consent. |
| Purpose | App Functionality | The image is used only to extract schedule/task fields. |
| Linked to user | Conservative: Yes / potentially linked | The app has no account, but the document itself may contain names, addresses, appointments, or other identifying information. |
| Tracking use | No | The image and extracted content are not used for advertising or tracking. |
| Third-party processing | Yes | Google Gemini by Google LLC processes the image as a Paid Service. |
| Data Not Collected | Do not select | Google may process limited safety/security/abuse/legal logs after the real-time request. |

## Photos or Videos

Select `User Content -> Photos or Videos`.

- Collected/transmitted: Yes, only after the user taps `同意してAI解析を開始` or `同意して再解析`.
- Purpose: App Functionality.
- Tracking: No.
- LifeSnap persistence: No persistent image storage.
- Third-party: Google Gemini by Google LLC.
- Linked: Use the conservative answer that it may be linked to the user because the image may contain personal information, even though LifeSnap does not maintain accounts.

## Other User Content

Select `User Content -> Other User Content` if App Store Connect asks about text extracted or processed from the document.

- Examples: title, date/time, location, issuer, amount, memo, OCR-like document content.
- Purpose: App Functionality.
- Tracking: No.
- LifeSnap persistence: No persistent storage.
- Third-party: Google Gemini Paid Service.
- Linked: Conservative answer is potentially linked for the same reason as images.

## Diagnostics

If asked about diagnostics, LifeSnap application logs should be described as operational metadata only.

Logged metadata may include request ID, MIME type, byte size, latency, model name, route category, HTTP status, and safe error code.

Not logged: image bytes, base64 payloads, request bodies, raw Gemini responses, OCR text, titles, names, addresses, amounts, summaries, or full document content.

## Google Gemini Paid Service Disclosure

Production use has been verified as a Gemini Paid Service because the production API key belongs to a Google Cloud project with active billing.

Google states that Paid Service inputs and outputs are not used to improve Google products. Google may still process limited logs for safety, security, abuse prevention, and legal obligations for a limited period, and processing may occur across regions.

## Calendar

Do not report existing calendar contents as collected by LifeSnap. The app uses Calendar permission to add user-confirmed events locally to the iOS system calendar and does not upload existing calendar contents.
