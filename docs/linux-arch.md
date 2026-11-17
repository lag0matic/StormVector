# StormVector on Arch Linux

StormVector is still the same app and the same repo on Linux. There is no separate Linux fork planned.

## 1. Install system dependencies

Tauri uses WebKitGTK on Linux, so the main prerequisite is getting the WebKit and desktop integration packages installed first.

```bash
sudo pacman -Syu
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  base-devel \
  curl \
  wget \
  file \
  openssl \
  alsa-lib \
  appmenu-gtk-module \
  libappindicator-gtk3 \
  librsvg \
  xdotool
```

## 2. Install Rust

Forecast Briefing can save an OpenAI key through your desktop Secret Service
keyring. Run the app inside your normal desktop session with an unlocked
provider such as GNOME Keyring, or KWallet with Secret Service enabled. A missing
or locked provider produces an error in Prefs; the app never writes a plain-text
key file. Building the credential integration also requires D-Bus development
headers (`dbus` on Arch; `libdbus-1-dev` on Debian/Ubuntu).

```bash
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
source "$HOME/.cargo/env"
rustup default stable
```

## 3. Install Node.js

Use a current Node.js LTS release. On Arch that usually means:

```bash
sudo pacman -S --needed nodejs npm
```

## 4. Run StormVector

```bash
npm install
npm run tauri:dev
```

## 5. Build Linux bundles

```bash
npm run tauri:build
```

On Linux, Tauri can emit desktop bundles such as:

- AppImage
- `.deb`
- `.rpm`

## Notes

- AppImage is the easiest first Linux distribution target.
- If you later want AUR packaging, there is a starter PKGBUILD template in [packaging/PKGBUILD.template](../packaging/PKGBUILD.template).
- AppImages are convenient, but they are larger than native distro packages.
- For broad Linux compatibility, build on an older Linux base than the newest desktop you own.
