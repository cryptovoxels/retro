// ABOUTME: 1998 IRC-style in-place progress board for the parcel compiler farm.

export type BoardPhase = 'GET' | 'PUT' | 'HAVE' | 'FAIL' | 'DIG' | 'idle'

export type BoardRow = {
  parcelId: number
  url: string
  phase: BoardPhase
  got: number
  total: number
  detail?: string
}

export type BoardStats = {
  done: number
  total: number
  bytes: number
  drafts: number
  fail: number
  dug: number
  uploads: number
  parcels: number
  workers: number
}

const R = '\x1b[0m'
const B = '\x1b[1m'
const D = '\x1b[2m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const MAGENTA = '\x1b[35m'

function trunc(url: string, n: number) {
  if (url.length <= n) return url.padEnd(n)
  return url.slice(0, n - 3) + '...'
}

function bar(got: number, total: number, width = 10): string {
  if (total <= 0) {
    const tick = Math.floor(Date.now() / 200) % width
    let s = ''
    for (let i = 0; i < width; i++) s += i === tick ? '=' : ' '
    return `[${s}]`
  }
  const pct = Math.min(1, got / total)
  const filled = Math.max(0, Math.min(width, Math.round(pct * width)))
  let s = ''
  for (let i = 0; i < width; i++) {
    if (i < filled - 1) s += '='
    else if (i === filled - 1) s += '>'
    else s += ' '
  }
  return `[${s}]`
}

function kbSize(n: number) {
  if (n < 1024) return n + 'b'
  if (n < 1024 * 1024) return Math.round(n / 1024) + 'kb'
  return (n / (1024 * 1024)).toFixed(1) + 'mb'
}

function phaseColor(phase: BoardPhase) {
  if (phase === 'GET') return CYAN
  if (phase === 'PUT') return MAGENTA
  if (phase === 'HAVE') return GREEN
  if (phase === 'DIG') return YELLOW
  if (phase === 'FAIL') return RED
  return D
}

export class Board {
  private rows: Array<BoardRow | null>
  private live = new Set<number>()
  private stats: BoardStats
  private timer: ReturnType<typeof setInterval> | null = null
  private tty: boolean
  private started = false
  private scrollback: string[] = []
  private lastPrint = 0

  constructor(workers: number, parcels: number) {
    this.rows = Array.from({ length: workers }, () => null)
    this.stats = { done: 0, total: 0, bytes: 0, drafts: 0, fail: 0, dug: 0, uploads: 0, parcels, workers }
    this.tty = !!process.stdout.isTTY
  }

  start() {
    if (this.started) return
    this.started = true
    if (this.tty) {
      process.stdout.write('\x1b[?25l') // hide cursor
      process.stdout.write('\x1b[2J\x1b[H')
    }
    this.timer = setInterval(() => this.draw(), 50)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.draw()
    if (this.tty) process.stdout.write('\x1b[?25h')
    this.started = false
  }

  addParcel(id: number) {
    this.live.add(id)
  }

  removeParcel(id: number) {
    this.live.delete(id)
  }

  set(slot: number, row: BoardRow) {
    if (slot < 0 || slot >= this.rows.length) return
    this.rows[slot] = row
  }

  idle(slot: number) {
    if (slot < 0 || slot >= this.rows.length) return
    this.rows[slot] = null
  }

  bump(partial: Partial<BoardStats>) {
    Object.assign(this.stats, {
      done: this.stats.done + (partial.done || 0),
      total: this.stats.total + (partial.total || 0),
      bytes: this.stats.bytes + (partial.bytes || 0),
      drafts: this.stats.drafts + (partial.drafts || 0),
      fail: this.stats.fail + (partial.fail || 0),
      dug: this.stats.dug + (partial.dug || 0),
      uploads: this.stats.uploads + (partial.uploads || 0),
    })
  }

  logDone(line: string) {
    if (!this.tty) {
      console.error(line)
      return
    }
    this.scrollback.push(line)
    if (this.scrollback.length > 8) this.scrollback.shift()
  }

  private header(): string[] {
    const ids = Array.from(this.live).sort((a, b) => a - b)
    const list = ids.length ? ids.join(', ') : '...'
    const s = this.stats
    return [
      `${B}=== RECOMPILING PARCEL ${list} ===${R}`,
      `${s.parcels} parcels  ${s.workers} fetchers  ${GREEN}${s.done}${R}/${s.total}  ${kbSize(s.bytes)}  drafts ${s.drafts}  dug ${YELLOW}${s.dug}${R}  fail ${RED}${s.fail}${R}  uploads ${s.uploads}`,
      '',
    ]
  }

  private rowLine(row: BoardRow | null): string {
    if (!row) return `${D}     idle${R}`
    const c = phaseColor(row.phase)
    const id = String(row.parcelId).padStart(5)
    const url = trunc(row.url.replace(/^https?:\/\//, ''), 40)
    if (row.phase === 'FAIL') {
      return `${c}${id}  ${url}  FAIL ${row.detail || ''}${R}`
    }
    if (row.phase === 'HAVE') {
      return `${c}${id}  ${url}  HAVE${R}`
    }
    const b = bar(row.got, row.total)
    const phase = row.phase.padEnd(4)
    return `${c}${id}  ${url}  ${phase} ${b}${R}`
  }

  draw() {
    const lines = [...this.header(), ...this.rows.map((r) => this.rowLine(r))]
    if (this.scrollback.length) {
      lines.push('')
      for (const s of this.scrollback) lines.push(`${YELLOW}${s}${R}`)
    }

    if (!this.tty) {
      const now = Date.now()
      if (now - this.lastPrint < 2000) return
      this.lastPrint = now
      const ids =
        Array.from(this.live)
          .sort((a, b) => a - b)
          .join(', ') || '...'
      const active = this.rows.filter(Boolean) as BoardRow[]
      const s = this.stats
      console.error(`=== RECOMPILING PARCEL ${ids} ===  ${active.length} active  ${s.done}/${s.total}  dug ${s.dug}  fail ${s.fail}  ${kbSize(s.bytes)}`)
      for (const r of active.slice(0, 12)) {
        console.error(`  ${r.parcelId}  ${r.phase.padEnd(4)}  ${r.url.slice(0, 60)}${r.detail ? ' ' + r.detail : ''}`)
      }
      return
    }

    process.stdout.write('\x1b[H')
    for (const line of lines) {
      process.stdout.write('\x1b[2K' + line + '\n')
    }
    process.stdout.write('\x1b[J')
  }
}
