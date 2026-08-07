export const blocks = [
  { name: '01-grid.png', value: (1 << 15) + 1 },
  { name: '02-window.png', value: 2 },
  { name: '03-white-square.png', value: (1 << 15) + 3 },
  { name: '04-line.png', value: (1 << 15) + 4 },
  { name: '05-bricks.png', value: (1 << 15) + 5 },
  { name: '06-the-xx.png', value: (1 << 15) + 6 },
  { name: '07-lined.png', value: (1 << 15) + 7 },
  { name: '08-nick-batt.png', value: (1 << 15) + 8 },
  { name: '09-scots.png', value: (1 << 15) + 9 },
  { name: '10-subgrid.png', value: (1 << 15) + 10 },
  { name: '11-microblob.png', value: (1 << 15) + 11 },
  { name: '12-weeblob.png', value: (1 << 15) + 12 },
  { name: '13-smallblob.png', value: (1 << 15) + 13 },
  { name: '14-blob.png', value: (1 << 15) + 14 },
  { name: '03-white-square.png', value: (1 << 15) + 15 },
  { name: '03-white-square.png', value: (1 << 15) + 16 },
]

export const defaultColors = ['#ffffff', '#888888', '#000000', '#ff71ce', '#01cdfe', '#05ffa1', '#b967ff', '#fffb96']

export function getBlockId(textureIndex: any, tintIndex: any) {
  const block = blocks[textureIndex] || blocks[0]
  return block.value + tintIndex * 32
}
