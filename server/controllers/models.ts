import type { Express, Request, Response } from 'express'

async function parseTime(req: Request, res: Response) {
  const { input, now: rawNow } = req.body
  if (!input) return res.json({ error: 'no input' })

  // client sends their wall clock with offset, e.g. 2026-05-20T11:53:00+12:00
  const now = typeof rawNow === 'string' && /[+-]\d\d:?\d\d$/.test(rawNow) ? rawNow : new Date().toISOString()
  const offset = now.slice(-6)

  const prompt = `User's current local time: ${now}. Parse "${input}" into a single ISO 8601 timestamp using the same timezone offset (${offset}). Reply with ONLY the ISO string, no prose.`

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  }).then((r) => r.json())

  const iso = r.choices?.[0]?.message?.content?.trim()
  if (!iso) return res.json({ error: 'parse failed' })
  res.json({ iso })
}

const BEHAVIOUR_DSL_SPEC = `You write Lua for the Voxels behaviour DSL. Output ONLY raw Lua source - no prose, no markdown fences.

A behaviour is a normal Lua "class". Create it with Behave.new(), give it state, define methods, and RETURN it:

  local Door = Behave.new("door")
  Door.state = { shut = true }       -- plain Lua values: numbers, booleans, strings, tables

  function Door:open(t) ... end       -- animation method (t is 0..1)
  function Door:onclick() ... end     -- event handler (slot)

  return Door                         -- the file MUST end by returning the spec

Method naming:
- function X:on<Event>(self, data)  -- a SLOT, runs when that event fires on this feature (e.g. onclick).
- function X:<name>(self, t)         -- a named ANIMATION, played by self:animate("<name>", ms) with t in 0..1.

The runtime exposes on self:
  self.state.<name>                   -- read/write behaviour state (persists across calls)
  self.position                       -- world position. Read/write x/y/z directly (numbers).
  self.rotation                       -- rotation in DEGREES. Read/write x/y/z directly.
  self.visible                        -- boolean, mesh visibility
  self:animate("methodName", ms)      -- play the named animation method over ms milliseconds
  self:emit("event", data?)           -- fire an event: runs on<Event> on THIS feature's behaviours

Animation model:
- self:animate("spin", ms) stamps t0=now, t1=now+ms and remembers "spin".
- While now < t1, the runtime calls self:spin(t) every frame with t = (now-t0)/ms clamped to 0..1.
- It runs once more at t=1 to land exactly, then stops. Use ease.* or lerp(a,b,t) for easing inside the method.

Globals available everywhere:
  Vec3.new(x,y,z)                     -- with operator overloading: + - * / scalar or vec
  Euler.new(x,y,z)                    -- degrees
  ease.linear/in_quad/out_quad/in_out_quad/in_cubic/out_cubic/in_out_cubic
  lerp(a, b, t)
  now()                               -- ms since epoch

Built-in events that fire as on<Event> handlers when relevant:
  onclick     -- user clicked the feature
  ontrigger   -- proximity trigger fired
  onchanged   -- text-input/slider changed (data has .text or .value)

Rules:
- Behaviours act on their OWN feature only. There is no cross-feature wiring.
- The file MUST end with: return <YourSpec>.
- Don't invent globals beyond the list above.
- Keep behaviours small and obvious. One responsibility per behaviour.

Worked example - a door that swings open/shut on click:

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

Reply with the FULL updated Lua source for the file, ready to save as-is.`

async function behaviourAgent(req: Request, res: Response) {
  const { prompt, script } = req.body as { prompt?: string; script?: string }
  if (typeof prompt !== 'string' || !prompt.trim()) return res.json({ error: 'no prompt' })
  if (!process.env.GROQ_API_KEY) return res.json({ error: 'GROQ_API_KEY not set' })

  const user = `Existing Lua source:\n\`\`\`lua\n${script ?? ''}\n\`\`\`\n\nTask: ${prompt}\n\nReply with the FULL updated Lua source. No prose. No fences.`

  let r: any
  try {
    r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.2,
        messages: [
          { role: 'system', content: BEHAVIOUR_DSL_SPEC },
          { role: 'user', content: user },
        ],
      }),
    }).then((r) => r.json())
  } catch (err: any) {
    return res.json({ error: 'groq fetch failed: ' + (err?.message ?? err) })
  }

  if (r?.error) return res.json({ error: r.error.message ?? 'groq error' })

  let out: string = r?.choices?.[0]?.message?.content?.trim() ?? ''
  // Strip code fences if the model added them anyway.
  out = out.replace(/^```(?:lua)?\s*\n/, '').replace(/\n?```\s*$/, '')
  if (!out) return res.json({ error: 'empty response' })

  res.json({ script: out })
}

export default function ModelsController(app: Express) {
  app.post('/api/models/time', parseTime)
  app.post('/api/models/behaviour', behaviourAgent)
}
