# Style Guide

As set by @bnolan.

## Mental model

Game HUD / terminal tool, not a SaaS dashboard. If it looks like it belongs in a 90s game editor or IRC client, it fits.

## Fonts

* Source Code Pro (monospace) -- primary body font everywhere
* Press Start 2P -- pixel-font accent on small square "iconish" buttons only
* No other fonts. Let elements inherit.

## Colors

* Monochrome (black/white/grays) + browser blue for links
* No block colors. No decorative color.
* Color only for semantic meaning: blue = link, red = error/unread, yellow = warning
* Client overlays are dark/warm: `#181511` bg, `#f5f5f0` text, `#090807` borders
* HUD chrome: `--semi: #2225` (translucent dark), `--bright: #f3f3f3` (light text)
* See `variables.less` for the full token set. Don't invent new colors.

## Icons

* No SVG icons. No icon libraries (Heroicons, Lucide, FontAwesome SVG sets).
* Use font icons (`<i>` tags), text characters, or existing PNGs.

## Spacing

* Tight and utilitarian. Think 4-10px padding, 0.5-1rem gaps.
* Game HUD density, not landing page breathing room.

## Chrome and effects

* Borders: 1px gray. No thick/colored/dashed borders.
* Box-shadow: almost never. Some themes explicitly set `box-shadow: none`.
* Text-shadow: use `1px 1px 1px #111` for readability over the 3D canvas.
* Overlays get `border-radius: 1rem`. Top bar is sharp. Don't over-round things.

## Implementation

* LESS classes in the existing style files. Not styled-components, not CSS modules, not Tailwind.
* Inline styles only for dynamic/layout values (flex, z-index, color swatches).
* No new styling abstractions.
