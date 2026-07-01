import { ComponentChild } from 'preact'

export function EditorProps(props: { children: ComponentChild }) {
  return <dl class="props">{props.children}</dl>
}
