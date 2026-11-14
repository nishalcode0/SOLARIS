
import * as THREE from 'three'

export interface LunarLighting {
  ambient: THREE.HemisphereLight
  sunlight: THREE.DirectionalLight
  updateSun: (
    azimuthDeg: number,
    elevationDeg: number,
  ) => void
}

export function createLunarLighting(
  scene: THREE.Scene,
): LunarLighting {
  const ambient = new THREE.HemisphereLight(
    0xdce2ed,
    0x48443e,
    0.28,
  )

  scene.add(ambient)

  const sunlight = new THREE.DirectionalLight(
    0xffedcf,
    2.2,
  )

  sunlight.castShadow = true

  sunlight.shadow.mapSize.set(2048, 2048)
  sunlight.shadow.camera.near = 1
  sunlight.shadow.camera.far = 100_000
  sunlight.shadow.camera.left = -30_000
  sunlight.shadow.camera.right = 30_000
  sunlight.shadow.camera.top = 30_000
  sunlight.shadow.camera.bottom = -30_000
  sunlight.shadow.bias = -0.0001

  scene.add(sunlight)
  scene.add(sunlight.target)

  function updateSun(
    azimuthDeg: number,
    elevationDeg: number,
  ) {
    const azimuth = THREE.MathUtils.degToRad(azimuthDeg)
    const elevation = THREE.MathUtils.degToRad(elevationDeg)

    const horizontal = Math.cos(elevation)

    // Terrain axes:
    // +X = projected east
    // -Z = projected north
    const direction = new THREE.Vector3(
      Math.sin(azimuth) * horizontal,
      Math.sin(elevation),
      -Math.cos(azimuth) * horizontal,
    ).normalize()

    const distance = 40_000

    sunlight.position.copy(
      direction.multiplyScalar(distance),
    )

    sunlight.target.position.set(0, 0, 0)

    // Below-horizon sunlight should not illuminate the surface.
    sunlight.visible = elevationDeg > 0
  }

  updateSun(45, 25)

  return {
    ambient,
    sunlight,
    updateSun,
  }
}
