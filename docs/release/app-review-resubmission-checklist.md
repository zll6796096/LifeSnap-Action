# App Review Resubmission Checklist - LifeSnap 1.0 Build 3

## Status

- Build uploaded: Yes, Build `3` uploaded through Xcode `destination=upload`.
- Final App Review submission: Not performed by Codex.
- Required human action: confirm Build `3` processing is complete in App Store Connect, answer export compliance if prompted, attach/select Build `3`, paste the review notes, and click Submit for Review.

## Review Reply Text

Hello App Review Team,

Thank you for the review. We updated LifeSnap to address Guideline 5.1.1(i) and 5.1.2(i).

Before any document image is sent for AI analysis, the app now shows a dedicated consent screen with the selected image preview and a clear explanation of what data is sent, who receives it, and why. The user must tap `同意してAI解析を開始` before `/api/extract` is called. If the user taps `キャンセル`, no API request is made, the pending image is cleared, and no calendar event is created.

The consent screen explains that document images may contain names, addresses, dates, amounts, organizations, appointment details, and other personal information. It also states that the image is sent to the LifeSnap Google Cloud Run backend and Google Gemini by Google LLC only to extract schedule or task information.

LifeSnap does not persist uploaded images, base64 payloads, raw Gemini responses, OCR text, extracted titles, names, addresses, amounts, summaries, or document archives. Production logs contain only operational metadata such as request ID, MIME type, byte size, latency, model name, HTTP status, and route category.

We verified that the production Gemini API key belongs to a Google Cloud project with active billing enabled, so Gemini is used as a Paid Service. Google does not use Paid Service inputs or outputs to improve Google products, but may process limited logs for safety, security, abuse prevention, and legal obligations.

Reviewer path:

1. Open LifeSnap.
2. Select or capture a document image.
3. Confirm the AI upload consent screen appears before analysis.
4. Tap `キャンセル` to verify the app returns to capture without uploading.
5. Select the image again and tap `同意してAI解析を開始`.
6. Review the extracted schedule candidate and add it to Calendar if desired.
7. If a retry is shown, tap retry and confirm that `同意して再解析` is required before the image is uploaded again.

No account, Google login, subscription, document archive, history center, or cloud sync is required.

## Human Submission Steps

1. Open App Store Connect for LifeSnap.
2. Confirm uploaded Build `3` has finished processing.
3. Select Build `3` for version `1.0`.
4. Answer export compliance for Build `3` if App Store Connect prompts for it.
5. Confirm privacy answers match `docs/release/app-store-connect-privacy-answers.md`.
6. Paste the review reply above into App Review notes.
7. Submit for Review.

## Do Not Claim

- Do not claim Google never logs anything.
- Do not claim data is never processed outside Japan.
- Do not mark `Data Not Collected` unless Apple/legal review confirms the real-time processing exception applies despite Google limited logs.
