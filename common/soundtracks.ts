// The radio's full track list, in order. Lives in common/ so both the server
// schedule builder and the client radio can import it (the server webpack build
// excludes src/). Files live at https://sounds.crvox.com/music/<fileName>.

export interface Track {
  fileName: string
  duration: number // seconds
  fallback?: string // AAC fallback for browsers without webm/opus
  volume?: number
}

export const MUSIC_URI = 'https://sounds.crvox.com/music'

export const tracks: Track[] = [
  { fileName: 'synthdad.webm', fallback: 'synthdad-AAC.m4a', duration: 2136 },
  { fileName: 'blackhole.webm', duration: 743, volume: 0.2 },
  { fileName: 'wonders.webm', duration: 1395 },
  { fileName: 'verge.webm', duration: 944 },
  { fileName: 'saharasafari.webm', duration: 821, volume: 0.5 },
  { fileName: 'forestfriends.webm', duration: 644, volume: 0.2 },
  { fileName: 'given.webm', duration: 537 },
  { fileName: 'beyonder.webm', duration: 688 },
  { fileName: 'seclusion.webm', duration: 974 },
  { fileName: 'skybox.webm', duration: 1312 },
  { fileName: 'slitscan.webm', duration: 1124 },
  { fileName: 'horizon.webm', duration: 1046 },
  { fileName: 'crayoncartel.webm', duration: 436 },
  { fileName: 'blessedcanals.webm', duration: 570, volume: 0.7 },
  { fileName: 'drohneburg.webm', duration: 1432 },
  { fileName: '808fate.webm', duration: 435 },
  { fileName: 'overworld.webm', duration: 654 },
  { fileName: 'cineverse.webm', duration: 1194 },
  { fileName: 'generation-vox.webm', duration: 549 },
  { fileName: 'into.webm', duration: 1472 },
  { fileName: 'roadkill.webm', duration: 1064 },
  { fileName: 'purrfection.webm', duration: 913 },
  { fileName: 'aftermath.webm', duration: 1261 },
  { fileName: 'zenwave.webm', duration: 1256 },
  { fileName: 'glitched.webm', duration: 582 },

  // nerfed by ben
  // { fileName: 'frontier.webm', duration: 1248, volume: 0.5 },

  { fileName: 'electron.webm', duration: 276, volume: 0.5 },
  { fileName: 'ceres.webm', duration: 190, volume: 0.5 },
  { fileName: 'subterranean.webm', duration: 1062, volume: 0.3 },
  { fileName: 'void.webm', duration: 876 },
  { fileName: 'submerge.webm', duration: 704 },
]

// "drohneburg.webm" -> "Drohneburg"
export function trackTitle(t: Track): string {
  return t.fileName
    .replace(/\.(webm|m4a)$/i, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
