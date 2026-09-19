import { ComponentChild, JSX, VNode } from 'preact'
import { useId } from 'preact/hooks'

type Props = {
  name: string
  checked: boolean
  label?: string
  onChange?: JSX.GenericEventHandler<HTMLInputElement>
  disabled?: boolean
  placeholder?: string
  size?: number
  maxLength?: number
  children?: ComponentChild[] | VNode<any> | null
}

export function CheckboxField(props: Props) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id}>{props.label ?? props.name}</label>
      <input type="checkbox" name={props.name} checked={props.checked} onChange={props.onChange} disabled={props.disabled} id={id} placeholder={props.placeholder} size={props.size} maxLength={props.maxLength} />
      {props.children && <span>{props.children}</span>}
    </div>
  )
}
