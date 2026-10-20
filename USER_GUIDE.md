# AeroVane Local User Guide

AeroVane runs entirely on this computer at one permanent address:

**http://127.0.0.1:4173/**

The web service listens only on the local loopback interface. It is not exposed to other computers and does not upload flight logs.

## Requirements

- Windows 10/11, macOS, or a modern Linux distribution.
- Node.js 20 or newer and npm 10 or newer.
- A Chromium-based browser (Chrome, Edge, or Brave) for direct USB/Web Serial.
  WebSocket telemetry and saved-log analysis work in other modern browsers.

## One-time setup (Windows, macOS, and Linux)

Clone the repository, then enter its directory. If you already have a clone,
start with the `cd` command and replace the example path with its actual
location:

```bash
git clone https://github.com/MdAzullah/AeroVane.git
cd AeroVane
```

From the AeroVane project directory:

```bash
npm ci
npm --prefix live-viewer ci
npm run build
```

Start AeroVane whenever you want to use it:

```bash
npm start
```

This starts the local server and opens AeroVane in the default browser. Keep the
terminal open while using the application; press `Ctrl+C` to stop it. The same
commands work in Windows PowerShell, macOS Terminal, and Linux terminals.

Linux users who want a persistent per-user background service and application
shortcut may optionally run `npm run install:local`. This optional integration
uses systemd and is not required to run AeroVane.

Open AeroVane from the application menu, the desktop shortcut, or browse to http://127.0.0.1:4173/. The two tools are always available at:

- Live Viewer: http://127.0.0.1:4173/live/
- Saved Log Viewer: http://127.0.0.1:4173/logs/

If the optional Linux autostart service is disabled, run `npm start`. To inspect
that service, use `systemctl --user status aerovane.service`. After an
application update, run `npm ci`, `npm --prefix live-viewer ci`, and
`npm run build` again.

## Analyze a saved flight log

Open **Saved Flight Log Analyzer** (at `http://127.0.0.1:4173/logs/`), then choose a local `.bin` or `.log` file or drag it directly onto the drop card.

### Two-Phase Non-Blocking Processing
Even for very large flight logs (e.g. 500MB+ binaries with millions of telemetry records), the analyzer remains responsive without freezing:
1. **Phase 1: Telemetry & Trajectory Decoding** — In the initial seconds, the file is read, telemetry indices are mapped, and GPS coordinates are extracted.
2. **Immediate Dashboard Opening** — As soon as telemetry decoding completes, the full workspace opens instantly with Plotly multi-axis time-series graphs, sensor signal explorer, flight metrics, and flight trajectory map.
3. **Phase 2: Asynchronous Background Safety Analysis** — Safety record extraction and AI rule/ML evaluation run in the background worker. A compact status banner (`🔍 Running safety analysis... X%`) appears unobtrusively at the top of the screen with a live progress bar and an optional "Skip" button. You can freely explore graphs and the map while this runs. Once finished, the safety report seamlessly populates in the **Findings** tab.

### Offline Maps & PMTiles Support
- Online map layers (Carto Dark, Satellite, Street) load when connected to the internet.
- For air-gapped or remote field operations with no internet connectivity, click **Offline PMTiles** on the map toolbar to select a local `.pmtiles` vector/raster basemap. Flight trajectory, takeoff, landing, and fault markers will display over the local basemap offline.

## Live Viewer with the built-in simulator

Open **Live Viewer** and start its simulator from the settings. No SITL or MAVLink bridge is needed for this mode.

## ArduPilot SITL and bridge

The AeroVane website is already running in the background. Only SITL and the telemetry bridge need terminals.

Terminal 1 — start ArduCopter SITL from the root of an ArduPilot checkout.
`sim_vehicle.py` starts MAVProxy, which normally sends MAVLink to local UDP
ports `14550` and `14551` automatically:

```bash
cd /path/to/ardupilot
./Tools/autotest/sim_vehicle.py -v ArduCopter --console --map
```

Terminal 2 — from the AeroVane repository root, start the portable bridge.
It listens for MAVProxy on UDP `14550` and exposes the same MAVLink stream to
the browser on WebSocket `9988`:

