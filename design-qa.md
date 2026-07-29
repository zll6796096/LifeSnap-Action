# LifeSnap Apple-native UI Design QA

## Comparison input

- Reference: `docs/superpowers/specs/assets/lifesnap-apple-native-ui-option-2.png`
- Implementation: `docs/verification/lifesnap-apple-native-ui/13-review-small-iphone.png`
- Combined comparison: `docs/verification/lifesnap-apple-native-ui/14-reference-vs-implementation.png`
- Normalized viewport: 390 × 844 points
- State: populated review screen, calendar access granted

## Iteration history

### Pass 1

- P2 · Content/localization: edit-mode `DatePicker` rendered an English date string in a Japanese-only flow. Fixed by applying the `ja_JP` locale at the app root.
- P2 · Typography: the success headline used `largeTitle`, wrapped too aggressively, and overpowered the result summary. Fixed by using `title2.bold()` while retaining the same semantic success hierarchy.

### Pass 2

The reference and latest simulator screenshot were placed in one comparison image and inspected together. No remaining P0, P1, or P2 issues were found.

## Mandatory checks

- Fonts and typography: native San Francisco/Japanese system typography, clear title/body/secondary hierarchy, no uniformly bold treatment, and no clipped or cramped text at the target viewport.
- Spacing and layout: 20-point page margins, restrained grouped surfaces, consistent dividers, visible source document, and a fixed primary action area. Content order and visual hierarchy match the selected direction.
- Viewport resilience: verified at 393 × 852 and 390 × 844 points, in light and dark appearance, and with accessibility text sizing. Scrollable content remains usable and the primary action stays reachable.
- Colors and tokens: semantic system background, label, separator, blue action, orange warning, and green success tokens. No gradients, neon effects, decorative blobs, or non-semantic hex color system.
- Image quality: the real captured notice is retained transiently for review and rendered with an appropriate thumbnail crop; no placeholder illustration, CSS art, or handcrafted SVG substitute is used.
- Copy and content: Japanese-first, task-oriented copy. Confidence percentages and model-facing language were removed from functional UI; legally required AI disclosure remains only in the consent detail.
- Icons: SF Symbols are used consistently for document, calendar, location, memo, warning, success, permission, and disclosure actions.
- States and interactions: capture, consent, processing, review, edit, needs-review, no-action, success, permission, retry, disabled, light, dark, reduced-motion, and large-text states are implemented and visually inspected.
- Accessibility: system controls retain semantic labels, interactive targets are at least 44 points, reduced motion is respected, text scales without horizontal overflow, and disabled/secondary states preserve hierarchy.
- AI shortcut artifacts: no generic dashboard grid, equal-weight card wall, fake hero art, decorative gradient, excessive border treatment, or fabricated asset remains.

## Intentional differences from the reference

- The implementation includes the real iOS status bar and safe-area behavior.
- The date wraps to two lines when needed instead of shrinking below a comfortable reading size.
- Issuer is preserved as a separate, lower-emphasis metadata row because it is useful source information.
- The CTA uses a solid semantic system blue instead of the reference gradient to meet the approved “no gradients” Apple-native rule.

final result: passed
