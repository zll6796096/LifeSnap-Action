# よていスナップ Screenshot Plan

## Required Devices

- The current app target is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`); do not prepare or upload iPad screenshots.
- Prepare one Japanese 6.9-inch iPhone portrait set using one Apple-accepted size consistently: 1260 × 2736, 1290 × 2796, or 1320 × 2868 pixels.
- Provide between one and ten screenshots. Use the highest-resolution set so App Store Connect can scale it for smaller iPhone displays.

## Screenshots

1. `01-capture.png`: capture screen with camera and library actions.
2. `02-consent.png`: per-upload data-sharing consent screen before processing.
3. `03-processing.png`: processing screen while extraction is running.
4. `04-review.png`: review screen with a successful `calendar_action` result.
5. `05-needs-review.png`: needs-review screen showing editable uncertain extraction.
6. `06-no-action.png`: no-action screen for documents without a calendar action.
7. `07-success.png`: success screen after adding a confirmed event to Calendar.

## Screenshot Rules

- Use non-sensitive sample documents only.
- Do not show real names, addresses, financial amounts, phone numbers, student names, or private calendar data.
- Use Japanese screenshots for the Japanese App Store listing.
- Keep the displayed flow aligned with Scan -> Confirm -> Schedule.
- Screenshots must use the approved Apple-native UI and the よていスナップ brand.
- Do not show the old LifeSnap icon, old launch name, mock badges, or personal document data.
- The prepared local 6.9-inch iPhone set contains all seven ordered files at 1320 × 2868 pixels in RGB PNG format with no alpha channel.
- This local evidence update does not record any Build 6 App Store Connect screenshot change.
