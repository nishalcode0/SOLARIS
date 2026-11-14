
import * as THREE from 'three'
import type { TerrainPatch } from '../lib/lolaElevation'

const VERTICAL_EXAGGERATION = 2

export interface TerrainMeshResult {
  mesh: THREE.Mesh
  validSamples: number
  missingSamples: number
  minElevationM: number
  maxElevationM: number
}

export function createTerrainMesh(
  patch: TerrainPatch,
): TerrainMeshResult {
  const { width, height, spacingM, elevations } = patch

  if (
    width < 2 ||
    height < 2 ||
    elevations.length !== width * height
  ) {
    throw new Error('Invalid terrain patch dimensions.')
  }

  const geometry = new THREE.BufferGeometry()

  const positions = new Float32Array(width * height * 3)
  const uvs = new Float32Array(width * height * 2)

  let validSamples = 0
  let missingSamples = 0
  let minElevationM = Infinity
  let maxElevationM = -Infinity

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column
      const elevation = elevations[index]

      const x = (column - (width - 1) / 2) * spacingM
      const z = (row - (height - 1) / 2) * spacingM

      const valid = Number.isFinite(elevation)

      positions[index * 3] = x
      positions[index * 3 + 1] = valid
        ? elevation * VERTICAL_EXAGGERATION
        : 0
      positions[index * 3 + 2] = z

      uvs[index * 2] = column / (width - 1)
      uvs[index * 2 + 1] = row / (height - 1)

      if (valid) {
        validSamples++
        minElevationM = Math.min(minElevationM, elevation)
        maxElevationM = Math.max(maxElevationM, elevation)
      } else {
        missingSamples++
      }
    }
  }

  const indices: number[] = []

  for (let row = 0; row < height - 1; row++) {
    for (let column = 0; column < width - 1; column++) {
      const a = row * width + column
      const b = a + 1
      const c = a + width
      const d = c + 1

      // Do not construct triangles across missing DEM samples.
      if (
        Number.isFinite(elevations[a]) &&
        Number.isFinite(elevations[b]) &&
        Number.isFinite(elevations[c]) &&
        Number.isFinite(elevations[d])
      ) {
        indices.push(a, c, b)
        indices.push(b, c, d)
      }
    }
  }

  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3),
  )

  geometry.setAttribute(
    'uv',
    new THREE.BufferAttribute(uvs, 2),
  )

  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  const material = new THREE.MeshStandardMaterial({
    color: 0xb5b0a5,
    roughness: 0.96,
    metalness: 0,
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(geometry, material)

  mesh.name = 'LOLA_SOUTH_POLAR_TERRAIN'
  mesh.receiveShadow = true
  mesh.castShadow = true

  mesh.userData = {
    source: patch.source,
    spacingM,
    verticalExaggeration: VERTICAL_EXAGGERATION,
    patchSizeM: patch.patchSizeM,
  }

  return {
    mesh,
    validSamples,
    missingSamples,
    minElevationM:
      validSamples > 0 ? minElevationM : NaN,
    maxElevationM:
      validSamples > 0 ? maxElevationM : NaN,
  }
}
