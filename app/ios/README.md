# ios

ios app for voxels. bundle id: `com.voxels.apps`.

## before you write code

read in order:

1. [../plan.md](../plan.md)
2. [../plan/inspiration.md](../plan/inspiration.md)
3. [../plan/vocab.md](../plan/vocab.md)
4. [../plan/bridge.md](../plan/bridge.md)
5. every file in [../plan/screens/](../plan/screens/)

implement the same screens as android. swiftui + WKWebView. vanilla. minimise imports.

## stack

- min: ios 17
- swift + swiftui (system controls)
- WKWebView for retro (canvas only under nativeShell)
- AppState: `@Observable` (or ObservableObject) mirror patched by bridge dirty keys

## do

- duplicate functionality from the plan txts
- hide webview when not on world; keep warm
- native joystick, chat bar, parcel chip, womp button
- email otp + passkeys; Apple Sign In routes through email path
- no wallet

## do not

- invent screens
- add tool belt / build / crypto / nft / push / shell analytics
- destroy the webview on leaveWorld
- weird frameworks

## status

stub. no xcode project yet. next agent: create the xcode project here and implement screens.

## ci note

tagging main should eventually trigger xcode cloud build + release (see ../plan.md). not wired yet.
