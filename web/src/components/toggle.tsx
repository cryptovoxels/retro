type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
}

export default function Toggle({ checked, onChange }: Props) {
  return (
    <button type="button" class={`toggle ${checked ? 'on' : ''}`} aria-pressed={checked} onClick={() => onChange(!checked)}>
      <span class="toggle-knob" />
    </button>
  )
}
