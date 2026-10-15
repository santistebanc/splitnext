# Use Expo Router for web and native clients

Use one Expo Router application for the responsive web client and the later
iOS and Android apps, sharing the interface and interaction logic rather than
maintaining separate web and native UIs. All platforms use the existing client
sync SDK, with platform-specific persistence and runtime adapters.

Ordinary app views remain animated and state-driven inside the app shell.
Expo Router provides the public homepage, app entry, and invitation URL
boundaries; incoming join links and browser back/forward remain supported.
This preserves shared web/native UI while keeping the animated navigation
experience chosen for the app. Web entry pages are planned to render on a
Cloudflare Worker.

Expo SDK 57 requires its server-rendering opt-in. Export its renderer and route
manifest as separate Worker modules and serve client assets as Worker static
assets. Keep the API Worker name, bindings, and local database state.
Use the Workerd adapter under `nodejs_compat`; verify rendering against the
bundled Worker because its dynamic module imports differ from Vite's source
module evaluation. Keep React and React Native aligned with Expo's SDK versions.
