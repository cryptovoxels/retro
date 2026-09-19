import { ComponentChild, JSX, VNode } from 'preact'
import { useId } from 'preact/hooks'

type Props = {
  name: string
  label?: string
  value?: number | string
  onChange?: JSX.GenericEventHandler<HTMLInputElement>
  disabled?: boolean
  placeholder?: string
  size?: number
  maxLength?: number
  min?: number
  max?: number
  children?: ComponentChild[] | VNode<any> | null
}

export function NumberField(props: Props) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id}>{props.label ?? props.name}</label>
      <input type="number" name={props.name} value={props.value} onChange={props.onChange} disabled={props.disabled} id={id} size={props.size} maxLength={props.maxLength} min={props.min} max={props.max} />
      {props.children && <span>{props.children}</span>}
    </div>
  )
}
