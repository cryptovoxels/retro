# Behaviours

Behaviours are tiny Lua scripts you attach to features. They have parameters,
state (plain values), and slots (functions that fire on signals). State changes
animate over a duration via `self:animate`, and you write a `tick(self, t)`
function that runs every frame while an animation is in flight.

Replaces the old QuickJS parcel scripting. Built on
[wasmoon](https://github.com/ceifa/wasmoon) (Lua 5.4 in WASM).

## the dsl

A behaviour file calls `behaviour "name" { ... }` exactly once. Everything is optional.

```lua
behaviour "door" {
  state = { open = false },

  tick = function(self, t)
    if self.state.open then
      self.rotation.y = t * 90
    else
      self.rotation.y = (1 - t) * 90
    end
  end,

  slots = {
    click = function(self)
      if self.state.open then
        self:animate({ open = false }, 1000)
      else
        self:animate({ open = true }, 1000)
      end
    end,
  },
}
```

Click the feature -> the slot toggles `state.open` and calls
`self:animate(target, 1000)` -> tick fires every frame for 1 second with
`t = 0..1`, rotating the door.

## state

State is a plain Lua table of plain values. No wrappers, no descriptors.

```lua
state = {
  open    = false,
  speed   = 1.5,
  message = "hi",
}
```

You change state via `self:animate(target, ms)`:

```lua
self:animate({ open = true, speed = 3 }, 1000)
```

That merges `target` into `self.state` immediately (so anyone reading the
state next frame sees the new values), AND opens an animation window for
`ms` milliseconds. While the window is open, `tick(self, t)` runs every frame
with `t` going from 0 to 1.

Want an instant change with no animation? `self:animate({...}, 0)` - the
window closes the same frame so tick won't fire.

State auto-syncs to peers in the same parcel via the multiplayer relay.

## tick

```lua
tick = function(self, t)
  -- t is 0..1, clamped, computed from now / animate window.
  -- runs every frame while now < t1. stops after.
end
```

Tick only fires while the behaviour is "active" (mid-animate). If you've never
called `self:animate`, tick never runs. After the animation window closes,
tick stops until the next animate.

For a continuous tick (e.g. a spinning thing), call `self:animate({}, 99999)`
in `init` and use `now()` directly inside tick.

## params

Params show up as form fields in the editor.

- `number(default, { min, max, step })`
- `text(default)` - named `text`, not `string`, so Lua's `string` stdlib stays usable.
- `boolean(default)`

```lua
params = {
  swingDeg = number(90, { min = 10, max = 180, step = 5 }),
  locked   = boolean(false),
  label    = text("front door"),
},
```

Read with `self.params.swingDeg` etc.

## the self table

Everywhere you have a `self` (init, tick, slots), you get:

| field            | type     | description                                                               |
| ---------------- | -------- | ------------------------------------------------------------------------- |
| `self.params`    | table    | param values for this attachment, read-only                               |
| `self.state`     | table    | current state, read-only (mutate via `:animate`)                          |
| `self.position`  | Vec3     | feature world position - read or write `.x` / `.y` / `.z` directly        |
| `self.rotation`  | Euler    | feature rotation in DEGREES - read or write `.x` / `.y` / `.z` directly   |
| `self.visible`   | boolean  | mesh visibility                                                           |
| `self:animate(target, ms)` | method | merge target into state and run tick for ms                       |
| `self:emit(signal, data?)` | method | fire a named signal                                               |

Setting `self.rotation.y = 45` rotates the feature 45 degrees around y.
Setting `self.visible = false` hides the mesh. The runtime applies your
writes back to the feature after each tick / slot.

## signals and slots

A slot is a function in `slots = {...}` that runs when its name is signalled.

```lua
slots = {
  click   = function(self) ... end,
  trigger = function(self) ... end,
  open    = function(self) self:animate({ open = true }, 500) end,
}
```

Built-in events that fire as same-named slots on the feature, no wiring needed:

- `click` - user clicked the feature
- `trigger` - proximity trigger fired
- `changed` - text-input/slider value changed (`data.text` or `data.value`)

You fire your own signals with `self:emit("name", data?)`. The editor walks
your script's AST to discover what you emit, so the wiring dropdowns
populate automatically. Wire your signal to another feature's slot in the
behaviours panel.

### loop guard

Signal chains carry a depth counter. At depth 256 the runtime drops the
signal. Chains start at depth 1 from a user interaction or peer signal, so
two slots that emit each other won't loop forever.

## globals

Available in every behaviour:

- `Vec3.new(x, y, z)` - 3-component vector with operator overloads.
  - `a + b`, `a - b`, `a * b`, `a / b` work for scalar+vec, vec+scalar, vec+vec.
  - `:magnitude()`, `:unit()`, `:dot(b)`, `:cross(b)`, `:lerp(b, t)`.
- `Euler.new(x, y, z)` - rotation triple in degrees.
- `lerp(a, b, t)` - scalar linear interpolation.
- `ease.linear / in_quad / out_quad / in_out_quad / in_cubic / out_cubic / in_out_cubic` - easing fns, all `t -> t`.
- `now()` - milliseconds since epoch.

Plus all of Lua's standard library (`math`, `string`, `table`, etc).

## attaching a behaviour

In the feature editor, scroll to the **behaviours** section.

- `+ new` makes a fresh behaviour asset and opens the editor modal.
- `+ attach` lets you paste a uuid of an existing behaviour asset to reuse.
- expand a row to set params and wire slots to other features' signals.

The editor modal has an inline Lua editor with syntax check, an "ask the
agent" prompt that rewrites your code, and undo/redo for agent edits.

## a wired example

Door behaviour as above, plus a button that toggles it:

```lua
behaviour "button" {
  slots = {
    click = function(self) self:emit("pressed") end,
  },
}
```

In the editor, attach `button` to a button feature and `door` to a model
shaped like a door. On the button's `pressed` signal row, pick `door / click`
from the dropdown.

Click the button -> button emits `pressed` -> connected to door's `click` ->
door swings.

## debugging

Errors print to the dev console with a `[behaviours]` prefix. The script
editor modal shows syntax errors with line:col before save. Toggle the
behaviours runtime on/off in the debug overlay (`F4`).

## limits

- One Lua VM per parcel. All behaviours share it.
- Tick rate is adaptive: 60Hz default, drops to 30Hz / 15Hz if the runtime
  exceeds the per-frame budget.
- State broadcasts on every `:animate`. Don't call animate from inside `tick`
  unless you want a broadcast storm.
