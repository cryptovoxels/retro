import { render } from 'preact'
import { unmountComponentAtNode } from 'preact/compat'
import { exitPointerLock, requestPointerLockIfNoOverlays } from '../../common/helpers/ui-helpers'
import { isURL } from '../utils/helpers'
import { truncate } from '../../web/src/lib/string-utils'

function isExternal(url: string) {
  if (!isURL(url)) {
    return true
  }
  const u = new URL(url)
  return !u.hostname.endsWith('voxels.com') && !u.hostname.endsWith('cryptovoxels.com')
}

export default function (url: string) {
  const div = document.createElement('dialog')
  div.className = 'open-link pointer-lock-close'
  document.body.appendChild(div)

  const target = !isExternal(url) ? '_self' : '_blank'
  exitPointerLock()

  const close = () => {
    div && unmountComponentAtNode(div)
    div.remove()
    requestPointerLockIfNoOverlays()
  }

  try {
    var domain = new URL(url).hostname
  } catch (e) {
    domain = 'External Link'
  }

  render(
    <div id="foo">
      <button className="close" onClick={() => close()}>
        &times;
      </button>
      <h3>
        <a href={url} title={url} target={target}>
          {domain}
        </a>
      </h3>
      <br />
      Link:{' '}
      <a style={{ fontSize: 'small', fontStyle: 'italic' }} href={url} target={target}>
        <small>{truncate(url, 32)}</small>
      </a>
    </div>,
    div,
  )
}
