const WEBSITE_ID = '91f685fd-f80f-4422-860b-760b6bea91fa'

let lastPage = ''

function skip() {
  if (typeof location === 'undefined') return true
  const h = location.hostname
  return h === 'localhost' || h === '127.0.0.1'
}

function basePayload(url: string) {
  return {
    website: WEBSITE_ID,
    hostname: location.hostname,
    language: navigator.language,
    referrer: document.referrer,
    screen: `${screen.width}x${screen.height}`,
    title: document.title,
    url,
  }
}

function send(payload: Record<string, any>) {
  try {
    fetch('/um/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'event', payload }),
      keepalive: true,
    }).catch(() => {})
  } catch {}
}

export function trackPage(url: string) {
  if (skip()) return
  const path = url.split('?')[0]
  if (path === lastPage) return
  lastPage = path
  send(basePayload(path))
}

export function track(name: string, data?: Record<string, string | number | boolean>) {
  if (skip()) return
  const path = typeof location !== 'undefined' ? location.pathname : '/'
  const payload: Record<string, any> = { ...basePayload(path), name }
  if (data) payload.data = data
  send(payload)
}
