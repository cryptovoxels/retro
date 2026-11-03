import cachedFetch from './src/helpers/cached-fetch'
import { clientChoice, versionsUrl } from '../common/utils'

async function bootClient() {
  try {
    const releases = await (await cachedFetch(`${versionsUrl}/releases.json`, { cache: 'no-store' })).json()
    const version = clientChoice() || releases.latest
    if (!version || !releases.versions.includes(version)) throw new Error('Client release is unavailable')
    const root = `${versionsUrl}/${encodeURIComponent(version)}`
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `${root}/app.css`
    const library = document.createElement('script')
    library.src = `${root}/babylon.js`
    await Promise.all(
      [css, library].map(
        (element) =>
          new Promise<void>((resolve, reject) => {
            element.onload = () => resolve()
            element.onerror = () => reject(new Error('Client files failed to load'))
            document.head.appendChild(element)
          }),
      ),
    )
    await import(`${root}/client.js`)
  } catch (error) {
    console.error('Client failed to load', error)
    const message = document.createElement('p')
    message.textContent = 'Could not load the client. Try again or switch to the latest release.'
    const retry = document.createElement('button')
    retry.textContent = 'Try again'
    retry.onclick = () => location.reload()
    const reset = document.createElement('button')
    reset.textContent = 'Use latest release'
    reset.onclick = () => {
      try {
        localStorage.removeItem('clientVersion')
      } catch {}
      location.reload()
    }
    document.body.replaceChildren(message, retry, reset)
  }
}

void bootClient()
