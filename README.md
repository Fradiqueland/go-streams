# Streamland

Portable studio for prerecorded video playlists and RTMP/RTMPS live streaming, by Antonio Fradique.

Current source version: **1.3.0**. Windows has an Electron desktop edition and setup EXE; Mac is delivered as a self-contained application bundle with a browser interface.

## Automatic intro, outro and local recording deletion (1.3.0)

In the recorder or live studio, open **Intro, outro & video clips** and select an intro, an outro, or both from the library. You can add a local video there or register a public HTTPS MP4 / supported individual YouTube link. Online sources use the existing authenticated library proxy and require Internet access. Use browser-playable MP4 or WebM; convert incompatible local formats in the library first. No additional Windows or Mac installation is required.

The intro plays automatically after starting. Stop plays the outro before finalizing the recording or ending live output. Video sound replaces the microphone/shared audio during playback, including when the standalone recorder's main sound is disabled. Skip returns to the programme; device release, capture errors and application shutdown cancel clips and finalize promptly. Automatic videos are for video mode. In the live studio, the composed picture and sound are shared by every currently active recording and broadcast, so each sees the clips. Saved scenes named Intro/Outro remain appearance presets; manual clips remain available separately.

Completed and interrupted local recordings offer **Delete recording**, with confirmation before permanent deletion. Active/finalizing recordings cannot be deleted. The operation removes only that recording's finished file and recovery data in its original folder, and its list entry. Imported library originals are preserved.

## Electron screen capture correction (1.2.1)

Preparing screen preview now accepts the canonical local origin URL returned by Electron, including its trailing slash. The previous literal comparison rejected valid recorder and live screen requests with `Invalid capture constraints`. Cross-origin, embedded-frame and missing-gesture requests remain blocked; each capture still requires source selection. Native CI verifies actual Electron capture and recorded bytes from its own test window without selecting desktop, camera, microphone or system audio.

## Streamland name and upgrade compatibility (1.2.0)

The application is now called **Streamland**. The interface, installers, shortcuts, application bundles and newly generated exports use the new name. Updating an existing installation retains its projects, settings, channels, playlists and saved application sessions. Close the application before updating; live broadcasts are not resumed automatically.

The existing data/profile locations and internal installation identifiers remain stable so the name change does not create an empty user profile. Windows data stays under `%LOCALAPPDATA%\Go Streams\data`, and Mac data stays under `~/Library/Application Support/Go Streams`. Existing `GO_STREAMS_*` environment variables, saved backup formats and portable folders with the previous name remain compatible. These internal names are compatibility details, not a separate application.

## Recording finalization and scene persistence (1.1.6)

Local studio recording now uses an independent recording pipeline over the same prepared picture and mixed audio. Stopping waits for the final browser data, ordered uploads and the recording encoder to finish, while a live broadcast keeps running. No devices are reopened and no additional software is required. Recording and broadcasting together use an additional encoder and therefore more CPU. Encoder shutdown failures remain visible and preserve recovery data. Saving a recording or recovering a file stays confirmed if only refreshing the file list fails.

Production scenes now save private presenter notes and separate microphone/shared-audio levels alongside the picture settings. Loading a scene restores the teleprompter and audio gains, while older scenes receive compatible defaults. Unsaved notes and levels are protected when changing language. Notes remain in the local browser profile and are not drawn into the composed video; sharing the application's own window can still expose its interface.

A browser-initiated recording stop also saves the final data automatically. Closing the Windows application or using the in-app exit action drains both recording panels before shutting down the server. A finalization error keeps the interface available for recovery and retry.

Live PNG snapshots wait for image encoding and report failures. The prerecorded overlay editor keeps its preview consistent when an image selection is cleared or replaced and ignores late responses from a closed form. The Windows screen/window picker offers pages of sources so windows beyond the first twenty remain selectable, with explicit cancellation on every page.

## Capture and settings reliability (1.1.5)

Saving a production scene waits for selected images to finish loading and preserves PNG/WebP transparency. Very narrow images retain valid dimensions. Unsaved production edits remain protected when changing language. Recording downloads are also checked inside the packaged Electron application, including matching file bytes and keeping the studio page open.

