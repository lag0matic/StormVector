# StormVector

StormVector is a desktop-first U.S. weather workstation built for practical situational awareness: live radar, warnings, storm reports, forecast overlays, and point weather in one map-centered app.

Current stable release: `v1.4`

## Highlights

- Regional NWS radar with base and composite reflectivity playback.
- Local NWS radar with reflectivity, velocity, radar-site selection, and playback.
- HRRR future radar mode with simulated reflectivity forecast frames.
- NEXRAD storm-cell tracks with motion, speed, forecast points, and observed time.
- GOES visible, infrared, and water-vapor satellite imagery with playback.
- NWS watches, warnings, advisories, and alert polygons with severity and urgency details.
- SPC severe-weather outlook overlays.
- WPC winter-weather outlook overlays.
- Recent local storm reports with magnitude, source, qualifier, age, and full remarks.
- Point-and-click NWS forecast, current conditions, dewpoint, relative humidity, wind, gusts, and sky cover.
- UV index and air quality pills powered by Open-Meteo.
- Manual storm-track and ETA drawing tool for quick what-if timing.
- Saved home and favorite locations.
- Audible nearby alerting for watches and warnings.
- Light and dark map/workstation themes.

## Download

Download the packaged app from the latest GitHub release.

Current `v1.4` release files:

- Windows: `StormVector_1.4.0_x64-setup.exe`
- Linux AppImage: `stormvector-appimage-1.4.0.zip`
- Linux Debian / Ubuntu: `stormvector-deb-1.4.0.zip`
- Linux Fedora / RHEL / openSUSE: `stormvector-rpm-1.4.0.zip`

The Linux downloads are packaged apps. You should not need Node.js, Rust, Tauri, or other development prerequisites unless you are building StormVector from source.

## Status

StormVector is a real working app, but it is still an early personal project. Use it as a situational-awareness aid, not as your only source for safety-critical weather decisions.

This project is coded with AI assistance, including OpenAI Codex. Human review, testing, and release decisions still matter, and bugs or rough edges may exist.

## Data Sources And Attribution

StormVector uses public weather and map data from several services. Data availability, latency, and product definitions are controlled by the upstream providers.

- NOAA / National Weather Service: alerts, forecasts, current conditions, radar services, and weather office metadata.
- NOAA nowCOAST: GOES satellite imagery services.
- NOAA NEXRAD / Level III: radar-site products and storm-cell tracking products.
- NOAA High-Resolution Rapid Refresh (HRRR): simulated reflectivity guidance for future radar mode.
- NOAA Storm Prediction Center: severe-weather outlook products.
- NOAA Weather Prediction Center: winter-weather outlook products.
- NOAA AviationWeather: aviation-oriented weather data used by supporting services.
- Iowa State Mesonet: local storm report feeds and related weather-product access.
- Open-Meteo: UV index and air quality forecast data.
- OpenStreetMap contributors: light basemap tiles.
- CARTO: dark basemap tiles.
- EOAPI / TiTiler-compatible raster rendering: HRRR GRIB-to-map-image rendering for future radar mode.

StormVector is not affiliated with, endorsed by, or certified by NOAA, the National Weather Service, Open-Meteo, OpenStreetMap, CARTO, Iowa State University, or EOAPI.

## Built With

- React
- TypeScript
- Vite
- MapLibre GL
- Tauri
- Rust

## Running From Source

```bash
npm install
npm run dev
npm run build
npm run tauri:dev
npm run tauri:build
```

For source builds on Linux, see [docs/linux-arch.md](docs/linux-arch.md) for an Arch-focused setup note.

## License

StormVector is open source under the GNU General Public License v3.0.

See [LICENSE](LICENSE).
