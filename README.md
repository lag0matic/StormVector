# StormVector

StormVector is a desktop-first U.S. weather workstation for live monitoring.

It is built for practical situational awareness, with a map-first workflow and a focus on live weather monitoring rather than deep forecast-model analysis.

Current stable release: `v1.3.0`

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

## Running it

```bash
npm install
npm run dev
npm run build
npm run tauri:dev
npm run tauri:build
```

## Linux support

StormVector should stay in this same repo for Linux. It is already a Tauri desktop app, so Linux is a platform target, not a separate fork.

### Arch prerequisites

On Arch-based systems, install the Tauri Linux prerequisites:

```bash
sudo pacman -Syu
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  base-devel \
  curl \
  wget \
  file \
  openssl \
  appmenu-gtk-module \
  libappindicator-gtk3 \
  librsvg \
  xdotool
```

You will also need:

```bash
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
```

and a current Node.js LTS install.

### Arch build flow

```bash
npm install
npm run tauri:dev
npm run tauri:build
```

When built on Linux, Tauri can generate Linux bundles such as:

- AppImage
- `.deb`
- `.rpm`

See [docs/linux-arch.md](docs/linux-arch.md) for a more practical Arch-focused setup note.

## Packaged app

Windows builds are produced through Tauri. Current release packaging generates:

- `src-tauri/target/release/bundle/nsis/StormVector_1.3.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/StormVector_1.3.0_x64_en-US.msi`

## Data sources

StormVector currently uses public weather data sources including:

- NOAA / NWS
- NOAA SPC
- NOAA WPC
- Iowa State Mesonet

## Open source

StormVector is open source under the GNU General Public License v3.0.

See [LICENSE](LICENSE).