Capture startup rejects previews that were cancelled or replaced, and stopping a feed drains accepted uploads once while preserving finalization errors. Actions for removed media, playlists or schedules no longer select a different item. Saved SMTP passwords are reused only for the same server, port, security mode and user; changing that identity requires a new password when authenticated notifications are enabled. Project imports reject invalid schedule date types.

## Recorder production tools and live formats (1.1.4)

Information icons appear beside relevant system controls. Sidebar navigation, the application brand, website and social links do not get an adjacent **i**. Explanations open only by clicking, touching or activating the information icon with the keyboard; hovering over the original control does not open help.

The video recorder includes the same local production tools as the live studio: picture-in-picture and side-by-side layouts, mirrored camera, logo and background images, colors, presenter name/title, banners, a scrolling ticker and emoji insertion. Adjust microphone and shared-audio levels separately, save/load four scenes, play local intro/outro clips and save the composed frame as a PNG. Recorder scenes are stored separately from live scenes in the local browser profile. Clips temporarily replace the picture and selected audio, then return to the camera/screen; choosing silent video also keeps clips silent. Private notes and the scrolling teleprompter stay outside the composed frame, although sharing the app's own window can expose its interface. These picture tools are hidden in audio-only recording mode.

Live capture offers six fixed output proportions: **16:9, 9:16, 1:1, 4:3, 3:4 and 21:9**, at 720p or 1080p. The prepared preview can change proportion before output starts without reopening devices. Dimensions remain locked while broadcasting or making a local recording, so the encoded feed keeps the selected format. These features use the bundled application components and require no additional Windows or Mac installation.

## Recovery and persistence review (1.1.3)

VP8 capture preserves explicitly declared color range and matrix metadata before encoding, including recording, shared live feeds and direct live capture. The bounded WebM header reader accepts fragmented uploads. Both capture panels prefer VP9; their VP8 fallback uses a software sRGB canvas to keep frame colors consistent during recording. Browser verification repeats the VP8 fallback and compares decoded output colors. Audio processing is unchanged.

Cancelling a pending recording start releases preview devices immediately. The recorder preserves visible upload/finalization errors, reports successful recovery, rejects stale default-folder responses and supports horizontal or vertical camera resizing with a fixed upper-left corner. Browser checks exercise failed finalization, recovery, a real recording download, cancelled folder selection and a new recording after an upload failure.

Contextual information closes when its source is hidden. Editing a removed channel or playlist cannot silently create a replacement. OAuth settings and replacement accounts become active only after successful persistence; revocation closes active chat sessions even if the disk write fails. Downloads preserve the exact configured FFmpeg executable path, including renamed executables.

## Recorder proportions and explicit help (1.1.2)

Recording controls and the elapsed timer sit beside the result preview. Choose Original, 16:9, 9:16, 1:1, 4:3 or 3:4 before recording; changing the ratio updates an already prepared preview without reopening devices. Screen selections fit inside the chosen frame without stretching, with margins when needed. Camera-only video fills the frame; the movable camera inset remains square.

An adjacent **i** button opens contextual help only when activated by click, touch or keyboard. Hovering or focusing the original control does not open explanations. Close help with the same icon, Escape or a click outside.

## Reliability review (1.1.1)

Recorder finalization drains the browser's last data event after a recording error and serializes simultaneous stop requests. Crop gestures cannot resize an active recording, camera coordinates match the displayed position, and the overlay outline follows the actual camera size on small screens. Recordings retain their actual folder when the default changes, and native folder selection starts in the current folder when it still exists.

Confirmed settings saves remain visible if refreshing status fails. YouTube downloads and online sources reuse Electron's included JavaScript runtime in Node mode; no separate Node installation is needed. Electron data migration retries temporary Windows directory locks for a bounded time and preserves destinations created concurrently. Regression coverage includes these failure paths, consecutive recordings, cancelled capture selection, audio/video download metadata and keyboard camera positioning. Windows and Mac workflows run ten complete regression cycles and synthetic browser checks before packaging.

## Video and audio recorder (1.1.0)

Open **Video & audio recorder** to record a screen, window, selected area, camera, screen with a square camera overlay, or audio only. Select microphone, shared computer audio, both, or silent video. The browser/system picker must supply a live audio track for computer audio; if it does not, preparation explains the missing source and does not silently record without it. Windows Electron supports system loopback; Mac browser audio availability depends on the selected source and browser. No virtual audio driver installation is required or offered.

