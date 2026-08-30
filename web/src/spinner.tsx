export function Spinner(props: { size?: number; bg?: 'dark' | 'light'; class?: string }) {
  const n = props.size ?? 20
  const cls = ['cube-logo', 'cube-spin', props.bg === 'light' && 'on-light', props.class].filter(Boolean).join(' ')
  return (
    <span class={cls} style={{ ['--size']: `${n}px` }} role="status" aria-label="Loading">
      <div class="box">
        <div class="face-N" />
        <div class="face-E" />
        <div class="face-S" />
        <div class="face-W" />
        <div class="face-F" />
        <div class="face-B" />
      </div>
    </span>
  )
}
