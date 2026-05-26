// ABOUTME: Legacy polygon utilities for old Ocean chunk system
// ABOUTME: New terrain system uses SDF-based generation in terrain-geometry.ts
// todo: delete this file once old Ocean fallback is removed

import earcut from 'earcut' // only used by legacy Ocean chunk system
import * as martinez from 'martinez-polygon-clipping'

export interface Point2D {
  x: number
  z: number
}

export interface ClippedWaterGeometry {
  shouldCreateMesh: boolean
  vertices: Point2D[]
  polygons?: Point2D[][]
}

// =================================
// GEOMETRY CALCULATION HELPERS
// =================================

/**
 * Douglas-Peucker line simplification algorithm
 * Reduces the number of points in a polygon while preserving its general shape
 */
export function douglasPeucker(points: number[][], tolerance: number): number[][] {
  if (points.length <= 2) return points

  let maxDistance = 0
  let maxIndex = 0

  // Find the point with maximum distance from line between first and last points
  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const distance = distanceToLineSegment(points[i], firstPoint, lastPoint)
    if (distance > maxDistance) {
      maxDistance = distance
      maxIndex = i
    }
  }

  // If max distance is greater than tolerance, recursively simplify
  if (maxDistance > tolerance) {
    // Recursive call for the first part
    const firstHalf = douglasPeucker(points.slice(0, maxIndex + 1), tolerance)
    // Recursive call for the second part
    const secondHalf = douglasPeucker(points.slice(maxIndex), tolerance)

    // Combine results (remove duplicate middle point)
    return [...firstHalf.slice(0, -1), ...secondHalf]
  } else {
    // All points between first and last are within tolerance, keep only endpoints
    return [firstPoint, lastPoint]
  }
}

/**
 * Calculate shortest distance from point to line segment
 * Uses proper distance to line segment, not just perpendicular distance
 */
function distanceToLineSegment(point: number[], lineStart: number[], lineEnd: number[]): number {
  const px = point[0]
  const py = point[1]
  const ax = lineStart[0]
  const ay = lineStart[1]
  const bx = lineEnd[0]
  const by = lineEnd[1]

  // Vector from A to B
  const ABx = bx - ax
  const ABy = by - ay

  // Vector from A to P
  const APx = px - ax
  const APy = py - ay

  // Squared length of AB
  const ABSquared = ABx * ABx + ABy * ABy

  // If line segment has zero length, return distance to point A
  if (ABSquared === 0) {
    return Math.sqrt(APx * APx + APy * APy)
  }

  // Project AP onto AB, parameterized as t
  const t = Math.max(0, Math.min(1, (APx * ABx + APy * ABy) / ABSquared))

  // Find closest point on line segment
  const closestX = ax + t * ABx
  const closestY = ay + t * ABy

  // Return distance from point to closest point on line segment
  const dx = px - closestX
  const dy = py - closestY
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Calculate tile bounds for a water tile center and size
 * Returns bounds info, coordinates, and vertices in consistent format
 */
export function calculateTileBounds(
  waterTileCenter: Point2D,
  waterTileSize: number,
): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  coords: [number, number][]
  vertices: Point2D[]
} {
  const halfSize = waterTileSize / 2
  const tileMinX = waterTileCenter.x - halfSize
  const tileMaxX = waterTileCenter.x + halfSize
  const tileMinZ = waterTileCenter.z - halfSize
  const tileMaxZ = waterTileCenter.z + halfSize

  const coords: [number, number][] = [
    [tileMinX, tileMinZ], // Bottom-left
    [tileMaxX, tileMinZ], // Bottom-right
    [tileMaxX, tileMaxZ], // Top-right
    [tileMinX, tileMaxZ], // Top-left
    [tileMinX, tileMinZ], // Close the polygon
  ]

  const vertices: Point2D[] = [
    { x: tileMinX, z: tileMinZ },
    { x: tileMaxX, z: tileMinZ },
    { x: tileMaxX, z: tileMaxZ },
    { x: tileMinX, z: tileMaxZ },
  ]

  return { minX: tileMinX, maxX: tileMaxX, minZ: tileMinZ, maxZ: tileMaxZ, coords, vertices }
}

