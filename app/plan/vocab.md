# vocab

shared names. use these exact strings in kotlin and swift types, screen ids, and bridge keys where noted. do not invent synonyms.

## screens

| id | file | purpose |
| --- | --- | --- |
| splash | screens/splash.txt | cold start, boot webview warm |
| home | screens/home.txt | guest/signed-in hub, enter world, events |
| login | screens/login.txt | email otp + passkeys |
| world | screens/world.txt | webview canvas + native hud |
| chat | screens/chat.txt | full chat transcript + send |
| settings | screens/settings.txt | account, voice, about, sign out |
| user-info | screens/user-info.txt | self or other player |
| parcel-info | screens/parcel-info.txt | current / selected parcel |

## world hud pieces

| name | role |
| --- | --- |
| chatBar | compact input + open full chat |
| parcelChip | shows current parcel name; opens parcel-info |
| joystick | virtual stick; sends input commands |
| wompButton | take womp |
| voiceToggle | mute/unmute voice (optional on hud; also in settings) |

do not add: toolBelt, buildTab, editPane, walletButton, nftBrowser.

## app structure (same on both platforms)

not platform-idiomatic nav. both apps use this flow:

```
splash
  -> home
       -> login (modal or push)
       -> world
            -> chat (sheet/push)
            -> parcel-info (sheet/push)
            -> user-info (sheet/push)
            -> settings (sheet/push)
       -> settings
       -> user-info (self)
```

tablet: split view — list/hub on leading side, detail (world or info) on trailing. phone: single stack, portrait + landscape.

## state mirror fields (exported)

see bridge.md for full protocol. common field names:

- `ready` — engine/bridge ready
- `guest` — not signed in
- `userName`
- `userId`
- `parcelName`
- `parcelId`
- `chatPreview` — last line for chatBar
- `voiceConnected`
- `voiceMuted`
- `online`
- `error` — soft error string or null

## commands (native -> js)

names only; payloads in bridge.md:

- `enterWorld`
- `leaveWorld`
- `sendChat`
- `takeWomp`
- `joystick`
- `openUrl` (rare; prefer native)
- `loginEmail`
- `loginPasskey`
- `logout`
- `setVoiceMuted`

## visual language

- system components only (compose material3 defaults / swiftui defaults)
- no custom brand chrome in v1
- no hard-coded colors; follow system light/dark
- no border-radius inventiveness beyond platform defaults
- safe areas: system
- density: comfortable, not dense dashboard

## packaging names

- application id / bundle id: `com.voxels.apps`
- display name: `Voxels` (unless store listing says otherwise)
