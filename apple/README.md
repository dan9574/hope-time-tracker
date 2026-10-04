# Hope for iPhone and Apple Watch

Stages 8–9 of `docs/rebuild-plan.md`. One Xcode project, two apps, one shared Swift package:

```
apple/
  Hope.xcodeproj      targets: Hope (iOS 18+), HopeWatch (watchOS 11+, embedded in Hope)
  HopeCore/           Swift package: records (SwiftData), timer rules, sync engine — no UI; `swift test`
  Shared/             SwiftUI used by both apps, and Localizable.xcstrings (English + 简体中文)
  iOS/                iPhone app: Today, start/pause/resume/stop, account, hands the sign-in to the watch
  Watch/              Watch app: activity list, running screen
  Config/             Base.xcconfig, per-target Info.plist additions, Local.xcconfig.example
  scripts/            configure-supabase.sh
```

Bundle IDs: `io.github.dan9574.hope.ios` and `io.github.dan9574.hope.ios.watchkitapp`.

## Tests

```sh
cd apple/HopeCore
swift test
```

Runs on macOS, no simulator needed. Covers the sync engine against an in-memory fake server (a port of
`src-tauri/src/sync/fake.rs`: two devices converge, offline edits, delete vs edit, one running session,
idempotent pull, pagination, the 50-sequence overlap), the GoTrue/PostgREST request shapes, token refresh,
the timer rules and the duration formats.

## Signing (once per machine)

1. `cp apple/Config/Local.xcconfig.example apple/Config/Local.xcconfig` and set `DEVELOPMENT_TEAM` to your
   team ID (the `OU=` field of your "Apple Development" certificate; see the comment in the example).
   `Local.xcconfig` is git-ignored.
2. In Xcode → Settings → Accounts, sign in with that Apple ID. Command-line builds with
   `-allowProvisioningUpdates` use this account to create the development profiles.

The project uses automatic signing and no capabilities that need a paid account (no push, no App Groups,
no iCloud). With a free personal team, apps installed on a device expire after 7 days and must be
re-installed from Xcode.

## Supabase config

The apps read `HopeSupabaseURL` / `HopeSupabaseAnonKey` from their Info.plist. The values come from
`Config/Supabase.generated.xcconfig` (git-ignored), which `scripts/configure-supabase.sh` writes from the
repository's root `.env` — the same file and keys the desktop uses (see `supabase/README.md`):

```sh
apple/scripts/configure-supabase.sh
```

Both targets run the script in `--check` mode as their first build phase. If `.env` changed since the last
build, the phase regenerates the file and stops the build with
"…has been regenerated from .env. Build again to use it." (Xcode had already read the old values.)

With no `.env`, or with either value empty, the apps build and run local-only and Account says
"Not configured". Never put the service-role key in `.env`.

## Build

```sh
cd apple
# iPhone app (builds and embeds the watch app)
xcodebuild -project Hope.xcodeproj -scheme Hope -destination generic/platform=iOS \
  -derivedDataPath build -allowProvisioningUpdates build
# Watch app alone
xcodebuild -project Hope.xcodeproj -scheme HopeWatch -destination generic/platform=watchOS \
  -derivedDataPath build -allowProvisioningUpdates build
```

Products: `apple/build/Build/Products/Debug-iphoneos/Hope.app` (with `Watch/HopeWatch.app` inside) and
`apple/build/Build/Products/Debug-watchos/HopeWatch.app`. To only check that it compiles, add
`CODE_SIGNING_ALLOWED=NO`.

## Run in the simulator

```sh
cd apple
xcodebuild -project Hope.xcodeproj -scheme Hope -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max' \
  -derivedDataPath build build
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/Hope.app
xcrun simctl launch booted io.github.dan9574.hope.ios
```

For the watch, build the **HopeWatch** scheme for a watchOS simulator and install
`build/Build/Products/Debug-watchsimulator/HopeWatch.app` on it. Add `-AppleLanguages "(zh-Hans)"` to
`simctl launch` to see the Chinese strings.

## Run on a device

The simplest path is Xcode: open `apple/Hope.xcodeproj`, pick the **Hope** scheme and the iPhone, Run.
Installing the iPhone app also installs the watch app on the paired watch (check the Watch app on the
iPhone → My Watch → Hope if it does not appear). To debug the watch app, pick the **HopeWatch** scheme and
the watch.

From the command line (after a signed build above):

```sh
xcrun devicectl list devices
xcrun devicectl device install app --device <iPhone id> apple/build/Build/Products/Debug-iphoneos/Hope.app
xcrun devicectl device process launch --device <iPhone id> io.github.dan9574.hope.ios
```

First launch on the iPhone: Settings → General → VPN & Device Management → trust the developer certificate.
Developer Mode must be on (Settings → Privacy & Security → Developer Mode) on both iPhone and watch.

## How the watch gets signed in

Supabase refresh tokens rotate, and reusing a spent one revokes the whole session, so the iPhone does not
share its own session. When you sign in on the iPhone (and a watch with Hope is paired), it signs in a
second time with the same password and passes that session to the watch over WatchConnectivity
(`updateApplicationContext`). From then on the watch refreshes its own tokens and talks to Supabase
directly. If the watch was added later, use Account → Connect Apple Watch (asks for the password again).
Signing out on the iPhone signs the watch out too. Without an account, both apps are fully local.
