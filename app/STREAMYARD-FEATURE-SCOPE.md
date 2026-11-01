# Go Streams live studio scope — 1.0.6

The scope is functional inspiration from StreamYard, implemented independently. It is not a claim of complete product parity. Existing prerecorded video features remain supported. The agreed scope is features feasible in the current Windows/Mac desktop architecture. **Cloud recording and cloud storage are explicitly excluded.** No public guest/webinar server is deployed by this change.

## Included

| Area | Go Streams implementation | Verification / limits |
| --- | --- | --- |
| Multistream | One captured source to multiple configured RTMP/RTMPS destinations | Independent workers; shares channel reservations and concurrency limits with prerecorded streams |
| Camera and microphone | Device selection, preview, microphone mute, mixed audio meter | Browser/OS media permission required; real device testing remains manual |
| Screen sharing | Screen/window selection; screen with camera inset | Shared audio depends on OS, browser and chosen source |
| Layouts | Camera, screen, picture in picture and side-by-side presentation | Live changes; landscape/portrait at 720p/1080p |
| Branding | Logo, background image, colors, mirrored camera | User-provided PNG/JPEG/WebP images; local processing |
| Lower thirds and banners | Presenter name/title, banner and moving ticker | Rendered into the composed video |
| Intro/outro and clips | Local MP4/WebM clip replaces the live picture and ducks source audio | Returns to camera/screen when ended; compatible browser codecs required |
| Reusable scenes | Four saved production presets | Kept in the browser's local profile; includes branding and text; not a shared online studio |
| Presenter notes | Private notes and scrolling teleprompter | Not drawn into the program frame; screen sharing the application itself can still expose its UI |
| Snapshots | Download a PNG of the composed frame | Requires an active local preview |
| Local recording | Record composed MP4 and mixed audio independently of RTMP broadcasting | Stored on this computer only; bounded upload buffer, finalized index/duration, interrupted-file recovery |
| Chat aggregation | YouTube and Twitch messages in one panel with origin labels and filters | Official provider authorization and registered OAuth applications required |
| Presenter replies | Explicit sends to one selected originating destination | YouTube uses a viewer mention; Twitch uses threaded reply IDs and may relay to linked channels in a Shared Chat session; rate limits, moderation and quotas apply |
| Featured comments | Show/hide an incoming comment on the captured program | Local canvas overlay; does not automatically post a message |
| Unsupported platform chat | Clear capability status and existing producer dashboard link | No simulated integration; RTMP streaming support does not imply chat API support |
| Production shortcuts | Ctrl+Alt+1–4 for layouts; Ctrl+Alt+R for local recording | No shortcut automatically starts a public broadcast |
| Existing video features | Single videos, playlists, repeat, scheduling, queue control, overlays, import/export and history | Original engine and regression suite retained |

## Outside this desktop-only update

- Cloud recording, cloud storage and cloud recording quotas: excluded by request.
- Public guest invitation links, remote greenroom, remote co-producers and guest-owned destination authorization: require a hosted HTTPS signalling service, TURN/network configuration and an access-control design. Not represented as working features in this release.
- Embedded public webinar player, registration, attendee emails, analytics and online event hosting: require an independently deployed service and public domain.
- AI clipping, transcription, AI-generated backgrounds and segmentation: require additional models/services, licensing and hardware or API configuration; no placeholder controls are exposed.
- Native chat integration for additional platforms: requires their own supported APIs, account permissions and approvals. RTMP server/key details alone cannot authorize chat access.
- Separate remote participant recordings and per-participant audio tracks: no remote participant engine is shipped here. Local recording captures the composed program and mixed audio.
- 4K capture/recording and additional simultaneous cameras: not advertised or enabled by the current tested 720p/1080p capture pipeline.

## Chat account setup

Chat login does not require sharing a password with Go Streams. Credentials stay encrypted in the user data directory; messages are retained only in memory (up to 500). Chats start disconnected after application restart. Chat account credentials, local recordings and saved browser scenes are not embedded in project/backup exports; preserve the user data/profile folders and copy recording files separately.

### YouTube

1. Register a **Desktop app** OAuth client in your own Google Cloud project and enable the YouTube Data API.
2. Configure the consent screen, allowed/test users and any required Google verification for the intended distribution.
3. In **Unified chat → Accounts → OAuth application setup**, save the client ID and the desktop client secret supplied by Google, if required for that client.
4. Choose **Sign in** and open the authorization link in your system browser. The app uses a loopback redirect, state validation and PKCE.
5. Connect the corresponding Go Streams destination to the active YouTube video's URL or ID. The account needs permission to read/post to that chat.

The implementation respects `pollingIntervalMillis`, uses the returned page token, and reports authorization, quota and rate-limit errors. Polling consumes YouTube API quota; a connected status is not a guarantee of unlimited usage.

### Twitch

1. Register a **public** Twitch OAuth application and configure its client ID in the chat setup.
2. Choose **Sign in**, open the Twitch activation link and authorize the displayed device code. No client secret is needed for the public device flow.
3. Grant `user:read:chat` and `user:write:chat` and connect the Twitch channel name/URL. The current adapter uses one EventSub WebSocket per destination; Twitch limits a client-ID/user pair to three enabled WebSocket connections. A fourth room reports a provider error; socket pooling is outside this patch.
4. Messages arrive through EventSub WebSocket; replies use the official Send Chat Message API. Public-device refresh tokens are rotated and refresh requests are serialized. Twitch authorizations are validated on application startup and hourly, including receive-only sessions. Confirmed revocation closes that account's chats; temporary provider failures are retried without discarding a valid authorization.

Twitch Shared Chat sessions may relay user-token replies to linked channels. This token type cannot use `for_source_only`; Go Streams sends one request to the selected broadcaster and Twitch determines its distribution.

## Standalone runtime

Windows Electron includes its browser and runtime. The Mac bundle includes Node.js, FFmpeg, FFprobe and yt-dlp and opens a system browser. Built-in Safari 18.4+ supports the WebM recorder format; older Safari versions need an OS/browser update or an already installed compatible browser. Safari media behavior, real cameras and native screen pickers remain manual checks. No development tooling (npm, Python, Playwright) is installed or required on the end-user computer.

Actual account connections, permissions, public platform publication and hardware/screen-picker checks remain user-authorized manual checks. Automated tests use synthetic media, local RTMP receivers and simulated provider responses, never real public messages.

## References

- https://streamyard.com/
- https://support.streamyard.com/hc/en-us/articles/13828085960724-Layouts-and-Custom-Layouts
- https://support.streamyard.com/hc/en-us/articles/360043298712-StreamYard-s-paid-plan-features
- https://support.streamyard.com/hc/en-us/articles/6342816437268-Using-the-Greenroom
- https://developers.google.com/youtube/data/live/reference/rest/v3/liveChatMessages/list
- https://developers.google.com/youtube/data/live/reference/rest/v3/liveChatMessages/insert
- https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration
- https://dev.twitch.tv/docs/chat/authenticating/
- https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/

- https://dev.twitch.tv/docs/eventsub/handling-websocket-events/

- https://dev.twitch.tv/docs/authentication/validate-tokens/
