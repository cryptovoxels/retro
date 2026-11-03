import { VNode } from 'preact'
import type { Response } from 'express'
import { noCache } from '../cache'
import { render } from 'preact-render-to-string'
import config from '../../common/config'
import { named } from '../lib/logger'

const log = named('RenderComponent')
const { BABYLON_BUNDLE_URL } = require('../../vendor/library/urls.js')

// THE GREAT MERGE: one bundle for web pages and the in-world engine.
const appJs = config.isDevelopment ? '/proxy/web/client.js' : '/client-loader.js'

/*
 Render a component to static html, moving the <head /> element into
 the head
*/

export default function renderComponent(res: Response, component: VNode) {
  noCache(res)
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
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=overlays-content">
  <link rel="shortcut icon" href="/favicon.png" />
  ${config.isDevelopment ? `<link href="/app.css" rel="stylesheet" />` : ''}
  ${head}
</head>
<body>
  ${html}
</body>

${config.isDevelopment ? `<script defer src='${BABYLON_BUNDLE_URL}'></script>` : ''}
<script type="module" src="${appJs}"></script>
</html>`
}