/**
 * Convert polygon to GeoJSON coordinates format with proper closure
 * Ensures polygon is closed by adding first point at end if needed
 */
export function polygonToGeoJSONCoords(polygon: Point2D[]): [number, number][] {
  const coords: [number, number][] = polygon.map((p) => [p.x, p.z])
  // Close the polygon if not already closed
  const first = coords[0]
  const last = coords[coords.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coords.push([first[0], first[1]])
  }
  return coords
}

/**
 * Get bounding box of a polygon
 */
export function getPolygonBounds(polygon: Point2D[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (polygon.length === 0) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  }

  let minX = polygon[0].x
  let maxX = polygon[0].x
  let minZ = polygon[0].z
  let maxZ = polygon[0].z

  for (const point of polygon) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minZ = Math.min(minZ, point.z)
    maxZ = Math.max(maxZ, point.z)
  }

  return { minX, maxX, minZ, maxZ }
}

/**
 * Test if point is inside polygon using ray casting
 */
export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false
  const { x, z } = point

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      zi = polygon[i].z
    const xj = polygon[j].x,
      zj = polygon[j].z

    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }

  return inside
}

/**
 * Check if polygon is an axis-aligned rectangle (very fast clipping possible)
 */
export function isAxisAlignedRectangle(polygon: Point2D[]): boolean {
  if (polygon.length !== 4) return false
  // Check if all edges are axis-aligned (horizontal or vertical)
  for (let i = 0; i < 4; i++) {
    const current = polygon[i]
    const next = polygon[(i + 1) % 4]
    // Edge must be either horizontal (same z) or vertical (same x)
    if (current.x !== next.x && current.z !== next.z) {
      return false
    }
  }
  return true
}

/**
 * Check if polygon is convex (allows for simpler clipping algorithms)
 */
export function isConvexPolygon(polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false
  let signChanges = 0
  let lastSign = 0

  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i]
    const p2 = polygon[(i + 1) % polygon.length]
    const p3 = polygon[(i + 2) % polygon.length]

    // Calculate cross product to determine turn direction
    const cross = (p2.x - p1.x) * (p3.z - p2.z) - (p2.z - p1.z) * (p3.x - p2.x)
    const sign = cross > 0 ? 1 : cross < 0 ? -1 : 0

    if (sign !== 0) {
      if (lastSign !== 0 && sign !== lastSign) {
        signChanges++
        if (signChanges > 1) return false // More than one sign change = concave
      }
      lastSign = sign
    }
  }
  return true
}

/**
 * Compare two coordinate rings to detect if they represent the same geometry
 * Handles floating-point precision differences and coordinate ordering
 */
export function coordinateRingsEqual(ring1: Point2D[], ring2: Point2D[], tolerance = 1e-6): boolean {
  if (ring1.length !== ring2.length) {
    return false
  }

  if (ring1.length === 0) {
    return true
  }

  // Try to find a matching starting point in ring2
  for (let offset = 0; offset < ring2.length; offset++) {
    let matches = true

    for (let i = 0; i < ring1.length; i++) {
      const p1 = ring1[i]
      const p2 = ring2[(i + offset) % ring2.length]

      const dx = Math.abs(p1.x - p2.x)
      const dz = Math.abs(p1.z - p2.z)

      if (dx > tolerance || dz > tolerance) {
        matches = false
        break
      }
    }

    if (matches) {
      return true
    }
  }

  return false
}

// =================================
// POLYGON CLIPPING OPERATIONS
// =================================

