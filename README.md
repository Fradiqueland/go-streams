# Go Streams

Portable studio for prerecorded video playlists and RTMP/RTMPS live streaming, by Antonio Fradique.

Current application version: **0.15.5**, for Windows and macOS (Intel and Apple Silicon).

The application source, translations, artwork, tests and packaging scripts are in [`app/`](app/). See [`app/README.md`](app/README.md) for capabilities, verification coverage and known validation limits.

## Restore and build

Building requires Node.js 24+, Python 3.11+ and Internet access for the pinned runtime dependencies. These are development requirements; the generated application includes Node.js, FFmpeg, FFprobe and yt-dlp. The app uses an available system browser for its interface.

From the `app` directory:

```powershell
node scripts/prepare-portable.mjs --platform=win32
node scripts/build-single-file.mjs
```

Build the Windows executable on Windows, using the .NET Framework C# compiler provided by the build script. The output is under `app/release/`.

To build the Mac application and the portable delivery:

```powershell
node scripts/prepare-portable.mjs --platform=darwin
python scripts/package-mac-portable.py --destination release/GoStreams-0.15.5-Mac-Portable/Mac-Portable
```

The universal native Mac launcher is included under `app/vendor/mac-launcher/`, with its checksum, Go source and license notices. Rebuilding that launcher also requires a Go toolchain. The generated `GoStreams.app` contains both processor runtimes and requires macOS 13.5 or later. Native execution on a Mac is not yet verified; no Developer ID signing or notarization is claimed.

## Verification

```powershell
cd app
node scripts/check.mjs
npm test
```

Windows desktop verification: `app/scripts/verify-desktop.ps1`. Some tests require the prepared binaries, a normal desktop session or local loopback networking.

## What is stored here

This repository stores the application source and reproducible build inputs. Runtime downloads are pinned by manifests and verified during preparation. Generated releases, caches, personal projects, sessions, stream keys, secret vaults, videos, and reverse-engineering inputs are excluded. Back up personal projects through the application's encrypted export separately.

The REA analysis workspace and original Livecaster program are not part of this application repository. REA, if needed for further development, is available separately at https://github.com/morluto/rea.

Created by Antonio Fradique. More products: https://AntonioFradique.net
