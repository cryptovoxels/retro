# droid

android app for voxels. application id: `com.voxels.apps`.

## before you write code

read in order:

1. [../plan.md](../plan.md)
2. [../plan/inspiration.md](../plan/inspiration.md)
3. [../plan/vocab.md](../plan/vocab.md)
4. [../plan/bridge.md](../plan/bridge.md)
5. every file in [../plan/screens/](../plan/screens/)

implement the same screens as ios. jetpack compose + system WebView. vanilla. minimise imports.

## stack

- min sdk: android 14 (api 34)
- kotlin + jetpack compose (material3 system defaults)
- system WebView for retro (canvas only under nativeShell)
- AppState: `StateFlow` mirror patched by bridge dirty keys

## do

- duplicate functionality from the plan txts
- hide webview when not on world; keep warm
- native joystick, chat bar, parcel chip, womp button
- email otp + passkeys; no wallet

## do not

- invent screens
- add tool belt / build / crypto / nft / push / shell analytics
- destroy the webview on leaveWorld
- weird frameworks

## status

stub. no project files yet. next agent: create the android studio / gradle project here and implement screens.
