// Lua DSL prelude loaded into every behaviour VM.
// Constructors return descriptor tables tagged with __kind for the runtime
// to identify and resolve. behaviour(name) returns a function that consumes
// the spec table and registers it in __behaviour_specs.

export const DSL_PRELUDE = `
__behaviour_specs = __behaviour_specs or {}

function value(default)
  return { __kind = "value", value = default }
end

function animate(default, opts)
  opts = opts or {}
  return {
    __kind = "animate",
    from = default,
    target = default,
    startedAt = 0,
    duration = opts.duration or 0,
    easing = opts.easing or "linear",
  }
end

function rng(min, max)
  return { __kind = "rng", min = min, max = max, resolved = min }
end

function persistent(inner)
  return { __kind = "persistent", inner = inner }
end

function number(default, opts)
  opts = opts or {}
  return {
    __kind = "param",
    paramType = "number",
    default = default,
    min = opts.min,
    max = opts.max,
    step = opts.step,
  }
end

-- 'text' instead of 'string' so we don't shadow Lua's string stdlib.
function text(default)
  return { __kind = "param", paramType = "string", default = default }
end

function boolean(default)
  return { __kind = "param", paramType = "boolean", default = default }
end

function behaviour(name)
  return function(spec)
    spec.name = name
    table.insert(__behaviour_specs, spec)
    return spec
  end
end
`
