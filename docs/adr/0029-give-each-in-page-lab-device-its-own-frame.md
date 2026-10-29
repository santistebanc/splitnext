# Give each in-page lab device its own frame

Partially supersedes [ADR 0028](./0028-run-lab-devices-inside-one-document.md):
in-page devices no longer render as portals into one shared document.

In-page devices were boxes in the lab page's own document, and the page drew
them at other sizes with CSS `zoom` on the box. The app then laid itself out at
fractional sizes and measured itself in zoomed coordinates, which left seams
along edges and misplaced what it positions by measurement. Each box also had to
pretend to be a window. ADR 0028 kept a same-origin frame per device as the
alternative if that approach proved costly; it did.

## Decision

- Each in-page device renders in its own same-origin iframe. The supervisor
  serves the frame's page at `/host/frame?device=ID`; it loads the app's built
  script by its content-hashed name, cached once for every frame.
- The frame builds its own `LabDevice` (substrate, virtual network, storage
  namespace, memory navigation) and screen in its own realm, as a page would.
  The host page's `LabHost` hands it the device's configuration, the shared
  server gate, the report channel and the fake capabilities, then forwards the
  supervisor's calls to the device the frame registers. Kinds, operations,
  storage namespaces and the timeline are unchanged, so existing in-page devices
  keep their data.
- A frame without a slot keeps running out of sight in the host page. Frames
  move between slots with `moveBefore`, so moving a panel keeps the device's
  page, drafts and focus. The lab page attaches a slot once its panel is in the
  document, because a move into a detached element would reload the frame.
- The lab page scales the slot with CSS `zoom`, which the browser applies to the
  whole frame like page zoom: the app keeps laying itself out at its screen size.

## Consequences

- Each device has its own window: viewport, media queries, `visualViewport`,
  document focus and styles. Its size is the frame's size.
- Each device parses the app script and has its own JavaScript realm: more
  memory per device, still one browser. Frames share the page's thread, so a hang
  in one still stalls the others.
- The page still has one keyboard focus. Each frame guards its own focus calls
  so that a device does not take the keyboard from a field another is typed in.
- The screen still receives a `ScreenHost`, now always covering its whole frame.
  The containment that ADR 0028 added to shared screen code is no longer needed
  for isolation and can be retired separately.
- Playwright places clicks inside a frame under CSS `zoom` wrongly. Tests draw
  in-page screens at 100%, as the headless host always does.
