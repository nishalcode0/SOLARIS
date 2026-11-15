
import * as THREE from 'three'
import type { TerrainPatch } from '../lib/lolaElevation'

type PSRPosition = [number, number]
type PSRRing = PSRPosition[]
type PSRPolygon = PSRRing[]

export interface PSRFeature {
  type: 'Feature'
  geometry:
    | {
        type: 'Polygon'
        coordinates: PSRPolygon
      }
    | {
        type: 'MultiPolygon'
        coordinates: PSRPolygon[]
      }
}

function clipSegment(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): [number, number, number, number] | null {
  const dx = x1 - x0
  const dz = z1 - z0

  let t0 = 0
  let t1 = 1

  const tests: [number, number][] = [
    [-dx, x0 - minX],
    [dx, maxX - x0],
    [-dz, z0 - minZ],
    [dz, maxZ - z0],
  ]

  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }

    const t = q / p

    if (p < 0) {
      t0 = Math.max(t0, t)
    } else {
      t1 = Math.min(t1, t)
    }

    if (t0 > t1) return null
  }

  return [
    x0 + t0 * dx,
    z0 + t0 * dz,
    x0 + t1 * dx,
    z0 + t1 * dz,
  ]
}

export function createPSROverlay(
  patch: TerrainPatch,
  features: PSRFeature[],
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'NASA_MAPPED_PSR_BOUNDARIES'

  const {
    width,
    height,
    spacingM,
    elevations,
    centerX,
    centerY,
  } = patch

  const halfWidth = ((width - 1) * spacingM) / 2
  const halfHeight = ((height - 1) * spacingM) / 2

  const positions: number[] = []

  function terrainHeight(x: number, z: number): number | null {
    const column = Math.round(
      x / spacingM + (width - 1) / 2,
    )

    const row = Math.round(
      z / spacingM + (height - 1) / 2,
    )

    if (
      column < 0 ||
      column >= width ||
      row < 0 ||
      row >= height
    ) {
      return null
    }

    const elevation = elevations[row * width + column]

    if (!Number.isFinite(elevation)) return null

    // Match the terrain mesh's 2x vertical exaggeration.
    return elevation * 2 + 18
  }

  function addSegment(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
  ) {
    const clipped = clipSegment(
      x0,
      z0,
      x1,
      z1,
      -halfWidth,
      halfWidth,
      -halfHeight,
      halfHeight,
    )

    if (!clipped) return

    const [startX, startZ, endX, endZ] = clipped

    const distance = Math.hypot(
      endX - startX,
      endZ - startZ,
    )

    // Subdivide long segments to follow the sampled terrain surface.
    const steps = Math.max(
      1,
      Math.ceil(distance / spacingM),
    )

    for (let step = 0; step < steps; step++) {
      const t0 = step / steps
      const t1 = (step + 1) / steps

      const ax = startX + (endX - startX) * t0
      const az = startZ + (endZ - startZ) * t0

      const bx = startX + (endX - startX) * t1
      const bz = startZ + (endZ - startZ) * t1

      const ay = terrainHeight(ax, az)
      const by = terrainHeight(bx, bz)

      if (ay === null || by === null) continue

      positions.push(
        ax, ay, az,
        bx, by, bz,
      )
    }
  }

  function addRing(ring: PSRRing) {
    for (let i = 0; i < ring.length - 1; i++) {
      const first = ring[i]
      const second = ring[i + 1]

      // GeoJSON projected coordinates to local Three.js coordinates.
      const x0 = first[0] - centerX
      const z0 = centerY - first[1]

      const x1 = second[0] - centerX
      const z1 = centerY - second[1]

      addSegment(x0, z0, x1, z1)
    }
  }

  for (const feature of features) {
    const polygons =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates

    for (const polygon of polygons) {
      // Draw the outer PSR boundary.
      const outerRing = polygon[0]

      if (outerRing && outerRing.length >= 2) {
        addRing(outerRing)
      }
    }
  }

  if (positions.length === 0) {
    return group
  }

  const geometry = new THREE.BufferGeometry()

  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  )

  geometry.computeBoundingSphere()

  const material = new THREE.LineBasicMaterial({
    color: 0xff935a,
    transparent: true,
    opacity: 0.95,
    depthTest: true,
    depthWrite: false,
  })

  const boundaries = new THREE.LineSegments(
    geometry,
    material,
  )

  boundaries.name = 'PSR_POLYGON_BOUNDARIES'
  boundaries.renderOrder = 5

  group.add(boundaries)

  return group
}
