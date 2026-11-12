// ABOUTME: CLI script that renders island geometries to SVG files
// ABOUTME: Uses the same rendering logic as island.ts but outputs SVG instead of 3D meshes

const https = require('https')
const fs = require('fs')
const path = require('path')

// Configuration
const COLORS = {
  land: '#4CAF50', // Green
  lakes: '#2196F3', // Blue
  basements: '#757575', // Gray
}

const STROKE_WIDTH = 0.5
const COORDINATE_SCALE = 100
const CHUNK_SIZE = 48 // World grid chunk size

/**
 * Fetch islands data from the API
 */
function fetchIslandsData() {
  return new Promise((resolve, reject) => {
    https
      .get('https://www.voxels.com/api/world/islands.json', (res) => {
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on('error', (err) => {
        reject(err)
      })
  })
}

/**
 * Port of makeHoles function from island.ts
 * Converts MultiPolygon geometry to array of coordinate arrays
 */
function makeHoles(multiPolygonGeometry) {
  if (!multiPolygonGeometry || !multiPolygonGeometry.coordinates) {
    return []
  }

  const holes = []
  for (const polygon of multiPolygonGeometry.coordinates) {
    for (const ring of polygon) {
      const hole = ring.map((c) => [c[0] * COORDINATE_SCALE, c[1] * COORDINATE_SCALE]).reverse()
      holes.push(hole)
    }
  }
  return holes
}

/**
 * Convert coordinate array to SVG path data
 */
function coordinatesToPath(coordinates) {
  if (!coordinates || coordinates.length === 0) {
    return ''
  }

  const pathParts = coordinates.map((coord, i) => {
    const x = coord[0]
    const y = -coord[1] // Flip Y axis for SVG (positive Y goes down in SVG)
    return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`
  })

  return pathParts.join(' ') + ' Z' // Close the path
}

/**
 * Scale and reverse coordinates (matching island.ts logic)
 */
function processCoordinates(coords) {
  return coords.map((c) => [c[0] * COORDINATE_SCALE, c[1] * COORDINATE_SCALE]).reverse()
}

/**
 * Calculate centroid of a polygon for label placement
 */
function calculateCentroid(coordinates) {
  let sumX = 0
  let sumY = 0
  const count = coordinates.length

  for (const coord of coordinates) {
    sumX += coord[0]
    sumY += coord[1]
  }

  return {
    x: sumX / count,
    y: -sumY / count, // Flip Y axis for SVG
  }
}

/**
 * Calculate bounding box for all geometries
 */
function calculateBoundingBox(allCoordinates) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const coords of allCoordinates) {
    for (const coord of coords) {
      minX = Math.min(minX, coord[0])
      minY = Math.min(minY, coord[1])
      maxX = Math.max(maxX, coord[0])
      maxY = Math.max(maxY, coord[1])
    }
  }

  return { minX, minY, maxX, maxY }
}

/**
 * Generate SVG content for an island
 */
function generateSVG(island) {
  const svgPaths = []
  const allCoordinates = []

  // Process main island geometry
  const mainCoords = processCoordinates(island.geometry.coordinates[0])
  allCoordinates.push(mainCoords)
  const mainCentroid = calculateCentroid(mainCoords)
  svgPaths.push({
    path: coordinatesToPath(mainCoords),
    color: COLORS.land,
    id: 'land-main',
    centroid: mainCentroid,
    label: island.id >= 40 ? 'Ring #0' : 'Island',
  })

  // Handle multi-ring islands (id >= 40)
  if (island.id >= 40 && island.geometry.coordinates.length > 1) {
    for (let i = 1; i < island.geometry.coordinates.length; i++) {
      const ringCoords = processCoordinates(island.geometry.coordinates[i])
      allCoordinates.push(ringCoords)
      const ringCentroid = calculateCentroid(ringCoords)
      svgPaths.push({
        path: coordinatesToPath(ringCoords),
        color: COLORS.land,
        id: `land-ring-${i}`,
        centroid: ringCentroid,
        label: `Ring #${i}`,
      })
    }
  }

  // Process lakes
  const lakes = makeHoles(island.lakes_geometry_json)
  lakes.forEach((lake, i) => {
    allCoordinates.push(lake)
    const lakeCentroid = calculateCentroid(lake)
    svgPaths.push({
      path: coordinatesToPath(lake),
      color: COLORS.lakes,
      id: `lake-${i}`,
      centroid: lakeCentroid,
      label: `Lake #${i + 1}`,
    })
  })

  // Process basement holes
  const basements = makeHoles(island.holes_geometry_json)
  basements.forEach((basement, i) => {
    allCoordinates.push(basement)
    const basementCentroid = calculateCentroid(basement)
    svgPaths.push({
      path: coordinatesToPath(basement),
      color: COLORS.basements,
      id: `basement-${i}`,
      centroid: basementCentroid,
      label: `Basement #${i + 1}`,
    })
  })

  // Calculate viewBox
  const bbox = calculateBoundingBox(allCoordinates)
  const padding = 10
  const viewBox = `${bbox.minX - padding} ${-bbox.maxY - padding} ${bbox.maxX - bbox.minX + padding * 2} ${bbox.maxY - bbox.minY + padding * 2}`

  // Generate SVG
  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <title>${island.name} (Island ${island.id})</title>

  <!--
    Color Legend:
    - Green (${COLORS.land}): Main island land masses
    - Blue (${COLORS.lakes}): Lakes (water holes in the island)
    - Gray (${COLORS.basements}): Parcel basement holes
  -->

  <!-- Main Land Masses -->
  <g id="land">
`

  // Add land paths
  svgPaths
    .filter((p) => p.id.startsWith('land'))
    .forEach((p) => {
      svg += `    <path id="${p.id}" d="${p.path}" fill="${p.color}" stroke="#000" stroke-width="${STROKE_WIDTH}"/>\n`
    })

  svg += `  </g>

  <!-- Lakes -->
  <g id="lakes">
`

  // Add lake paths
  svgPaths
    .filter((p) => p.id.startsWith('lake'))
    .forEach((p) => {
      svg += `    <path id="${p.id}" d="${p.path}" fill="${p.color}" stroke="#000" stroke-width="${STROKE_WIDTH}"/>\n`
    })

  svg += `  </g>

  <!-- Basement Holes -->
  <g id="basements">
`

  // Add basement paths
  svgPaths
    .filter((p) => p.id.startsWith('basement'))
    .forEach((p) => {
      svg += `    <path id="${p.id}" d="${p.path}" fill="${p.color}" stroke="#000" stroke-width="${STROKE_WIDTH}"/>\n`
    })

  svg += `  </g>

  <!-- Labels -->
  <g id="labels" font-family="Arial, sans-serif" font-size="2" fill="#000" text-anchor="middle">
`

  // Add labels (skip basements)
  svgPaths
    .filter((p) => !p.id.startsWith('basement'))
    .forEach((p) => {
      svg += `    <text x="${p.centroid.x}" y="${p.centroid.y}" stroke="#fff" stroke-width="0.3" paint-order="stroke">${p.label}</text>\n`
    })

  svg += `  </g>

  <!-- Chunk Grid Overlay -->
  <g id="chunk-grid" opacity="0.6">
`

  // Calculate grid bounds aligned to chunk size
  // bbox stores Y as positive (world Z), but SVG Y = -worldZ, so flip it
  const gridMinX = Math.floor(bbox.minX / CHUNK_SIZE) * CHUNK_SIZE
  const gridMaxX = Math.ceil(bbox.maxX / CHUNK_SIZE) * CHUNK_SIZE
  const gridMinY = Math.floor(-bbox.maxY / CHUNK_SIZE) * CHUNK_SIZE // SVG Y (flipped)
  const gridMaxY = Math.ceil(-bbox.minY / CHUNK_SIZE) * CHUNK_SIZE

  // Draw vertical lines (aligned to world X coordinates)
  for (let x = gridMinX; x <= gridMaxX; x += CHUNK_SIZE) {
    svg += `    <line x1="${x}" y1="${gridMinY}" x2="${x}" y2="${gridMaxY}" stroke="#FF0000" stroke-width="0.5" stroke-dasharray="2,2"/>\n`
  }

  // Draw horizontal lines (aligned to world Z coordinates)
  for (let svgY = gridMinY; svgY <= gridMaxY; svgY += CHUNK_SIZE) {
    svg += `    <line x1="${gridMinX}" y1="${svgY}" x2="${gridMaxX}" y2="${svgY}" stroke="#FF0000" stroke-width="0.5" stroke-dasharray="2,2"/>\n`
  }

  svg += `  </g>

  <!-- Chunk Grid Labels -->
  <g id="chunk-labels" font-family="monospace" font-size="3" fill="#FF0000" opacity="0.5">
`

  // Add grid coordinate labels at intersections
  for (let x = gridMinX; x <= gridMaxX; x += CHUNK_SIZE) {
    for (let svgY = gridMinY; svgY <= gridMaxY; svgY += CHUNK_SIZE) {
      const gridX = Math.floor(x / CHUNK_SIZE)
      // Convert SVG Y back to world Z: worldZ = -svgY
      const worldZ = -svgY
      const gridZ = Math.floor(worldZ / CHUNK_SIZE)
      svg += `    <text x="${x + 1}" y="${svgY + 3}" font-size="2.5">${gridX},${gridZ}</text>\n`
    }
  }

  svg += `  </g>
</svg>`

  return svg
}

/**
 * Sanitize island name for filename
 */
function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Main function
 */
async function main() {
  const islandId = parseInt(process.argv[2], 10)

  if (isNaN(islandId)) {
    console.error('Usage: node render-island-svg.js <island-id>')
    console.error('Example: node render-island-svg.js 1')
    process.exit(1)
  }

  try {
    console.log(`Fetching islands data...`)
    const data = await fetchIslandsData()

    const island = data.islands.find((i) => i.id === islandId)

    if (!island) {
      console.error(`Island with id ${islandId} not found`)
      process.exit(1)
    }

    console.log(`Found island: ${island.name} (id: ${island.id})`)

    // Check for multi-ring
    if (island.id >= 40 && island.geometry.coordinates.length > 1) {
      console.log(`  Multi-ring island with ${island.geometry.coordinates.length} land masses`)
    }

    // Check for lakes
    if (island.lakes_geometry_json && island.lakes_geometry_json.coordinates) {
      console.log(`  Has ${island.lakes_geometry_json.coordinates.length} lake(s)`)
    }

    // Check for basements
    if (island.holes_geometry_json && island.holes_geometry_json.coordinates) {
      console.log(`  Has ${island.holes_geometry_json.coordinates.length} basement hole(s)`)
    }

    const svg = generateSVG(island)

    const filename = `island-${sanitizeFilename(island.name)}-${island.id}.svg`
    const filepath = path.join(__dirname, '..', filename)

    fs.writeFileSync(filepath, svg)

    console.log(`\nSVG saved to: ${filename}`)
  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

main()
