# よていスナップ 1.1 Build 4 App Store Release Gate

## Scope

- Apple-native UI redesign
- Apple-native page-turn AppIcon
- User-visible rename to よていスナップ
- App Store Japanese name and subtitle refresh
- No bundle ID, backend, data-flow, or privacy-behavior change

## Immutable Identity

| Field | Required value |
|---|---|
| Bundle ID | `com.zll.lifesnapaction` |
| Marketing version | `1.1` |
| Build | `4` |
| App Store name | `よていスナップ` |
| Japanese subtitle | `紙の案内を予定に変える` |
| Target / scheme | `LifeSnapAction` |

## Gate Status

| Gate | Status | Evidence |
|---|---|---|
| Release contract | PENDING | Not run |
| iOS tests | PENDING | Not run |
| Simulator visual acceptance | PENDING | Not run |
| Backend regression | PENDING | Not run |
| Signing identity | PENDING | Not checked |
| Archive | PENDING | Not run |
| Export validation | PENDING | Not run |
| Build 4 upload | PENDING | Not run |
| App Store metadata | PENDING | Not changed |
| App Review submission | PENDING | Not submitted |

## External-State Rule

Archive, upload, metadata save, App Review submission, review approval, and storefront availability are separate states. Record only observed state and never promote one state into another.

## Evidence Log

Append timestamped, sanitized evidence here during execution. Do not include credentials, provisioning secrets, personal contact details, document contents, or raw App Store session data.
