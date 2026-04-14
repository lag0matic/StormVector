# StormVector

A desktop-first U.S. weather workstation focused on:

- Live radar
- Radar playback
- GOES satellite imagery
- NWS forecasts and alerts
- SPC storm outlooks
- Winter weather guidance

## Current state

This repository is now scaffolded as a React + TypeScript + Vite frontend with:

- A map-first application shell
- A responsive forecast and hazard layout
- MapLibre integrated and ready for live layers
- A simple weather domain model we can connect to NOAA services next

The current UI is now a functional weather workstation scaffold with live NOAA/NWS integrations and room for more operational tools.

## Commands

```bash
npm install
npm run dev
npm run build
```

## Recommended next steps

1. Install Rust and the Tauri prerequisites for Windows
2. Add Tauri so this frontend runs as a desktop app shell
3. Implement the first NOAA adapters:
   - NWS point forecast
   - Alerts
   - Radar layer metadata
4. Replace the mock weather model with live data
5. Add a shared timeline model for radar and GOES playback

## Notes on data sources

Recommended first-party sources:

- NWS API for forecasts and alerts
- NWS radar services for live radar products
- SPC outlook layers for severe weather risk
- WPC winter products for winter impacts
- GOES imagery from NOAA satellite sources

## Tauri note

Rust is not installed on this machine yet, so the repository is currently scaffolded as a web frontend that is ready to be wrapped by Tauri once the Rust toolchain is available.
