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

A behaviour file calls behaviour "name" { ... } exactly once, with these fields (all optional):

  params = { key = number(default,{min,max,step}) | text(default) | boolean(default), ... }
  state  = { key = <plain value>, ... }     -- plain Lua values: numbers, booleans, strings, tables. No wrappers.
  slots  = { name = function(self, data) ... end, ... }
  init   = function(self) ... end           -- runs once on attach
  tick   = function(self, t) ... end        -- runs every frame WHILE animating; t is 0..1

The runtime exposes on self:
  self.params.<name>                  -- read configured params
  self.state.<name>                   -- read state (mutate via :animate)
  self.position                       -- Vec3, world position. Read/write x/y/z directly.
  self.rotation                       -- Euler in DEGREES. Read/write x/y/z directly.
  self.visible                        -- boolean, mesh visibility
  self:animate({k=v, ...}, ms)        -- merge into state, start a ms-long animation window
  self:emit("name", data?)            -- fire a signal; same-named slots on this feature run, plus any wired connections

Animation model:
- self:animate(target, ms) merges target into self.state and stamps t0=now, t1=now+ms.
- While now < t1, the runtime calls tick(self, t) every frame with t = (now-t0)/ms clamped to 0..1.
- After t1, tick stops. Behaviour is "active" iff in an animate window.
- The dev does the easing math themselves inside tick. Use ease.linear/in_quad/out_quad/in_out_quad/in_cubic/out_cubic/in_out_cubic, or lerp(a, b, t).

Globals available everywhere:
  Vec3.new(x,y,z)                     -- with operator overloading: + - * / scalar or vec
  Euler.new(x,y,z)                    -- degrees
  ease.linear/in_quad/out_quad/in_out_quad/in_cubic/out_cubic/in_out_cubic
  lerp(a, b, t)
  now()                               -- ms since epoch

Built-in events that fire as slots when relevant:
  click       -- user clicked the feature (no wiring needed; just declare slots.click)
  trigger     -- proximity trigger fired
  changed     -- text-input/slider changed (data has .text or .value)

Rules:
- Use 'text' not 'string' for text params (Lua's string stdlib must not be shadowed).
- Don't invent globals beyond the list above.
- Keep behaviours small and obvious. One responsibility per behaviour.
- Don't create new state keys without a reason. Only what tick / slots actually read.

Worked example - a door that swings open on click:

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