```bash
cd /path/to/AeroVane
npm run bridge -- udpserver://0.0.0.0:14550 wsserver://127.0.0.1:9988
```

This Node.js bridge works on Windows, macOS, and Linux and has no additional
runtime dependencies.

Then open http://127.0.0.1:4173/live/, leave the URL as `ws://127.0.0.1:9988`, and click **Connect WS**.

If your MAVProxy configuration does not include UDP `14550`, add the output at
the `MANUAL>` or `GUIDED>` MAVProxy prompt:

```text
output add 127.0.0.1:14550
```

Alternatively, add `--out=127.0.0.1:14550` to the Terminal 1 command. Do not
use `--out=udp:127.0.0.1:14550`; that is not the MAVProxy `--out` format.
Only the AeroVane bridge should bind/listen on UDP port `14550`.

For a physical vehicle, use Chrome, Edge, or Brave, open Live Viewer, and click
**Connect USB**. Select the autopilot's serial device in the browser prompt. No
bridge or OS-specific device path is required.

For network telemetry from a TCP device, replace the example address with the
device's actual address:

```bash
cd /path/to/AeroVane
npm run bridge -- tcpclient://192.168.1.10:5760 wsserver://127.0.0.1:9988
```

For bridge-only testing with generated heartbeat telemetry:

```bash
cd /path/to/AeroVane
npm run bridge -- fakesource:// wsserver://127.0.0.1:9988
```

If the bridge stops, Live Viewer shows **Reconnecting** and retries with a controlled 1–10 second backoff. Restart the bridge and telemetry resumes automatically. Clicking **Disconnect WS** cancels all retries. If the bridge remains open but SITL becomes silent, the viewer reports **No Data** without treating the socket as closed.

## Use Mission Planner and AeroVane together

Connect the Ethernet ground-station antenna before takeoff. The bridge receives its MAVLink stream and sends a copy to both applications.

### UDP antenna

Close Mission Planner's existing connection, then run:

```bash
cd /path/to/AeroVane
npm run bridge -- udpserver://0.0.0.0:14550 udpclient://127.0.0.1:14551 wsserver://127.0.0.1:9988
```

Then connect:

- Mission Planner: choose **UDP** and use local port `14551`.
- AeroVane: open http://127.0.0.1:4173/live/, use `ws://127.0.0.1:9988`, and click **Connect WS**.

### TCP antenna

If the antenna normally uses an address such as `192.168.1.10:5760`, run:

```bash
cd /path/to/AeroVane
npm run bridge -- tcpclient://192.168.1.10:5760 tcpserver://127.0.0.1:5761 wsserver://127.0.0.1:9988
```

Then connect Mission Planner to TCP `127.0.0.1:5761` and AeroVane to `ws://127.0.0.1:9988`. Replace the antenna IP and port with its actual settings.

Test this setup with the drone safely on the ground first. Keep Mission Planner as the primary flight application, use AeroVane for monitoring, and do not change parameters from both applications simultaneously.

## Troubleshooting

- Homepage unavailable: run `systemctl --user restart aerovane.service` and check `journalctl --user -u aerovane.service -n 50`.
- Port 4173 already in use: run `ss -ltnp | grep 4173` and stop the conflicting local program.
- Live connection unavailable: ensure the bridge terminal shows port 9988 and the viewer uses `ws://127.0.0.1:9988`.
- Desktop shortcut is untrusted: right-click it and choose **Allow Launching** (desktop environments differ).
- Offline maps are blank: expected when external map tiles are unavailable; telemetry and analysis remain functional.
- Windows PowerShell blocks a command: use `npm.cmd` in place of `npm`, or allow
  locally installed scripts according to your organization's PowerShell policy.
- macOS does not show a USB device: verify the cable supports data and allow the
  browser access when macOS prompts for it.

## Developer verification

```bash
npm run verify
npm run build
npm start
```

Then verify `/`, `/live/`, and `/logs/`, including refresh and browser Back. For a recovery check, connect to the fake bridge, stop it, confirm **Reconnecting**, restart it, and confirm the message counters resume.
