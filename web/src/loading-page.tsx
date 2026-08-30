import { VNode } from 'preact'
import { loadingBox } from './components/loading-icon'

export default function LoadingPage(props: { admin?: boolean; text?: string; children?: VNode[] }) {
  if (!!props.admin) {
    return (
      <div>
        <head>
          {props.children}
          <meta name="robots" content="noindex"></meta>
          <title>Voxels - Admin</title>
        </head>

        <section>{loadingBox()}</section>
      </div>
    )
  }

  return (
    <section>
      <head>
        <title>Voxels</title>
      </head>

      {loadingBox()}
      {props.text && <p style={{ textAlign: 'center' }}>{props.text}</p>}
    </section>
  )
}
