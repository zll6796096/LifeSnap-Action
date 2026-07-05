# App Privacy Label Draft

This is a draft for App Store Connect. Confirm against the final production behavior before submission.

## Tracking

- Tracking: No
- Third-party advertising: No

## Data Linked to the User

- None expected. The app has no account system and does not intentionally attach uploads to a user identity.

## Data Not Linked to the User

### User Content

- Photos or videos: selected document images are transmitted to the LifeSnap backend and Gemini API for app functionality.
- Purpose: App Functionality.
- Stored by LifeSnap: No intentional original-image storage.
- Used for tracking: No.

### Other User Content

- Extracted document content may include event title, date/time, location, memo, issuer, or amount while processing a request.
- Purpose: App Functionality.
- Stored by LifeSnap: No intentional storage.
- Used for tracking: No.

### Diagnostics

- Backend operational logs may include route/status/error metadata.
- Production logs must not include image bytes, base64 payloads, full OCR/extracted text, full extracted personal data, addresses, amounts, or request bodies.

## Data Not Collected

- Contact information
- Precise location
- Contacts
- Browsing history
- Search history
- Identifiers from the iOS app
- Purchases
- Payment information

## Calendar Data

The app requests Calendar permission to add user-confirmed events to the local system calendar. Existing calendar contents are not uploaded to the LifeSnap backend.
