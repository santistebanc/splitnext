# Own real browser installations in a local device lab

The local lab supervisor owns a dedicated Worker process, a distinct persistence
directory, and persistent Chromium profiles. Each device runs the ordinary app
screen, controller, dispatcher and SDK. A bridge installed by the supervisor
binds inspection and action dispatch to that screen's dispatcher. It is inert
in ordinary app sessions. The lab frontend mirrors those pages and sends input
to them; opening the frontend does not create a second set of app instances.

All callers use the supervisor's loopback operations API. Device network loss,
server unavailability and actual process stop are separate controls. Network
gates intercept HTTP and realtime, including already established connections.
Already committed server work is not rolled back when its response is lost.

Server store maintenance and coordinated environment checkpoints stop the
Worker and close browser profiles before reading or copying SQLite files.
Structured table/row operations are restricted to this supervisor's isolated
stores; arbitrary SQL and remote targets are outside the interface. Experiment
steps and the ordered timeline remain outside restored checkpoints so mistakes
remain diagnosable. No production lab endpoint is added to the Worker.
