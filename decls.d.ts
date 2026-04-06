declare module 'unistore/full/preact'
declare module 'behave-js'
declare module 'color-temperature'
declare module 'text2png'
declare module 'svgdom'
declare module 'ao-mesher'
declare module '*.svg' {
  const content: React.FunctionComponent<React.SVGAttributes<SVGElement>>
  export default content
}

declare module 'preact-router/match' {
  import * as preact from 'preact'

  export interface LinkProps extends preact.JSX.AnchorHTMLAttributes<HTMLAnchorElement> {
    activeClassName?: string
    children?: preact.ComponentChildren
  }

  export function Link(props: LinkProps): preact.VNode
}
