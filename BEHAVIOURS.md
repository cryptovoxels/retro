# Behaviours

Behaviours are tiny Lua scripts you attach to a feature. A behaviour is a normal
Lua "class": you make one with `Behave.new()`, give it state, define methods, and
return it. Methods named `on<Event>` react to events (clicks, triggers). Other
methods are named animations you play over a duration with `self:animate`.

Behaviours act on their own feature only. The code lives inline on the feature -
there's no asset library. Grab a preset, write your own, or ask the LLM.

Built on [wasmoon](https://github.com/ceifa/wasmoon) (Lua in WASM). Replaces the
old QuickJS parcel scripting.

## the dsl

```lua
local Door = Behave.new("door")
Door.state = { shut = true }

function Door:open(t)
  self.rotation.y = t * 90
end

function Door:close(t)
  self.rotation.y = (1.0 - t) * 90
end

function Door:onclick()
  self:animate(self.state.shut and "open" or "close", 1000)
  self.state.shut = not self.state.shut
end

return Door
```

Click the feature -> `onclick` runs -> it picks an animation by name and calls
`self:animate("open", 1000)` -> the runtime drives `Door:open(t)` every frame for
1 second with `t` going 0..1 -> the door swings.

Three rules:

- `Behave.new(name)` makes the spec. `name` is optional (defaults to the variable name).
- Define methods with `function X:method()`. The `self` is passed automatically.
- The file MUST end with `return X`.

## methods: animations vs handlers

Method names decide what they are:

- `function X:on<Event>(self, data)` - an **event handler**. Runs when that event
  fires on the feature. `onclick`, `ontrigger`, etc.
- `function X:<name>(self, t)` - a **named animation**. Played by
  `self:animate("<name>", ms)`. `t` runs 0..1 over `ms` milliseconds.

## animations

```lua
function Spinner:spin(t)
  self.rotation.y = t * 360
end

function Spinner:onclick()
  self:animate("spin", 2000)
end
```

`self:animate("spin", 2000)` plays `Spinner:spin(t)` every frame for 2 seconds,
with `t = (now - start) / 2000` clamped to 0..1. It runs once more at exactly
`t = 1` to land cleanly, then stops. Calling `animate` again (any name) switches
to that animation.

Do the easing math yourself inside the method - use `ease.*` or `lerp(a, b, t)`.

## state

State is a plain Lua table of plain values - no wrappers.

```lua
Door.state = { shut = true, base = 0 }
```

Read and write it directly (`self.state.shut = false`). Each attached instance
gets its own deep copy. Animation state (and which animation is playing) syncs to
peers in the same parcel via the multiplayer relay, so a door opens for everyone.

## the self table

Inside any method you get `self`:

| field                       | type    | description                                                             |
| --------------------------- | ------- | ----------------------------------------------------------------------- |
| `self.state`                | table   | this instance's state - read and write freely                           |
| `self.position`             | vector  | feature world position - read/write `.x` / `.y` / `.z` (numbers)        |
| `self.rotation`             | vector  | feature rotation in DEGREES - read/write `.x` / `.y` / `.z`             |
| `self.visible`              | boolean | mesh visibility                                                         |
| `self:animate(name, ms)`    | method  | play the named animation method over `ms` milliseconds                  |
| `self:emit(event, data?)`   | method  | fire an event on this feature (runs matching `on<Event>` handlers)      |

Setting `self.rotation.y = 45` rotates the feature 45 degrees around y. Setting
`self.visible = false` hides it. The runtime writes your changes back to the
feature after each call.

## events

A feature fires events; matching `on<Event>` handlers on that feature's
behaviours run. No wiring.

- `onclick` - user clicked the feature
- `ontrigger` - proximity trigger fired
- `onchanged` - text-input / slider changed (`data.text` or `data.value`)

Some features fire more (`onstart` / `onstop` on video, `onkeys` on vid-screen).
Any `on<Name>` handler works - the runtime just calls `on` + the event name.

### emit

`self:emit("ping")` fires `onping` on the same feature's behaviours - handy for
splitting one behaviour into a few. It's local to the feature; there's no
cross-feature wiring (yet). Emit chains carry a depth counter and bail at 256 so
two handlers that emit each other can't loop forever.

## globals

Available in every behaviour:

- `Vec3.new(x, y, z)` - 3-component vector with operator overloads (`+ - * /` for
  scalar+vec / vec+vec) and `:magnitude()`, `:unit()`, `:dot(b)`, `:cross(b)`, `:lerp(b, t)`.
- `Euler.new(x, y, z)` - rotation triple in degrees.
- `lerp(a, b, t)` - scalar linear interpolation.
- `ease.linear / in_quad / out_quad / in_out_quad / in_cubic / out_cubic / in_out_cubic`.
- `now()` - milliseconds since epoch.

Plus Lua's standard library (`math`, `string`, `table`, ...).

## adding a behaviour

In the feature editor, scroll to the **behaviours** section.

- `+ add` - pick a built-in preset (door, spinner, lift, bob, flip, toggle, wobble).
  Presets live in [src/lua/presets.ts](src/lua/presets.ts) - edit that file to change them.
- `+ new` - start a blank behaviour and open the editor.
- `edit` - opens the inline Lua editor: syntax checking, undo/redo, and an "ask"
  prompt that has an LLM rewrite the script for you.

## debugging

Errors print to the dev console with a `[behaviours]` prefix. The editor shows
syntax errors with line:col as you type.

## limits

- One Lua VM per parcel; all behaviours share it. Identical source shares one
  compiled copy.
- Tick rate is adaptive: 60Hz default, backing off to 30Hz / 15Hz if a frame
  blows the budget.
- Animation state broadcasts on every `:animate`. Don't call `animate` from inside
  an animation method unless you want a broadcast storm.
