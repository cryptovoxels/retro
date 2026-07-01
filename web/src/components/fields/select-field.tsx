import { JSX, useId } from 'preact/compat'
import { ComponentChild, VNode } from 'preact'

type Props = {
  name: string
  value: string
  options: Record<string, string>
  label?: string
  onChange?: JSX.GenericEventHandler<HTMLSelectElement>
  disabled?: boolean
  placeholder?: string
  children?: ComponentChild[] | VNode<any> | null
}

export function SelectField(props: Props) {
  const id = useId()

  const opts: JSX.Element[] = []
  for (const value in props.options) {
    const text = props.options[value]
    opts.push(<option value={value}>{text}</option>)
  }

  return (
    <div class="f">
      <label htmlFor={id}>{props.label ?? props.name}</label>
      <select value={props.value} onChange={props.onChange} disabled={props.disabled} id={id}>
        {opts}
      </select>
      {props.children && <span>{props.children}</span>}
    </div>
  )
}
