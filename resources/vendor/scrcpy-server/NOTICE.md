# Provenance

`scrcpy-server.jar` in this directory is vendored, unmodified, from the
[NetrisTV/ws-scrcpy](https://github.com/NetrisTV/ws-scrcpy) project
(`vendor/Genymobile/scrcpy/scrcpy-server.jar`), commit at the time of
vendoring being the repository's `master` HEAD.

It is itself a patched build of
[Genymobile/scrcpy](https://github.com/Genymobile/scrcpy)'s
`scrcpy-server`, modified by the ws-scrcpy maintainers to add a `web`
server mode (`SERVER_TYPE=web`) that serves the H.264 stream directly
over a WebSocket from the device, instead of the raw scrcpy socket
protocol. Server identifies itself as version `1.19-ws7`.

Licensed under the Apache License, Version 2.0 — see `LICENSE` in this
directory.

MPCC's streaming server (`src/main/streaming/`) launches this jar via
ADB (push + `app_process`) and relays its on-device WebSocket to the
renderer, following the same architecture as ws-scrcpy
(MIT-licensed) but with its own Node-side and browser-side code.
