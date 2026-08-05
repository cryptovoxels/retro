import { render } from 'preact'
import { openDialog } from '../../common/helpers/ui-helpers'
import { isURL } from '../utils/helpers'
import { truncate } from '../../web/src/lib/string-utils'

export function isExternal(url: string) {
  if (!isURL(url)) {
    return false
  }

  const u = new URL(url)
  return !u.hostname.endsWith('voxels.com') && !u.hostname.endsWith('cryptovoxels.com')
}

export default function (url: string) {
  if (!isExternal(url)) {
    console.error('Not opening broken link:', url)
    return
  }

  const { el, close } = openDialog('open-link pointer-lock-close')

  var domain = new URL(url).hostname

  render(
    <div id="foo">
      <button className="close" onClick={() => close()}>
        &times;
      </button>
      <h3>
        <a href={url} title={url} target="_blank">
          {domain}
        </a>
      </h3>
      <br />
      Link:{' '}
      <a style={{ fontSize: 'small', fontStyle: 'italic' }} href={url} target="_blank">
        <small>{truncate(url, 32)}</small>
      </a>
    </div>,
    el,
  )
}
