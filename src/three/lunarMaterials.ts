
import * as THREE from 'three'

export type LunarSurfaceMode =
  | 'scientific'
  | 'realistic'
  | 'elevation'
  | 'slope'

const LUNAR_GREY = 0xb5b0a5

export function createLunarMaterial(
  mode: LunarSurfaceMode = 'scientific',
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: LUNAR_GREY,
    roughness: 0.96,
    metalness: 0,
  })

  switch (mode) {
    case 'scientific':
      // Neutral LOLA-derived terrain appearance.
      material.color.setHex(0xb5b0a5)
      break

    case 'realistic':
      // Subtle regolith-like appearance.
      // This is visual styling, not additional measured terrain data.
      material.color.setHex(0xaaa49a)
      break

    case 'elevation':
      // Placeholder until the aligned elevation texture is added.
      material.color.setHex(0x9caeb0)
      break

    case 'slope':
      // Placeholder until the aligned slope texture is added.
      material.color.setHex(0xc49b72)
      break
  }

  return material
}
