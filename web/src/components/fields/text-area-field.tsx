import { ComponentChild, JSX, VNode } from 'preact'
import { useId } from 'preact/hooks'

type Props = {
  name: string
  value: string
  label?: string
  onChange?: JSX.GenericEventHandler<HTMLTextAreaElement>
  disabled?: boolean
  placeholder?: string
  size?: number
  maxLength?: number
  children?: ComponentChild[] | VNode<any> | null
}

export function TextAreaField(props: Props) {
  const id = useId()
  return (
    <div class="f">
      <label htmlFor={id}>{props.label ?? props.name}</label>
      <textarea name={props.name} onChange={props.onChange} disabled={props.disabled} id={id} placeholder={props.placeholder} maxLength={props.maxLength}>
        {props.value}
      </textarea>
      {props.children && <span>{props.children}</span>}
    </div>
  )
}
