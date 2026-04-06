import { VNode } from 'preact'
import { render } from 'preact-render-to-string'
import config from '../../common/config'
import { currentVersion } from '../../common/version'
import { getClientPath } from '../../web/src/helpers/client-helpers'
import { named } from '../lib/logger'

const log = named('RenderComponent')
const { BABYLON_BUNDLE_URL } = require('../../vendor/library/urls.js')

const CLIENT_PATH = getClientPath(currentVersion)

/*
 Render a component to static html, moving the <head /> element into
 the head
*/

// in development we need to proxy to the webpack dev servers
const webJs = (config.isDevelopment ? '/proxy/web' : '') + `/${currentVersion}-web.js`

export default function renderComponent(component: VNode) {
  let html: string

  if (config.isDevelopment) {
    html = render(component, {})
  } else {
    try {
      html = render(component, {})
    } catch (e: any) {
      log.error(`renderComponent: ${e.toString()}`)
      html = `<p>Page failed to render 🎺 - sad trombone<br/><br/><pre><code>${e.toString()}</code></pre></p>`

      // @ts-ignore
      Bugsnag.notify(e)
    }
  }

  let head = ''

  if (html.match(/<head>/)) {
    head = html.match(/<head>([\s\S]+)<\/head>/)![1]
    html = html.replace(/<head>([\s\S]+)<\/head>/, '')
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="shortcut icon" href="/favicon.png" />
  <link rel="prefetch" href="${BABYLON_BUNDLE_URL}" as="script">
  <link rel="prefetch" href="${CLIENT_PATH}" as="script">
  <link href='/${currentVersion}-web.css' rel="stylesheet" />
  ${head}
</head>
<body>
  ${html}
</body>

<script defer src='${BABYLON_BUNDLE_URL}'></script>
<script defer src='${webJs}'></script>
</html>`
}
