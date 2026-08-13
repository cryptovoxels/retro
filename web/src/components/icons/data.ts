// Icon definitions as heredocs - much easier to edit visually
// # = filled pixel, . = empty

const RAW_ICONS = {
  // person silhouette - head + shoulders
  account: `
    ..#..
    ...#.
    #####
    ...#.
    ..#..
  `,

  // shirt / t-shirt shape
  costume: `
    ##.##
    #####
    .###.
    .###.
    .###.
  `,

  // stacked cubes / blocks
  assets: `
    ...#.
    ..##.
    .#.#.
    #..#.
    #..#.
  `,

  // overlapping squares
  collections: `
    ###..
    #.#..
    #####
    ..#.#
    ..###
  `,

  // calendar / star burst
  events: `
    ..#..
    #.#.#
    .###.
    #.#.#
    ..#..
  `,

  // island with palm tree vibe / hill
  islands: `
    ..#..
    .#.#.
    #...#
    .#.#.
    ..#..
  `,

  // folded map / compass diamond
  map: `
    ..#..
    ..#..
    #####
    ..#..
    ..#..
  `,

  // package / box with tape
  parcels: `
    #####
    #...#
    #...#
    #...#
    #####
  `,

  // grid of rooms
  spaces: `
    .....
    .###.
    .#.#.
    .###.
    .....
  `,

  // creature face / two eyes + mouth
  womps: `
    #####
    #...#
    #.#.#
    #...#
    .#.#.
  `,

  // arrow pointing right out of a doorway
  logout: `
    ###..
    #.#..
    #.###
    #.#..
    ###..
  `,

  // speech bubble with tail
  chat: `
    #####
    #...#
    #...#
    #####
    .#...
  `,

  // checkmark / V shape
  v: `
    .....
    .#.#.
    .#.#.
    ..#..
    .....
    .....
  `,
}

// Parser: convert heredoc strings to Uint8Array (25 bytes for 5x5)
function parseIcon(heredocString: string) {
  const arr = new Uint8Array(25)
  let idx = 0

  heredocString
    .trim()
    .split('\n')
    .forEach((line: string) => {
      const trimmed = line.trim()
      if (trimmed.length === 5) {
        for (let i = 0; i < 5; i++) {
          arr[idx++] = trimmed[i] === '#' ? 1 : 0
        }
      }
    })

  return arr
}

// Build the final icons object
const ICON_DATA: Record<string, { name: string; bitmap: Uint8Array }> = {}

Object.entries(RAW_ICONS).forEach(([key, heredoc]) => {
  ICON_DATA[key] = {
    name: key.charAt(0).toUpperCase() + key.slice(1),
    bitmap: parseIcon(heredoc),
  }
})

// Export for use
export { ICON_DATA, parseIcon }
