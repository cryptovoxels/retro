import { ComponentChild, JSX, VNode } from 'preact'
import { useId } from 'preact/hooks'

type Props = {
  name: string
  value: string
  label?: string
  onChange?: JSX.GenericEventHandler<HTMLInputElement>
  disabled?: boolean
  placeholder?: string
  size?: number
  maxLength?: number
  children?: ComponentChild[] | VNode<any> | null
}

export function ColorField(props: Props) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id}>{props.label ?? props.name}</label>
      <input type="color" name={props.name} value={props.value} onChange={props.onChange} disabled={props.disabled} id={id} placeholder={props.placeholder} size={props.size} maxLength={props.maxLength} />
      {props.children && <span>{props.children}</span>}
    </div>
  )
}
