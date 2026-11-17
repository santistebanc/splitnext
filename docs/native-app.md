# Native development

Use the existing Expo app in `apps/client`. Keep the API and ledger rules shared.

Set `EXPO_PUBLIC_API_URL` in the app's `.env.local` to a local test Worker URL
that the device can reach. Set `EXPO_PUBLIC_APP_URL` when shared invite links
need a different web origin. These values are public and embedded at build time;
do not put secrets in them.

An explicit HTTP API URL enables HTTP in that test binary; unset or HTTPS
URLs keep the platform transport restrictions. Regenerate native projects
when changing this setting, as well as rebuilding the JavaScript bundle.
A native installation has its own identity. It does not inherit a browser's
groups or pending changes; join with an invite link.

`npm run native:bundle` checks Android and iOS JavaScript bundles and their
module graphs. `npm run native:android` builds locally with an Android SDK and
JDK. `npm run native:ios` needs macOS and Xcode. Expo generates the ignored
native projects from app configuration. Android pins CMake 3.31.6 for a Ninja
version that supports long Windows paths; install it with the Android SDK tools.
Regenerate native projects after config or module
changes. The font files are static instances of the web fonts; their licenses
are in `assets/fonts`. `npm run assets:brand` also generates the launcher icon.

Android compiles SQLite from source: its prebuilt archive contains only ARM64.
Before device tests, check that the APK includes `libexpo-sqlite.so` for each
packaged architecture. A successful build alone does not prove this.

The native storage tests use real SQLite through Node. They check reopen,
concurrent updates, rollback, and retry. They do not prove expo-sqlite behavior
or operating-system durability. Bundle export does not prove a signed binary
build or device behavior.

Before accepting either platform, use disposable local data and two clients:

1. Create a group on one client and join it on the native client.
2. Disconnect the native client and save an expense.
3. Close the process, reopen offline, and check that the expense remains.
4. Reconnect. Check one expense on both clients and no pending change.
5. Check decimal entry, keyboard controls, system bars, Back, sharing, and
   invitation links when the app is closed and already running.

Custom-scheme links can reach native routes. Automatic HTTPS handoff still
needs verified domain association files and device checks. Signing, store
submission, push notifications, and update delivery are not configured here.
