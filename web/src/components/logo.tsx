// 3D voxels logo (CSS cubes)

export default function Logo() {
  const logo = `
    # #
    # #
     #`

  const boxes = []

  const lines = logo.split('\n')
  for (let y = 0; y < lines.length; y++) {
    const line = lines[y]
    for (let x = 0; x < line.length; x++) {
      if (line[x] === '#') {
        const left = `${x - 2}rem`
        const top = `${y}rem`
        boxes.push(
          <div class="box" style={{ top, left }} key={`${x}-${y}`}>
            <div class="face-N" />
            <div class="face-E" />
            <div class="face-S" />
            <div class="face-W" />
            <div class="face-F" />
            <div class="face-B" />
          </div>,
        )
      }
    }
  }
  return (
    <a href="/" class="voxels-logo">
      {boxes}
    </a>
  )
}