Prepare a local preview, drag a rectangle over the source to choose the recorded area, and drag or resize the square camera overlay on the result. Percentage fields, arrow keys and a size slider provide keyboard alternatives. Choose a recording folder for this session or save/use the default. The optional 3/5/10-second countdown can be cancelled before recording starts. Video is saved as H.264/AAC MP4; audio-only recording is AAC M4A with no video track. Encoding runs during recording using bundled FFmpeg. Files go directly to the chosen local folder, and finalizing preserves recoverable local data if a disk or encoding error occurs.

The recorder survives navigation between app pages. Closing its preview finishes the recording and releases devices. Recording does not create a broadcast or cloud copy. The OS still asks permission to access the screen, camera or microphone. Use `npm run test:recorder:browser` with the Playwright QA package for synthetic crop, camera drag/resize, countdown, folder, navigation, video/audio and responsive checks. Physical devices and native source pickers require manual verification.

## Interface review (1.0.10)

Changing language waits for pending chat or recording-folder operations and preserves unsent messages, account edits and unsaved recording preferences. Chat account status refreshes retain edited setup forms, and setup fields stay locked until a save completes. Submitted client secrets are cleared from the form after a successful save. Contextual help scrolling, placement and project-export guidance remain supported. Restoring keyboard focus after a view refresh no longer reopens dismissed help over neighbouring controls.

## Easier dashboard and contextual help (1.0.10)

The overview separates live camera/microphone/screen streaming from prepared videos and playlists. The menu groups broadcasting, content/destinations and application settings. Activate the adjacent information icon to read an explanation; press Escape to dismiss it. Picture/presenter settings and clips expand when needed, while local recording remains directly available. Preview, preparation, recording and public broadcast controls explain their different effects.

## Live camera and screen capture (1.0.10)

Choose **Microphone only** to broadcast microphone audio with a selected background or image without camera/screen permission. Local recording can ask for a folder at each start or remember a default; recording files are written directly to the selected folder.

Open **Live camera & screen** to preview a camera, a screen/window, or a screen with a camera inset. Choose a microphone, 720p/1080p and landscape/portrait, then select one or more configured RTMP/RTMPS channels and explicitly confirm **Start live broadcast**. Preview alone never starts a broadcast. The original prerecorded single-video, playlist, repeat, schedule, queue and backup options remain available.

Capture uses the browser's media APIs and a bounded in-memory WebM upload queue. The bundled FFmpeg encodes one shared H.264/AAC feed for the RTMP destinations. Local recording uses its own encoder over the same composed browser stream so its final data can be drained independently. Destination workers have independent status and failures, share the existing concurrency limit and channel reservations, and appear in the monitor/history. Stop individual destinations in the monitor or stop the live feed from the capture page. Live input cannot be paused, replayed or resumed from a saved position; start a fresh live session after an interruption.

Microphone mute, local preview and explicit device release are available. Camera/device permissions and screen/window selection require user consent. Windows Electron supplies a source picker; the Mac browser uses its native permission and sharing dialogs. Shared screen/tab audio depends on the browser, selected source and OS. WebM MediaRecorder support is required (the included Windows Electron browser, Chrome/Edge, or Safari 18.4+ on Mac). No separate Node.js, FFmpeg, FFprobe or yt-dlp installation is needed. The optional local recording saves the composed video/audio to this computer; cloud recording is excluded. Live input is never restored automatically on startup. Closing/reloading the capture page interrupts live capture; the backend stops idle/disconnected inputs after a bounded timeout. Navigation inside the app preserves the capture panel and preview.

Bandwidth and CPU load grow with the number of destinations. The computer and app must remain running and awake. Check account eligibility, stream keys and receipt in each platform's own dashboard. No public platform broadcast or long-duration 24/7 live capture certification is implied by loopback tests.

Verification: `npm run test:live` exercises consent, API authentication, destination isolation, bounded uploads, timeout/stop behavior and two native RTMP loopback receivers. `npm run test:live:browser` exercises the real browser with synthetic camera/microphone, without accessing real devices or publishing externally. Actual hardware and native screen picker checks remain manual.

## Local production and unified chat

