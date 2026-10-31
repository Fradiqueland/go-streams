# Go Streams

Portable studio for prerecorded video playlists and RTMP/RTMPS live streaming, by Antonio Fradique.

Current source version: **0.18.0**. Windows has an Electron desktop edition and setup EXE; Mac is delivered as a self-contained application bundle with a browser interface.

## Live camera and screen capture (0.18.0)

Open **Live camera & screen** to preview a camera, a screen/window, or a screen with a camera inset. Choose a microphone, 720p/1080p and landscape/portrait, then select one or more configured RTMP/RTMPS channels and explicitly confirm **Start live broadcast**. Preview alone never starts a broadcast. The original prerecorded single-video, playlist, repeat, schedule, queue and backup options remain available.

Capture uses the browser's media APIs and a bounded in-memory WebM upload queue. The bundled FFmpeg converts the feed to H.264/AAC for each destination. Destination workers have independent status and failures, share the existing concurrency limit and channel reservations, and appear in the monitor/history. Stop individual destinations in the monitor or stop the live feed from the capture page. Live input cannot be paused, replayed or resumed from a saved position; start a fresh live session after an interruption.

Microphone mute, local preview and explicit device release are available. Camera/device permissions and screen/window selection require user consent. Windows Electron supplies a source picker; the Mac browser uses its native permission and sharing dialogs. Shared screen/tab audio depends on the browser, selected source and OS. Chromium with WebM MediaRecorder support is required. The optional local recording saves the composed video/audio to this computer; cloud recording is excluded. Live input is never restored automatically on startup. Closing/reloading the capture page interrupts live capture; the backend stops idle/disconnected inputs after a bounded timeout. Navigation inside the app preserves the capture panel and preview.

Bandwidth and CPU load grow with the number of destinations. The computer and app must remain running and awake. Check account eligibility, stream keys and receipt in each platform's own dashboard. No public platform broadcast or long-duration 24/7 live capture certification is implied by loopback tests.

Verification: `npm run test:live` exercises consent, API authentication, destination isolation, bounded uploads, timeout/stop behavior and two native RTMP loopback receivers. `npm run test:live:browser` exercises the real browser with synthetic camera/microphone, without accessing real devices or publishing externally. Actual hardware and native screen picker checks remain manual.

## Local production and unified chat

The capture studio includes live layouts, logo/background/colors, presenter titles, banners, a moving ticker, local intro/outro clips, reusable scenes, private notes/teleprompter, snapshots and independent local WebM recording. YouTube and Twitch chat adapters aggregate messages and allow explicit replies to the selected destination; official OAuth application configuration and account authorization are required. Other platforms are clearly marked unsupported for integrated chat.

See [the feature scope and account setup guide](app/STREAMYARD-FEATURE-SCOPE.md) for current capabilities and validation limits. Cloud recording is excluded; no guest/webinar hosting service is deployed.

## Electron Windows edition

The Electron edition includes its own Chromium window and Node.js runtime, plus FFmpeg, FFprobe and yt-dlp. The setup EXE installs the application and creates desktop and Start menu shortcuts. It uses the fixed identity `net.antoniofradique.gostreams`; install files are separate from `%LOCALAPPDATA%\Go Streams\data`. The Electron session stays in `data\electron-session` across upgrades. Uninstallation deletes only the packaged files and keeps projects, protected credentials, session data and unknown user-added files.

The first launch reuses existing Go Streams projects and credentials. Local UI preferences can be copied once from the old dedicated browser profile. Edge/Chrome cookie databases remain untouched and are not converted into Electron cookies; external services may require a first sign-in in a different browser. Subsequent Electron updates keep the same persistent session path.

Closing the Electron window drains the engine and exits. When streams or other operations are active, closing requires confirmation. HTTPS product and social links open in the system browser. The renderer has no Node.js integration and runs with context isolation and Chromium sandboxing enabled.

The pinned Electron ZIP and official SHA-256 digest are recorded in `app/electron/toolchain.json`. Build with `app/scripts/build-electron-windows.py`; use `--portable` to recover verified runtimes from an existing single-file release or `--application-root` for a prepared Windows folder. Supply the pinned ZIP, NSIS compiler and rcedit through the documented command-line arguments. The GitHub workflow builds the setup EXE on Windows and runs installer and native session tests; its reports distinguish successful verification from failures. No code signing certificate or live update feed is included.

## Windows installation and updates

The Windows MSI includes Node.js, FFmpeg, FFprobe and yt-dlp. It installs for the current user under `%LOCALAPPDATA%\Programs\Go Streams` and creates desktop and Start menu shortcuts. Projects, settings, protected credentials and the dedicated browser profile remain under `%LOCALAPPDATA%\Go Streams\data`, outside the installation directory. Updates and uninstallation do not package or delete that data folder.

Close Go Streams before installing an update. Run the new MSI over the existing installation; there is no need to uninstall first. The installer keeps the same upgrade identity and blocks installing an older version. Signed update downloads now preserve the `.msi` extension; installation is started manually after closing the application.

The first installed launch reuses existing data in the standard user folder. It can also copy a portable data folder next to the installer, leaving the original untouched. If that folder is elsewhere, enter its full path (the folder containing `project.json`) in the installer's optional portable data field. Existing installed data is never overwritten by a later migration. Close the portable application before copying its browser profile. Transient local engine tokens are recreated on launch; saved browser cookies, preferences and user data are retained.

Build on Windows with Python **3.11 or 3.12** (the MSI authoring module is bundled in those versions):

```powershell
cd app
python scripts/build-windows-installer.py --portable "release/GoStreams for Windows-0.15.5.exe"
python scripts/verify-windows-installer.py release/GoStreams-0.16.0-Windows-Setup.msi --native
```

An existing prepared Windows folder can be supplied with `--application-root` instead. Runtime bytes extracted from a single-file executable are checked against its embedded SHA-256 manifest before packaging. Python and the compiler are build requirements only. The generated application still uses an available system browser for its interface.

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
