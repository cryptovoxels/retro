import { currentVersion } from '../../common/version'
import { getClientPath } from './helpers/client-helpers'

const { BABYLON_BUNDLE_URL } = require('../../vendor/library/urls.js')

const CLIENT_PATH = getClientPath(currentVersion)

/* Render the client root node for main world and spaces */
export default function ClientRoot(props: { title: string; ogTitle?: string; ogDescription?: string; children: any }) {
  return (
    <html>
      <head>
        <title>{props.title}</title>
        <meta charSet="utf-8" />
        <link rel="shortcut icon" href="/favicon.png" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {props.ogTitle && <meta property="og:title" name="twitter:title" content={props.ogTitle}></meta>}
        {props.ogDescription && <meta property="og:description" name="twitter:description" content={props.ogDescription}></meta>}
        {props.ogTitle && <meta name="twitter:card" content="summary" />}
        {props.ogTitle && <meta property="og:type" content="website" />}

        {props.children}
      </head>
      <body style="background: #3af">
        <script src={BABYLON_BUNDLE_URL} />
        <script src={CLIENT_PATH} />

        <link href={`/${currentVersion}-client.css`} rel="stylesheet" />
      </body>
    </html>
  )
}
