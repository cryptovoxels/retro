import { useEffect, useRef } from 'preact/hooks'
import { isDesktop } from '../../../../common/helpers/detector'
import { saveAsset } from '../../helpers/save-helper'
import { AssetType, EditableIcons, Props } from './editable'
import { useEditableLifecycle } from './useEditableLifecycle'

export default function EditableDescription({ value: originalValue, type, className, data, isowner, onSave, onFail, validationRule }: Props) {
  const noop = () => {
    /** NOOP */
  }

  const { value, isEditing, onEditBegin, onEditCancel, onEditComplete, onEditUpdate } = useEditableLifecycle({
    value: originalValue ?? '',
    save: (value) => saveAsset(type, data.id, { description: value.toString() }),
    onSaveSuccess: onSave ?? noop,
    onSaveFailure: onFail ?? noop,
    validationRule,
  })

  return <div>{value}</div>
}

type EditableDescriptionInputProps = {
  value: string
  type: AssetType
  className: string
  onChange(newValue: string): void
}

function EditableDescriptionInput({ className, value, type, onChange }: EditableDescriptionInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  return (
    <div style="display: grid;">
      <textarea className={className} rows={8} cols={isDesktop() ? 50 : 20} title="description" value={value} maxLength={850} ref={inputRef} onChange={(e) => onChange((e as any).target['value'])} />
    </div>
  )
}
