
import * as THREE from 'three'
import type { TerrainPatch } from '../lib/lolaElevation'

export interface TerrainTextures {
  elevation: THREE.DataTexture
  slope: THREE.DataTexture
}

function makeTexture(
  data: Uint8Array,
  width: number,
  height: number,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
  )

  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true

  return texture
}

export function createTerrainTextures(
  patch: TerrainPatch,
): TerrainTextures {
  const { width, height, spacingM, elevations } = patch

  const elevationData = new Uint8Array(width * height * 4)
  const slopeData = new Uint8Array(width * height * 4)

  let min = Infinity
  let max = -Infinity

  for (const value of elevations) {
    if (!Number.isFinite(value)) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('No valid elevation samples in terrain patch.')
  }

  const elevationStops = [
    { value: 0, color: [38, 73, 91] },
    { value: 0.25, color: [66, 119, 126] },
    { value: 0.5, color: [166, 157, 112] },
    { value: 0.75, color: [198, 126, 77] },
    { value: 1, color: [235, 211, 164] },
  ]

  function elevationColor(t: number): number[] {
    for (let i = 1; i < elevationStops.length; i++) {
      const a = elevationStops[i - 1]
      const b = elevationStops[i]

      if (t <= b.value) {
        const f = (t - a.value) / (b.value - a.value)

        return a.color.map((channel, index) =>
          Math.round(channel + (b.color[index] - channel) * f),
        )
      }
    }

    return elevationStops[elevationStops.length - 1].color
  }

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const index = row * width + col
      const offset = index * 4
      const elevation = elevations[index]

      if (!Number.isFinite(elevation)) {
        elevationData[offset + 3] = 0
        slopeData[offset + 3] = 0
        continue
      }

      const t = max === min ? 0.5 : (elevation - min) / (max - min)
      const color = elevationColor(t)

      elevationData[offset] = color[0]
      elevationData[offset + 1] = color[1]
      elevationData[offset + 2] = color[2]
      elevationData[offset + 3] = 255

      if (
        row === 0 ||
        col === 0 ||
        row === height - 1 ||
        col === width - 1
      ) {
        slopeData[offset + 3] = 0
        continue
      }

      const z1 = elevations[(row - 1) * width + col - 1]
      const z2 = elevations[(row - 1) * width + col]
      const z3 = elevations[(row - 1) * width + col + 1]
      const z4 = elevations[row * width + col - 1]
      const z6 = elevations[row * width + col + 1]
      const z7 = elevations[(row + 1) * width + col - 1]
      const z8 = elevations[(row + 1) * width + col]
      const z9 = elevations[(row + 1) * width + col + 1]

      const neighbors = [z1, z2, z3, z4, z6, z7, z8, z9]

      if (!neighbors.every(Number.isFinite)) {
        slopeData[offset + 3] = 0
        continue
      }

      const dzdx =
        (z3 + 2 * z6 + z9 - z1 - 2 * z4 - z7) /
        (8 * spacingM)

      const dzdy =
        (z7 + 2 * z8 + z9 - z1 - 2 * z2 - z3) /
        (8 * spacingM)

      const slope = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI)

      let slopeColor: number[]

      if (slope < 5) slopeColor = [65, 160, 145]
      else if (slope < 10) slopeColor = [204, 175, 91]
      else if (slope < 15) slopeColor = [222, 126, 70]
      else slopeColor = [190, 70, 65]

      slopeData[offset] = slopeColor[0]
      slopeData[offset + 1] = slopeColor[1]
      slopeData[offset + 2] = slopeColor[2]
      slopeData[offset + 3] = 255
    }
  }

  return {
    elevation: makeTexture(elevationData, width, height),
    slope: makeTexture(slopeData, width, height),
  }
}
