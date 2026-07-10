# inspiration

raw decisions from the hybrid native app planning chat. agents: treat this as ground truth. for the clean brief see ../plan.md.

## goals

- hybrid native apps for android and ios
- layout: app/, app/plan.md, app/droid, app/ios
- universal (tablet + phone, portrait + landscape)
- idiomatic system-looking unstyled components per platform design guidelines
- app core in a javascript runtime that embeds app state (preact signals)
- bind app state to native so ui can be compose (swiftui / jetpack compose)
- webview runs the renderer; dom is only a canvas; no other overlays
- all other ui is native
- describe ui/screens as text files under app/plan/; agents duplicate in kotlin and swift
- very vanilla, minimise imports, nothing weird
- extremely fast, low latency
- pass app store review easily

## q&a dump

### product / mvp

1. what ships in v1?
   explore, chat, voice, womps, events

2. same account as web, or fresh mobile identity?
   same account (no metamask)

3. guest mode before login, or hard gate?
   guest mode immediately

4. offline / airplane?
   online only

### auth

5. login methods on mobile?
   email otp, passkeys

6. wallet?
   drop wallet

7. apple sign in?
   yup thats fine (route through email)

### architecture

8. js runtime vs webview?
   one webview (can we hide it when we're not in world?)
   answer: yes. hide when not in world; keep warm (do not destroy) so webgl does not cold-reboot.

9. (skipped / folded into 8)

10. bridge shape?
    postmessage (keep it dumb but bind it nice on the native side, proper reactive)

11. signal -> native binding?
    chose option A: snapshot + dirty keys
    (see binding options below)

12. content source?
    load retro (live web url)

13. webview still run preact overlays?
    flag to run the engine with no overlays

14. touch/joystick?
    new native joystick

### native ui

15. screens for v1?
    splash, home, login, world, chat, settings, user info, parcel info

16. in-world hud?
    native: chat bar, parcel name, d-pad, womp button, no tool belt

17. (safe areas — system defaults)

18. dark/light?
    follow system

### plan docs

19. format for app/plan/...?
    txt wireframes, one per screen

20. how strict for agents?
    idiomatic for pages, very similar app structure (not idiomatic nav)

21. shared vocabulary?
    shared vocab

### platform

22. min versions?
    ios 17+ / android 14+ ok

23. tablet?
    split view

24. distribution?
    app store + play store; v1 minimal; tagging main should xcode cloud build + android build and release

25. bundle id?
    com.voxels.apps

26. who implements?
    both (kotlin + swift agents in parallel from same plan)

### perf

27. hard targets?
    just dont fuck it up

28. fps?
    60/30 (prefer 60, allow 30 on weak devices)

29. memory?
    memory budget later; want a native number (when logged in as team) showing memory usage to indicate blow outs

### store / policy

30. ugc moderation?
    web mod

31. crypto/nft in app?
    web only, no crypto/nft

32. push?
    no

33. analytics in shell?
    no

### repo

34. app/plan.md = agent brief, screens under app/plan/screens/?
    yup

35. agents implement kotlin + swift in parallel, no shared ui kit?
    yup

36. js core location?
    reuse/bundle/modify src and web; we load it from the web

## binding options (question 11)

| option | how | pros | cons |
| --- | --- | --- | --- |
| A. snapshot + dirty keys | js effect() diffs signals -> postMessage({ type:'state', dirty:[...], state:{...} }). native holds mirror dict; ui observes keys. | dumb. fast. easy to debug. vanilla. | manual allowlist of keys to export. |
| B. per-signal subscribe | native says subscribe('currentParcel'). js sends only that signal's updates. | minimal traffic. | more bridge chatter to set up; easy to leak subs. |
| C. full state every tick | blast entire exported state on any change. | dead simple. | fat messages; bad for chat/voice spam. |

**decision: A.** matches "dumb postmessage, nice reactive on native." native side: one AppState observable (compose StateFlow / swiftui @Observable) fed by dirty-key patches.

## architecture sketch

- one webview loads live retro (not a separate js vm)
- flag: engine runs with no preact overlays (dom = canvas only)
- hide webview when not in world; keep instance warm
- all chrome native
- world hud native over webview: chat bar, parcel name, d-pad/joystick, womp button
- bridge: dumb postMessage json + dirty-key state mirror
- input: native joystick -> bridge commands into existing mobile control path
- tablet: split view; phone: portrait + landscape
- follow system light/dark
- idiomatic system controls; same app structure across platforms (not idiomatic platform nav)
- ids: com.voxels.apps
- out of v1: build/tool belt, wallet, crypto/nft, push, shell analytics

## web changes called out

- mobile/native flag: hide all overlays; canvas only
- bridge module: export allowlisted signals; accept commands (nav, chat send, womp, joystick, login tokens)
- auth: email otp + passkeys only in native path; no wallet ui
- load from production/staging retro url inside the webview
