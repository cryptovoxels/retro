# bridge

dumb `postMessage` json between native shell and the retro webview. keep the wire stupid. make the native mirror reactive.

binding model: **snapshot + dirty keys** (inspiration option A).

## transport

- ios: `WKScriptMessageHandler` + `window.webkit.messageHandlers.voxels.postMessage`
- android: `WebViewCompat.addWebMessageListener` / `@JavascriptInterface` — pick the boring one; document the choice in droid readme
- all messages: utf-8 json objects with a `type` string
- no shared memory, no protobuf, no codegen in v1

native injects a small bootstrap (or relies on web detecting `nativeShell=1` query / user agent) so the page knows to:

1. hide all preact overlays (canvas only)
2. start exporting state
3. accept commands

## native -> js (commands)

```json
{ "type": "command", "name": "enterWorld", "id": "optional-req-id", "payload": {} }
```

| name | payload | notes |
| --- | --- | --- |
| enterWorld | `{ "parcelId"?: string }` | show world; navigate engine |
| leaveWorld | `{}` | pause/hide friendly; webview stays alive |
| sendChat | `{ "text": string }` | |
| takeWomp | `{}` | |
| joystick | `{ "x": number, "y": number, "active": boolean }` | -1..1; send often; keep tiny |
| loginEmail | `{ "email": string, "code"?: string }` | request code or submit code |
| loginPasskey | `{}` | web/passkey flow inside webview or native handoff — prefer existing web passkey |
| logout | `{}` | |
| setVoiceMuted | `{ "muted": boolean }` | |

optional ack:

```json
{ "type": "commandResult", "id": "optional-req-id", "ok": true, "error": null }
```

fail soft: if command unknown, `{ ok: false, error: "unknown" }` — do not throw.

## js -> native (state)

on any change to allowlisted signals, js diffs and sends:

```json
{
  "type": "state",
  "dirty": ["parcelName", "chatPreview"],
  "state": {
    "ready": true,
    "guest": false,
    "userName": "ben",
    "userId": "…",
    "parcelName": "origin city",
    "parcelId": "…",
    "chatPreview": "hi",
    "voiceConnected": true,
    "voiceMuted": false,
    "online": true,
    "error": null
  }
}
```

rules:

- `state` may be a **partial** object containing only dirty keys, or a full snapshot that includes at least the dirty keys — native must patch by key either way
- send only when something allowlisted changed
- throttle chat-heavy keys if needed; never block the render loop
- joystick is command-only (not state)

### allowlisted keys (v1)

| key | type | meaning |
| --- | --- | --- |
| ready | bool | bridge + engine up |
| guest | bool | not signed in |
| userName | string \| null | |
| userId | string \| null | |
| parcelName | string \| null | |
| parcelId | string \| null | |
| chatPreview | string \| null | last chat line for hud |
| voiceConnected | bool | |
| voiceMuted | bool | |
| online | bool | |
| error | string \| null | soft error for toast/banner |

add keys only by updating this file + vocab.md.

## js -> native (events)

one-shot things that are not mirrored state:

```json
{ "type": "event", "name": "wompSaved", "payload": { "url": "…" } }
{ "type": "event", "name": "needLogin", "payload": {} }
{ "type": "event", "name": "openParcelInfo", "payload": { "parcelId": "…" } }
{ "type": "event", "name": "openUserInfo", "payload": { "userId": "…" } }
```

native handles navigation. do not open dom modals.

## native AppState mirror

- single store: compose `StateFlow` / swiftui `@Observable` (or `ObservableObject`)
- on `type=state`: for each key in `dirty`, set mirror[key] = state[key]
- ui reads mirror only — never parse bridge messages in views
- initial mirror: all null/false until first state message

## webview lifecycle

| app screen | webview |
| --- | --- |
| splash / home / login / settings / … | attached, **hidden**, still loaded |
| world | visible, full bleed under hud |

never destroy the webview on leaveWorld. cold start only on process death.

## input path

native joystick -> `command/joystick` at high rate. web maps into existing mobile controls. do not reimplement camera in native.

## security / review

- no wallet messages
- no nft/crypto commands
- do not expose eval bridges
- only talk to the voxels origin you loaded