export class PolygonClipping {
  /**
   * UNIFIED AXIS-ALIGNED RECTANGLE CLIPPING
   * Fast clipping for axis-aligned rectangles using direct geometric calculation
   * Supports both inside and outside clipping operations
   */
  static clipAxisAlignedRectangle(tileCenter: Point2D, tileSize: number, rectangle: Point2D[], clipInside = false): ClippedWaterGeometry {
    const tileBounds = {
      minX: tileCenter.x - tileSize / 2,
      maxX: tileCenter.x + tileSize / 2,
      minZ: tileCenter.z - tileSize / 2,
      maxZ: tileCenter.z + tileSize / 2,
    }

    // Find rectangle bounds
    let rectMinX = Infinity,
      rectMaxX = -Infinity
    let rectMinZ = Infinity,
      rectMaxZ = -Infinity

    for (const point of rectangle) {
      rectMinX = Math.min(rectMinX, point.x)
      rectMaxX = Math.max(rectMaxX, point.x)
      rectMinZ = Math.min(rectMinZ, point.z)
      rectMaxZ = Math.max(rectMaxZ, point.z)
    }

    // Calculate intersection bounds
    const intersectMinX = Math.max(tileBounds.minX, rectMinX)
    const intersectMaxX = Math.min(tileBounds.maxX, rectMaxX)
    const intersectMinZ = Math.max(tileBounds.minZ, rectMinZ)
    const intersectMaxZ = Math.min(tileBounds.maxZ, rectMaxZ)

    // No intersection or degenerate intersection
    if (intersectMinX >= intersectMaxX || intersectMinZ >= intersectMaxZ) {
      if (clipInside) {
        // Inside clipping: no intersection means no water
        return { shouldCreateMesh: false, vertices: [], polygons: [] }
      } else {
        // Outside clipping: no intersection means full tile water
        const fullTile = [
          { x: tileBounds.minX, z: tileBounds.minZ },
          { x: tileBounds.maxX, z: tileBounds.minZ },
          { x: tileBounds.maxX, z: tileBounds.maxZ },
          { x: tileBounds.minX, z: tileBounds.maxZ },
        ]
        return { shouldCreateMesh: true, vertices: fullTile, polygons: [fullTile] }
      }
    }

    if (clipInside) {
      // INSIDE CLIPPING: Create water rectangle for the intersecting area (lake)
      const waterRectangle = [
        { x: intersectMinX, z: intersectMinZ },
        { x: intersectMaxX, z: intersectMinZ },
        { x: intersectMaxX, z: intersectMaxZ },
        { x: intersectMinX, z: intersectMaxZ },
      ]

      return {
        shouldCreateMesh: true,
        vertices: waterRectangle,
        polygons: [waterRectangle],
      }
    } else {
      // OUTSIDE CLIPPING: Generate water rectangles around the intersecting area (island)
      const waterPolygons: Point2D[][] = []

      // Left side
      if (tileBounds.minX < intersectMinX) {
        waterPolygons.push([
          { x: tileBounds.minX, z: tileBounds.minZ },
          { x: intersectMinX, z: tileBounds.minZ },
          { x: intersectMinX, z: tileBounds.maxZ },
          { x: tileBounds.minX, z: tileBounds.maxZ },
        ])
      }

      // Right side
      if (tileBounds.maxX > intersectMaxX) {
        waterPolygons.push([
          { x: intersectMaxX, z: tileBounds.minZ },
          { x: tileBounds.maxX, z: tileBounds.minZ },
          { x: tileBounds.maxX, z: tileBounds.maxZ },
          { x: intersectMaxX, z: tileBounds.maxZ },
        ])
      }

      // Bottom side
      if (tileBounds.minZ < intersectMinZ) {
        waterPolygons.push([
          { x: intersectMinX, z: tileBounds.minZ },
          { x: intersectMaxX, z: tileBounds.minZ },
          { x: intersectMaxX, z: intersectMinZ },
          { x: intersectMinX, z: intersectMinZ },
        ])
      }

      // Top side
      if (tileBounds.maxZ > intersectMaxZ) {
        waterPolygons.push([
          { x: intersectMinX, z: intersectMaxZ },
          { x: intersectMaxX, z: intersectMaxZ },
          { x: intersectMaxX, z: tileBounds.maxZ },
          { x: intersectMinX, z: tileBounds.maxZ },
        ])
      }

      return {
        shouldCreateMesh: waterPolygons.length > 0,
        vertices: waterPolygons.length > 0 ? waterPolygons[0] : [],
        polygons: waterPolygons,
      }
    }
  }

