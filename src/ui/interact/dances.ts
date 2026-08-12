import { Animations } from '../../avatar-animations'

export type Dance = {
  name: string
  slug: string
  animation: Animations | null
}

export const dances: Dance[] = [
  { name: 'Idle', slug: 'idle', animation: null },
  { name: 'Wave', slug: 'wave', animation: Animations.Wave },
  { name: 'Dance', slug: 'dance', animation: Animations.Dance },
  { name: 'Sitting', slug: 'sitting', animation: Animations.Sitting },
  { name: 'Spin', slug: 'spin', animation: Animations.Spin },
  { name: 'Savage', slug: 'savage', animation: Animations.Savage },
  { name: 'Uprock', slug: 'uprock', animation: Animations.Uprock },
  { name: 'Floss', slug: 'floss', animation: Animations.Floss },
  { name: 'Backflip', slug: 'backflip', animation: Animations.Backflip },
  { name: 'Celebrate', slug: 'celebration', animation: Animations.Celebration },
  { name: 'Orange', slug: 'orange', animation: Animations.Orange },
  { name: 'Hype', slug: 'hype', animation: Animations.Hype },
  { name: 'Shocked', slug: 'shocked', animation: Animations.Shocked },
  { name: 'Wipe', slug: 'wipe', animation: Animations.Wipe },
  { name: 'Applause', slug: 'applause', animation: Animations.Applause },
]

const aliases: Record<string, string> = {
  celebrate: 'celebration',
}

export function danceBySlug(slug: string): Dance | undefined {
  const key = aliases[slug] ?? slug
  return dances.find((d) => d.slug === key)
}