The capture studio includes live layouts, logo/background/colors, presenter titles, banners, a moving ticker, local intro/outro clips, reusable scenes, private notes/teleprompter, snapshots and independent local MP4 recording. YouTube and Twitch chat adapters aggregate messages and allow explicit replies to the selected destination; official OAuth application configuration and account authorization are required. Twitch Shared Chat can relay a reply to linked Twitch channels according to platform rules. Other platforms are clearly marked unsupported for integrated chat.

See [the feature scope and account setup guide](app/STREAMYARD-FEATURE-SCOPE.md) for current capabilities and validation limits. Cloud recording is excluded; no guest/webinar hosting service is deployed.

## Electron Windows edition

The Electron edition includes its own Chromium window and Node.js runtime, plus FFmpeg, FFprobe and yt-dlp. The setup EXE installs the application and creates desktop and Start menu shortcuts. It uses the fixed identity `net.antoniofradique.gostreams`; install files are separate from `%LOCALAPPDATA%\Go Streams\data`. The Electron session stays in `data\electron-session` across upgrades. Uninstallation deletes only the packaged files and keeps projects, protected credentials, session data and unknown user-added files.

The first launch reuses existing projects and credentials. Local UI preferences can be copied once from the old dedicated browser profile. Edge/Chrome cookie databases remain untouched and are not converted into Electron cookies; external services may require a first sign-in in a different browser. Subsequent Electron updates keep the same persistent session path.

Closing the Electron window drains the engine and exits. When streams or other operations are active, closing requires confirmation. HTTPS product and social links open in the system browser. The renderer has no Node.js integration and runs with context isolation and Chromium sandboxing enabled.

The pinned Electron ZIP and official SHA-256 digest are recorded in `app/electron/toolchain.json`. Build with `app/scripts/build-electron-windows.py`; use `--portable` to recover verified runtimes from an existing single-file release or `--application-root` for a prepared Windows folder. Supply the pinned ZIP, NSIS compiler and rcedit through the documented command-line arguments. The GitHub workflow builds the setup EXE on Windows and runs installer and native session tests; its reports distinguish successful verification from failures. No code signing certificate or live update feed is included.

## Windows installation and updates

The Windows MSI includes Node.js, FFmpeg, FFprobe and yt-dlp. It installs for the current user under `%LOCALAPPDATA%\Programs\Streamland` and creates desktop and Start menu shortcuts. Projects, settings, protected credentials and the dedicated browser profile remain under `%LOCALAPPDATA%\Go Streams\data`, outside the installation directory. Updates and uninstallation do not package or delete that data folder.

Close Streamland before installing an update. Run the new MSI over the existing installation; there is no need to uninstall first. The installer keeps the same upgrade identity and blocks installing an older version. Signed update downloads now preserve the `.msi` extension; installation is started manually after closing the application.

The first installed launch reuses existing data in the standard user folder. It can also copy a portable data folder next to the installer, leaving the original untouched. If that folder is elsewhere, enter its full path (the folder containing `project.json`) in the installer's optional portable data field. Existing installed data is never overwritten by a later migration. Close the portable application before copying its browser profile. Transient local engine tokens are recreated on launch; saved browser cookies, preferences and user data are retained.

Build on Windows with Python **3.11 or 3.12** (the MSI authoring module is bundled in those versions):

```powershell
cd app
python scripts/build-windows-installer.py --portable "release/Streamland-1.2.1-SingleFile.exe"
python scripts/verify-windows-installer.py release/Streamland-1.2.1-Windows-Setup.msi --native
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
node scripts/build-mac-launcher.mjs
node scripts/prepare-portable.mjs --platform=darwin
python scripts/package-mac-portable.py --destination release/Streamland-1.2.1-Mac-Portable/Mac-Portable
```

The first command builds the universal native Mac launcher from `app/scripts/mac-launcher/` and writes it with its integrity manifest under `app/vendor/mac-launcher/`. It requires Go on the build machine; CI uses Go 1.27.3. Set `STREAMLAND_GO` to select a Go executable, or use the compatible `GO_STREAMS_GO` variable. End users do not need Go or development tools. The generated `Streamland.app` contains both processor runtimes and requires macOS 13.5 or later. The Mac CI matrix runs native startup, runtime, interface and recording checks on macOS 15 for Intel and Apple Silicon. Each build publishes its verification reports; consult those reports for completed checks. No Developer ID signing or notarization is claimed.

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