  // Simple polygon simplification by removing collinear points and duplicate vertices
  private static simplifyPolygon(polygon: [number, number][], tolerance = 0.1): [number, number][] {
    if (polygon.length <= 3) return polygon

    const simplified: [number, number][] = []

    for (let i = 0; i < polygon.length; i++) {
      const prev = polygon[i === 0 ? polygon.length - 1 : i - 1]
      const curr = polygon[i]

      // Skip duplicate points
      const distSqToPrev = (curr[0] - prev[0]) ** 2 + (curr[1] - prev[1]) ** 2
      if (distSqToPrev < tolerance * tolerance && simplified.length > 0) {
        continue
      }

      simplified.push(curr)
    }

    return simplified.length >= 3 ? simplified : polygon
  }

  /**
   * Enhanced line intersection with parameter tracking
   * Used by various clipping algorithms throughout the system
   */
  static lineIntersection(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): { x: number; z: number; t1: number; t2: number } | null {
    const x1 = p1.x,
      z1 = p1.z
    const x2 = p2.x,
      z2 = p2.z
    const x3 = p3.x,
      z3 = p3.z
    const x4 = p4.x,
      z4 = p4.z

    const denom = (x1 - x2) * (z3 - z4) - (z1 - z2) * (x3 - x4)
    if (Math.abs(denom) < 1e-10) return null // Parallel lines

    const t1 = ((x1 - x3) * (z3 - z4) - (z1 - z3) * (x3 - x4)) / denom
    const t2 = -((x1 - x2) * (z1 - z3) - (z1 - z2) * (x1 - x3)) / denom

    // Check if intersection is within both line segments
    if (t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1) {
      return {
        x: x1 + t1 * (x2 - x1),
        z: z1 + t1 * (z2 - z1),
        t1,
        t2,
      }
    }

    return null
  }

  /**
   * Clip a rectangular water tile against an island polygon
   * Returns the water geometry that should remain (outside the island)
   */
  static clipWaterTileAgainstIsland(waterTileCenter: Point2D, waterTileSize: number, islandPolygon: Point2D[]): ClippedWaterGeometry {
    // Use Martinez-Rueda algorithm - the proven, well-tested solution
    return this.clipWaterTileAgainstIslandMartinez(waterTileCenter, waterTileSize, islandPolygon)
  }

