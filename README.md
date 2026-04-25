# StormVector

StormVector is a desktop-first U.S. weather workstation for live monitoring.

It is built for practical situational awareness, with a map-first workflow and a focus on live weather monitoring rather than deep forecast-model analysis.

Current stable release: `v1.3.3`

## What it does

- Regional and local NWS radar with playback
- Local reflectivity and velocity products
- NEXRAD storm-cell tracks with motion, speed, forecast points, and observed time
- GOES visible, infrared, and water-vapor satellite imagery with playback
- Point-and-click NWS forecasts and current conditions
- Dewpoint, relative humidity, wind, gusts, sky cover, UV index, and air quality
- NWS watches, warnings, advisories, and alert polygons with severity / urgency details
- SPC severe-weather outlook overlays
- WPC winter-weather outlook overlays
- Recent local storm reports with magnitude, source, age, and remarks
- Manual storm-track / ETA drawing tool
- Saved home and favorite locations
- Audible nearby alerting for watches and warnings

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
