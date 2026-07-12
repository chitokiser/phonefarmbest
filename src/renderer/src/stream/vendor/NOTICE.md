# Provenance

The files in this directory are adapted from the
[NetrisTV/ws-scrcpy](https://github.com/NetrisTV/ws-scrcpy) project
(MIT licensed), specifically its `src/app/*` client-side value types
and player base classes. They implement the exact binary layout that
the vendored `scrcpy-server.jar` (see
`resources/vendor/scrcpy-server/`) emits over its WebSocket, so the
`fromBuffer`/parsing logic is kept faithful to the original rather
than reimplemented from scratch.

Trimmed compared to upstream: localStorage-backed settings
persistence, on-canvas quality-stats overlay, and multi-display /
multiplexing support — none of which MPCC's MVP needs yet.
