export function Spinner(props: { size?: number; bg?: 'dark' | 'light'; class?: string }) {
  const n = props.size ?? 20
  const cls = ['loading', props.bg === 'light' && 'on-light', props.class].filter(Boolean).join(' ')
  return <span class={cls} style={{ width: n, height: n }} role="status" aria-label="Loading" />
}
