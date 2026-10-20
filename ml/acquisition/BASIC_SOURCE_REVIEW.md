# BASiC source review

Reviewed: 2026-09-29

- Official record: Zenodo 8199999, DOI `10.5281/zenodo.8199999`
- License: CC BY 4.0, confirmed through the official Zenodo API
- Scope: 70 ArduPilot SITL DataFlash text logs, 2,898,419,918 bytes
- Fault families: GPS, remote-control link, accelerometer, gyroscope, compass,
  and barometer, plus ten no-failure flights
- Ground truth: injected sensor failure with post-injection health/status flags
- Domain limitation: simulated ArduCopter flights; not evidence of real hardware
  failure performance
- Privacy: raw names contain absolute dates/times and must remain under ignored
  `data/`; committed manifests use neutral IDs
- Training status: pilot acquisition authorized; training prohibited until
  parsing, label-onset extraction, grouping, privacy, and split gates pass

The data article documents ten simulated locations, each with one normal and
six fault flights. Flights from the same location must remain in one collection
group to prevent mission/trajectory leakage.
