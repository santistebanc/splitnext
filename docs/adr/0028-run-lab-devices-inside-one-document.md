`# Run lab devices inside one document
`
`[ADR 0027](./0027-own-real-browser-installations-in-a-local-device-lab.md) gives
`each lab device a real headless Chromium profile and mirrors screenshots. That is
`faithful but heavy, and its mirror is not the live screen. The lab now also offers
`in-page devices: many live instances of the ordinary app in one document, with
`each substrate service supplied by a lab adapter. Browser devices stay, as the
`alternative for questions about the browser itself.
`
`## Decision
`
`- `addDevice` takes `kind: "inpage" | "browser"`. The default stays `browser`,
`  so existing steps, manifests and habits keep their meaning; the lab frontend
`  offers the choice and starts on `inpage`. The device-lab guide says when to use
`  each, and recommends reproducing a sync question on `inpage` first.
`- An in-page device is the same `AppScreen`, `AppController` and `Dispatcher`.
`  A `LabDevice` assembles its `AppSubstrate`: a per-device namespaced IndexedDB
`  database, `localStorage` keys, installation secret, preferences and seen
`  markers; a virtual network for fetch and realtime sockets in front of the same
`  real local Worker; a virtual lifecycle; in-memory navigation; and fake
`  clipboard, share, notification and homepage capabilities that tests can read.
`  No duplicate fake app exists.
`- One React root renders every device through portals into slots the lab page
`  provides. Each device's box is positioned, clipped and contained, and receives
`  a `ScreenHost`. Shared screen code that assumed it owned the window reads the
`  host when there is one and behaves as before otherwise.
`- The supervisor keeps operations, steps, timeline and checkpoints. It drives
`  in-page devices through a page that registers as their host over a loopback
`  event stream. That page is either a lab page a person has open or a headless
`  Chromium the supervisor starts on the same page, so agents need no human tab
`  (`--host=auto|headless|tab`).
`- The server gate and each device's connection state still decide delivery: a
`  request fails while the device is offline or the server is unavailable, and a
`  response that arrives after the connection changed is dropped even though the
`  Worker may already have committed. The Worker is not changed; it already
`  allows cross-origin requests.
`
`## Containment: what was needed
`
`The app was nearer to this than expected. Changes of screen use element-scoped
`Web Animations, not the document-global View Transitions API, and the page
`scrolls an inner scroll view rather than the document. The shared code changed
`in: modals (`ScreenModal`), the toast and edit cover (portal and positioning),
`outside-tap dismissal, the window-size hooks, the homepage route test, keyboard
`dismissal and the "is a field focused" check, the invite origin, clipboard paste
`and one `getElementById`. The lab adds a document-level guard that stops one
`device's own focus calls from taking the keyboard from a field another device is
`being typed in.
`
`## Consequences
`
`- In-page devices do not simulate the soft keyboard or \`visualViewport\`, a pointer
`  type, reduced motion or viewport size per device, service workers, real history,
`  or the browser's clipboard and share. Use a browser device for those.
`- Devices share one document: one keyboard focus, one \`:focus-visible\` rule,
`  one set of fonts and one JavaScript heap. A page error inside one device is
`  contained and reported; a hang is not.
`- Persistence of in-page devices lives in the host page's browser profile.
`  A headless host's profile belongs to the environment and is checkpointed; a
`  person's tab is not, so checkpoint and restore refuse while one hosts.
`- State and draft records in the timeline are coalesced for in-page devices.
`- If shared screen code needs a new browser global, it goes through
`  `ScreenHost`, or the web app and lab diverge. The alternative considered, one
`  same-origin iframe per device with injected adapters, would need no
`  containment changes but one document per device and a cross-frame channel; it
`  remains available if this approach proves costly.
