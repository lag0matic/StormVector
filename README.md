# StormVector

StormVector is a desktop-first U.S. weather workstation for live monitoring.

It is built for practical situational awareness, with a map-first workflow and a focus on live weather monitoring rather than deep forecast-model analysis.

## What it does

- Regional and local radar
- Radar playback
- GOES satellite imagery with playback
- Point-and-click NWS forecasts
- NWS watches and warnings
- SPC severe outlooks
- WPC winter outlooks
- Local storm reports
- Camera overlays
- Storm-track / ETA tool
- Audible nearby alerting
- YouTube-filtered chaser overlay

## Status

This is a real working app, but it is still an early personal project.

It was very much vibe coded with the help of OpenAI Codex, and I am not a professional software developer. Bugs, rough edges, odd UI behavior, and incomplete integrations may still exist.

## Tech

- React
- TypeScript
- Vite
- MapLibre
- Tauri

## Running it

```bash
npm install
npm run dev
npm run build
npm run tauri:dev
npm run tauri:build
```

## Packaged app

Windows builds are produced through Tauri. Current release packaging generates:

- `src-tauri/target/release/bundle/nsis/StormVector_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/StormVector_0.1.0_x64_en-US.msi`

## Data sources

StormVector currently uses public weather and transportation data sources including:

- NOAA / NWS
- NOAA SPC
- NOAA WPC
- NOAA nowCOAST
- Iowa State Mesonet
- OHGO
- INDOT TrafficWise
- Spotter Network feeds

## Open source

StormVector is open source under the GNU General Public License v3.0.

See [LICENSE](LICENSE).
