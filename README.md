# StormVector

StormVector is a desktop-first U.S. weather workstation for live monitoring.

It is built for practical situational awareness, with a map-first workflow and a focus on live weather monitoring rather than deep forecast-model analysis.

Current stable release: `v1.3.3`

## What it does

- Regional and local radar
- Local velocity radar
- Radar playback
- GOES satellite imagery with playback
- Point-and-click NWS forecasts
- NWS watches and warnings
- SPC severe outlooks
- WPC winter outlooks
- Local storm reports
- Storm-track / ETA tool
- Saved home / favorite locations
- Audible nearby alerting

## Status

This is a real working app, but it is still an early personal project.

It was very much vibe coded with the help of OpenAI Codex, and I am not a professional software developer. Bugs, rough edges, odd UI behavior, and incomplete integrations may still exist.

## Tech

- React
- TypeScript
- Vite
- MapLibre
- Tauri

## Download

Download the packaged app from the latest GitHub release.

Current `v1.3.3` release files:

- Windows: `StormVector_1.3.3_x64-setup.exe`
- Linux AppImage: `stormvector-appimage-1.3.3.zip`
- Linux Debian / Ubuntu: `stormvector-deb-1.3.3.zip`
- Linux Fedora / RHEL / openSUSE: `stormvector-rpm-1.3.3.zip`

The Linux downloads are packaged apps. You should not need Node.js, Rust, or Tauri installed unless you are building StormVector from source.

## Running from source

```bash
npm install
npm run dev
npm run build
npm run tauri:dev
npm run tauri:build
```

For source builds on Linux, see [docs/linux-arch.md](docs/linux-arch.md) for an Arch-focused setup note.

## Data sources

StormVector currently uses public weather data sources including:

- NOAA / NWS
- NOAA NEXRAD
- NOAA SPC
- NOAA WPC
- NOAA nowCOAST
- NOAA AviationWeather
- Iowa State Mesonet
- Open-Meteo

## Open source

StormVector is open source under the GNU General Public License v3.0.

See [LICENSE](LICENSE).
