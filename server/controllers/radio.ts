import type { Express } from 'express'
import { buildSchedule, utcDay } from '../lib/radio'

export default function RadioController(app: Express) {
  app.get('/api/radio/live', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send = () => res.write(`data: ${JSON.stringify({ type: 'snapshot', schedule: buildSchedule(utcDay()) })}\n\n`)
    send()
    const tick = setInterval(send, 15000)
    req.on('close', () => clearInterval(tick))
  })
}
