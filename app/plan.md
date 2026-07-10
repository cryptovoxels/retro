# voxels native apps — agent brief

read this first. then [inspiration.md](plan/inspiration.md), [vocab.md](plan/vocab.md), [bridge.md](plan/bridge.md), and every file in [plan/screens/](plan/screens/).

implement the same app twice: [droid/](droid/) (kotlin + jetpack compose) and [ios/](ios/) (swift + swiftui). do not invent screens. do not share a ui kit. duplicate from the plan txts.

## what this is

hybrid native shells for retro voxels. one system webview loads live retro and runs babylon + preact signals. the webview dom is **canvas only**. every other pixel is native.

v1 features: explore, chat, voice, womps, events.
v1 out: build/tool belt, wallet/metamask, crypto/nft, push, shell analytics.

## layout

```
app/
  plan.md          <- you are here
  plan/
    inspiration.md
    vocab.md
    bridge.md
    screens/*.txt
  droid/           <- android app (com.voxels.apps)
  ios/             <- ios app (com.voxels.apps)
```

## architecture

```
native shell (swiftui / compose)
  AppState mirror  <--- postMessage state { dirty, state }
  screens + world HUD
  native joystick  ---> postMessage commands
        |
   system WebView (warm, hidden when not in world)
        |
   retro web (src/ + web/) — canvas only, nativeShell flag
```

rules:

- **one webview**. no second js vm.
- load retro from the web (prod/staging url). reuse/modify `src/` and `web/`; do not fork a separate mobile bundle unless forced.
- **hide** the webview when not on the world screen; **do not destroy** it (keep webgl warm).
- native flag / query so the engine runs with **no preact overlays**.
- bridge is dumb json `postMessage`. binding is **snapshot + dirty keys** (see bridge.md).
- native side: one reactive mirror (`StateFlow` / `@Observable`) patched by dirty keys. ui reads the mirror only.
- tablet: split view. phone: portrait + landscape. follow system light/dark.
- idiomatic **system controls** (text fields, lists, buttons). **same app structure** on both platforms — not platform-idiomatic navigation patterns.
- vanilla: minimise imports. system webview + compose/swiftui only. nothing weird.

## screens (v1)

implement exactly these, from the txt wireframes:

1. splash
2. home
3. login
4. world (webview + hud)
5. chat
6. settings
7. user-info
8. parcel-info

world hud (native, over webview): chat bar, parcel name, d-pad/joystick, womp button. **no tool belt**.

## auth

- same accounts as web (`retro.voxels.com`)
- guest mode immediately (explore without login)
- online only
- email otp + passkeys
- no wallet / metamask
- apple sign in ok; route through the email account path
- no crypto/nft surfaces in the app (web only) — keeps store review chill
- ugc moderation: reuse web

## perf

- prefer 60fps; allow 30 on weak devices
- do not add latency on the bridge or input path
- fail soft (guard, return, continue)
- later: when logged in as team, show a native memory number for blowouts (not v1 ui, but leave a hook)

## packaging

- bundle / application id: `com.voxels.apps`
- min: ios 17+, android 14+
- ship: app store + play store
- v1 minimal
- **ci note (implement later):** tagging `main` should trigger xcode cloud build + android build and release

## web work agents may need

in the existing repo (not under `app/`):

- native-shell flag: suppress all overlays in `src/user-interface.tsx` (and related mounts); leave canvas
- bridge module: export allowlisted signals from `src/store.ts` / auth; accept commands (see bridge.md)
- auth path for native: email otp + passkeys only; hide wallet ui when native shell
- ensure mobile control path accepts joystick commands from the bridge

## agent rules

- one problem at a time; surgical diffs
- ascii only in plan/code comments you add
- do not resurrect build tools, wallet, or nft flows in the native apps
- pass app store / play review easily
- if unsure, read inspiration.md — user answers there are ground truth

## follow-ups (not this pass)

- full droid/ios implementation beyond stubs
- xcode cloud + play release pipeline
- team memory hud
- memory budget tuning
