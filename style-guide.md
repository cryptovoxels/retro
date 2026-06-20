# Style Guide

As set by @bnolan.

## Mental model

Game HUD / terminal tool, not a SaaS dashboard. If it looks like it belongs in a 90s game editor or IRC client, it fits.

The showbox dock is the reference skin: dark, flat, monospace, red splash on active/primary.

## Fonts

* Source Code Pro (monospace) -- primary body font in-world and on the account site
* Press Start 2P -- pixel-font accent on small square "iconish" buttons only
* No other fonts. Let elements inherit.

## Colors

### Core palette (showbox / fierce)

Use these. Don't invent new hex values.

| Token | Value | Use |
|-------|-------|-----|
| bg | `#0d0d0d` | page, panels, dock shell |
| tinge | `#1a1a1a` | inputs, menus, secondary surfaces |
| border | `#333` | 1px borders, table rules |
| text | `#f5f5f0` | body copy |
| muted | `#888` | hints, small labels |
| splash | `#dc1e1e` | brand accent -- active nav, tab underline, primary buttons, link hover |

In `variables.less`, `@purple` / `@purp` / `@linkColorLight` alias to `#dc1e1e` (old purple names, red value). `@editorBackground` is `#0d0d0d`.

In `common.less`:

* `--dark: #0d0d0d`
* `--tinge: #1a1a1a`
* `--bright: #f5f5f0`
* `--semi: rgba(13, 13, 13, 0.85)` -- translucent HUD chrome

### Links

* **In-world (`client.less`)**: white links, underline on hover.
* **Account site (`web.less`, current)**: `#f5f5f0` default, `#dc1e1e` on hover. Active nav items use splash red.
* Browser default blue is not the look anymore on dark surfaces.

### Semantic color (still allowed)

* Red -- errors, unread, destructive (same splash hex is fine when it reads as emphasis)
* Yellow -- warnings (`@builder`, snackbars)
* Rarity colors in `variables.less` (`@legendary`, `@epic`, `@rare`) -- NFT/collectible UI only, not general chrome

### Primary actions

Solid red blocks are OK for the one obvious action: `button[type='submit']`, `.primary`, `.big-play`, go-live CTAs. Flat fill, no gradient, no bevel.

Everything else stays gray-on-dark. Don't sprinkle red decoration.

## Icons

* No SVG icons. No icon libraries (Heroicons, Lucide, FontAwesome SVG sets).
* Use font icons (`<i>` tags), text characters, or existing PNGs.

## Spacing

* Tight and utilitarian. Think 4-10px padding, 0.5-1rem gaps.
* Game HUD density, not landing page breathing room.

## Chrome and effects

* Borders: 1px `#333` (or `#8884` translucent on light-gray cards). No thick/dashed borders.
* **Flat**: `border-radius: 0` on new web buttons and chrome. No bevel, `box-shadow: none` on buttons.
* Some legacy in-world panels still have small radius (scrollbars, a few overlays). Don't add new rounded SaaS chrome.
* Text-shadow: `1px 1px 1px #111` for readability over the 3D canvas.
* Box-shadow: almost never. Dock desktop panel may use a single drop shadow -- don't copy that elsewhere.

## Two style surfaces

### In-world client -- `web/src/style/client.less`

* **One file.** Per-component `.less` imports were merged in; dead web-header/NFT styles were dropped. Add new in-world styles here, not new import files.
* Always dark: `color-scheme: dark` on `:root`.
* Showbox skin block at the bottom of the file (`accent-color`, active tabs, overlay bg).

### Account / web site -- `web/src/style/web.less`

* Imports `common.less`, `base.less`, etc.
* Showbox broadcast dock: `.showbox-dock*`, `.showbox-light-shell` (same palette as above).
* Site-wide dark skin lives in the **"QUICK HACK"** block at the bottom of `web.less` (Ben: "not production ready -- delete to revert"). Until that moves or gets replaced, new account-page styles should match that block, not fight it.

## Implementation

* LESS classes in the existing style files. Not styled-components, not CSS modules, not Tailwind.
* Inline styles only for dynamic/layout values (flex, z-index, color swatches).
* No new styling abstractions.
* Token source of truth: `variables.less` + `common.less` `:root` vars. Read before adding colors.

## Showbox / go-live UI

* Dock and light broadcast shell use Source Code Pro, `#0d0d0d` bg, `#f5f5f0` text, `#333` borders, `#888` hints.
* Forms: `.f` pattern in TSX (`<div class="f"><label>…</label><input … /></div>`). No extra layout classes unless needed.
* Actions: plain links or flat buttons. Splash red for the one primary action per screen.
