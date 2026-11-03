// Includes Lucide SVGs: https://lucide.dev. See LUCIDE-LICENSE.
const icons = {
  home: <path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z" />,
  costumes: <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />,
  dance: (
    <>
      <circle cx="13" cy="4" r="2" />
      <path d="m4 3 3 6 5-1 5 3 4-5M12 8l-2 7-5 6m5-6 7 1 2 5" />
    </>
  ),
  emote: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" x2="9.01" y1="9" y2="9" />
      <line x1="15" x2="15.01" y1="9" y2="9" />
    </>
  ),
  zoom: (
    <>
      <path d="M2 8h7v8H2zM9 10l12-6v16L9 14" />
    </>
  ),
  fly: (
    <>
      <path d="M16 7h.01M3.4 18H2l2-4 1-6 4 3 3-3 1.5-4.5a3 3 0 0 1 5.7 1.5L22 7l-3 1a9 9 0 0 1-9 10H3.4ZM9 18v3m5-4v4M8 14l4-4" />
    </>
  ),
  camera: (
    <>
      <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  fullscreen: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </>
  ),
}

export default function InteractIcon({ name }: { name: keyof typeof icons }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {icons[name]}
    </svg>
  )
}