  /**
   * Clips water tile against multiple separate land masses (for islands with ID >= 40)
   * All rings are treated as land to exclude from water
   */
  static clipWaterTileAgainstMultipleLandMasses(waterTileCenter: Point2D, waterTileSize: number, landRings: Point2D[][]): ClippedWaterGeometry {
    const tileBounds = calculateTileBounds(waterTileCenter, waterTileSize)
    const waterRectCoords = tileBounds.coords
    const waterRect = tileBounds.vertices

    try {
      // Validate and prepare all land rings first
      const validLandCoords: [number, number][][] = []

      for (let i = 0; i < landRings.length; i++) {
        const landRing = landRings[i]
        const landCoords = landRing.map((p) => [p.x, p.z] as [number, number])

        // Validate polygon before Martinez
        if (landCoords.length < 4) {
          console.log(`POLYGON ERROR: Ring ${i} has only ${landCoords.length} vertices, need at least 4`)
          continue
        }

        // Check for NaN coordinates
        const hasNaN = landCoords.some((coord) => isNaN(coord[0]) || isNaN(coord[1]))
        if (hasNaN) {
          console.log(`POLYGON ERROR: Ring ${i} contains NaN coordinates`)
          continue
        }

        // Check if polygon is closed (first == last vertex)
        const first = landCoords[0]
        const last = landCoords[landCoords.length - 1]
        const isClosed = first[0] === last[0] && first[1] === last[1]
        if (!isClosed) {
          landCoords.push([first[0], first[1]])
        }

        validLandCoords.push(landCoords)
      }

      if (validLandCoords.length === 0) {
        console.log(`No valid land polygons to clip against`)
        return { shouldCreateMesh: true, vertices: waterRect, polygons: [waterRect] }
      }

      // Try single Martinez operation first (more robust than sequential)
      let result: [number, number][][] | null = null

      try {
        // Single operation: subtract all land polygons at once
        result = martinez.diff([waterRectCoords], validLandCoords) as [number, number][][]

        // Apply polygon simplification to reduce unnecessary vertices
        if (result && result.length > 0) {
          result = result.map((polygon) => this.simplifyPolygon(polygon))
        }

        if (!result || result.length === 0) {
          // Fallback: sequential subtraction with better error handling
          result = [waterRectCoords]

          for (let i = 0; i < validLandCoords.length; i++) {
            const newResult = martinez.diff(result, [validLandCoords[i]]) as [number, number][][]

            if (!newResult) {
              break
            }

            if (newResult.length === 0) {
              return { shouldCreateMesh: false, vertices: [], polygons: undefined }
            }

            result = newResult
          }
        }
      } catch (error) {
        console.log(`Martinez error:`, error instanceof Error ? error.message : String(error))
        console.log(`Falling back to basic rectangular water tile`)

        // Ultimate fallback: create basic water tile (better than no water)
        return { shouldCreateMesh: true, vertices: waterRect, polygons: [waterRect] }
      }

      // Validate final result
      if (!result || result.length === 0) {
        return { shouldCreateMesh: false, vertices: [], polygons: undefined }
      }

      // Convert result back to our format
      // Martinez returns: Array<MultiPolygon> where MultiPolygon = Array<Polygon>
      // Each MultiPolygon[0] is the outer boundary, MultiPolygon[1+] are holes
      const allVertices: Point2D[] = []
      const polygons: Point2D[][] = []

      for (let p = 0; p < result.length; p++) {
        const multiPolygon = result[p] // This is one connected water area (possibly with holes)

        if (multiPolygon.length > 0) {
          // Only process the outer ring (boundary) - ignore holes for water mesh creation
          // Holes will be handled by not creating water there in the first place
          const outerRing = multiPolygon[0]

          const vertices: Point2D[] = []
          for (let i = 0; i < outerRing.length - 1; i++) {
            // Skip closing vertex
            const rawVertex = outerRing[i] as unknown as [number, number]
            const vertex = { x: rawVertex[0], z: rawVertex[1] }
            vertices.push(vertex)
            allVertices.push(vertex)
          }

          if (vertices.length >= 3) {
            polygons.push(vertices)
          }
        }
      }

      if (polygons.length === 0) {
        // When Martinez returns degenerate polygons, it means the intersection
        // creates very small or invalid geometry. In these cases, it's better
        // to not create water tiles that might clip into land
        return { shouldCreateMesh: false, vertices: [], polygons: undefined }
      }

      return {
        shouldCreateMesh: true,
        vertices: allVertices,
        polygons: polygons.length > 1 ? polygons : undefined,
      }
    } catch (error) {
      console.error(`🔧 MARTINEZ EXCEPTION: Martinez clipping failed for tile (${waterTileCenter.x},${waterTileCenter.z}):`, error)
      console.error(`   Error details:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        validLandCount: landRings.length,
        waterRectCoords: waterRectCoords.length,
      })
      // Log first land polygon for debugging
      if (landRings.length > 0) {
        console.error(`   First land polygon sample:`, landRings[0].slice(0, 5))
      }
      return { shouldCreateMesh: false, vertices: [], polygons: undefined }
    }
  }

  /**
   * Clip water tile to the OUTSIDE of a polygon (water around islands)
   * Uses Martinez difference operation: waterRect - polygon
   */
  static clipToOutsidePolygon(waterTileCenter: Point2D, waterTileSize: number, polygon: Point2D[]): ClippedWaterGeometry {
    const tileBounds = calculateTileBounds(waterTileCenter, waterTileSize)
    const waterRectCoords = tileBounds.coords
    const polygonCoords = polygonToGeoJSONCoords(polygon)

    try {
      // Use Martinez difference operation: waterRect - polygon
      // This gives us the part of the water tile that is OUTSIDE the polygon
      const result = martinez.diff(
        [waterRectCoords], // Subject polygon (water rectangle)
        [polygonCoords], // Clipping polygon
      )

      return this.processClippingResult(result)
    } catch (error) {
      console.warn('Martinez outside clipping failed:', error)
      return this.createFallbackRect(waterTileCenter, waterTileSize)
    }
  }

  /**
   * Clip water tile to the INSIDE of a polygon (water inside lakes)
   * Uses Martinez intersection operation: waterRect ∩ polygon
   */
  static clipToInsidePolygon(waterTileCenter: Point2D, waterTileSize: number, polygon: Point2D[]): ClippedWaterGeometry {
    const tileBounds = calculateTileBounds(waterTileCenter, waterTileSize)
    const waterRectCoords = tileBounds.coords
    const polygonCoords = polygonToGeoJSONCoords(polygon)

    try {
      // Use Martinez intersection operation: waterRect ∩ polygon
      // This gives us the part of the water tile that is INSIDE the polygon
      const result = martinez.intersection(
        [waterRectCoords], // Subject polygon (water rectangle)
        [polygonCoords], // Clipping polygon
      )

      return this.processClippingResult(result)
    } catch (error) {
      console.warn('Martinez inside clipping failed:', error)
      return { shouldCreateMesh: false, vertices: [], polygons: [] }
    }
  }

  /**
   * Clip water tile to the OUTSIDE of multiple polygons (water around multi-ring islands)
   * Used for islands with multiple separate land masses (e.g., Gaza with 7 rings)
   * Uses Martinez difference operation: waterRect - (polygon1 + polygon2 + ...)
   */
  static clipToOutsideMultiPolygon(waterTileCenter: Point2D, waterTileSize: number, polygons: Point2D[][]): ClippedWaterGeometry {
    const tileBounds = calculateTileBounds(waterTileCenter, waterTileSize)
    const waterRectCoords = tileBounds.coords

    try {
      // Convert all polygons to GeoJSON format
      const allPolygonCoords = polygons.map((polygon) => polygonToGeoJSONCoords(polygon))

      // Use Martinez difference operation: waterRect - all polygons
      // This gives us the part of the water tile that is OUTSIDE all polygons at once
      const result = martinez.diff(
        [waterRectCoords], // Subject polygon (water rectangle)
        allPolygonCoords, // All clipping polygons (all rings from the multi-ring island)
      )

      return this.processClippingResult(result)
    } catch (error) {
      console.warn('Martinez multi-polygon outside clipping failed:', error)
      return this.createFallbackRect(waterTileCenter, waterTileSize)
    }
  }

  /**
   * Process the result from Martinez clipping operations
   */
  private static processClippingResult(result: any): ClippedWaterGeometry {
    if (!result || result.length === 0) {
      return { shouldCreateMesh: false, vertices: [], polygons: [] }
    }

    const allPolygons: Point2D[][] = []

    for (const polygon of result) {
      if (polygon && polygon.length > 0) {
        const outerRing = polygon[0]
        if (outerRing && outerRing.length >= 4) {
          const polygonVertices = outerRing.slice(0, -1).map((coord: [number, number]) => ({
            x: coord[0],
            z: coord[1],
          }))

          allPolygons.push(polygonVertices)
        }
      }
    }

    if (allPolygons.length === 0) {
      return { shouldCreateMesh: false, vertices: [], polygons: [] }
    }

    return {
      shouldCreateMesh: true,
      vertices: allPolygons[0],
      polygons: allPolygons,
    }
  }

  /**
   * Create fallback rectangle for outside clipping failures
   */
  private static createFallbackRect(waterTileCenter: Point2D, waterTileSize: number): ClippedWaterGeometry {
    const tileBounds = calculateTileBounds(waterTileCenter, waterTileSize)
    return {
      shouldCreateMesh: true,
      vertices: tileBounds.vertices,
      polygons: [tileBounds.vertices],
    }
  }

  /**
   * Martinez-Rueda polygon clipping - the correct implementation
   */
  static clipWaterTileAgainstIslandMartinez(waterTileCenter: Point2D, waterTileSize: number, islandPolygon: Point2D[]): ClippedWaterGeometry {
    // Delegate to the new outside clipping function
    return this.clipToOutsidePolygon(waterTileCenter, waterTileSize, islandPolygon)
  }

  /**
   * Check if two polygons intersect
   */
  static polygonsIntersect(poly1: Point2D[], poly2: Point2D[]): boolean {
    // Check if any vertex of poly1 is inside poly2
    for (const vertex of poly1) {
      if (pointInPolygon(vertex, poly2)) {
        return true
      }
    }

    // Check if any vertex of poly2 is inside poly1
    for (const vertex of poly2) {
      if (pointInPolygon(vertex, poly1)) {
        return true
      }
    }

    // Check if any edges intersect
    for (let i = 0; i < poly1.length; i++) {
      const p1Start = poly1[i]
      const p1End = poly1[(i + 1) % poly1.length]

      for (let j = 0; j < poly2.length; j++) {
        const p2Start = poly2[j]
        const p2End = poly2[(j + 1) % poly2.length]

        if (this.lineIntersection(p1Start, p1End, p2Start, p2End)) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Test if point is inside polygon using ray casting (delegated to helper)
   */
  static pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
    return pointInPolygon(point, polygon)
  }

  /**
   * Create BabylonJS vertices from clipped polygon points
   */
  static createMeshVertices(clippedGeometry: ClippedWaterGeometry, waterLevel: number): { vertices: Float32Array; indices: number[] } {
    if (!clippedGeometry.shouldCreateMesh || clippedGeometry.vertices.length < 3) {
      return { vertices: new Float32Array(0), indices: [] }
    }

    // Use earcut library for robust triangulation (same as BabylonJS uses)

    // Convert vertices to earcut format (flat array of [x, z, x, z, ...])
    const coords: number[] = []
    for (const vertex of clippedGeometry.vertices) {
      coords.push(vertex.x, vertex.z)
    }

    // Use earcut for all triangulation (no optimizations)
    const triangleIndices = earcut(coords)

    // Create unique vertices array (no duplication)
    const vertices: number[] = []
    for (let i = 0; i < coords.length; i += 2) {
      vertices.push(coords[i], waterLevel, coords[i + 1]) // x, y, z
    }

    // Return both vertices and indices for proper indexed geometry
    return {
      vertices: new Float32Array(vertices),
      indices: triangleIndices,
    }
  }

  /**
   * Compare two coordinate rings to detect if they represent the same geometry (delegated to helper)
   */
  static coordinateRingsEqual(ring1: Point2D[], ring2: Point2D[], tolerance = 1e-6): boolean {
    return coordinateRingsEqual(ring1, ring2, tolerance)
  }
}
