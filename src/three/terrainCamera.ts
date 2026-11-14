
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export interface TerrainCamera {
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  flyToSite: () => void
  resize: (width: number, height: number) => void
  dispose: () => void
}

export function createTerrainCamera(
  renderer: THREE.WebGLRenderer,
): TerrainCamera {
  const camera = new THREE.PerspectiveCamera(
    45,
    1,
    1,
    300_000,
  )

  camera.position.set(0, 32_000, 42_000)

  const controls = new OrbitControls(
    camera,
    renderer.domElement,
  )

  controls.enableDamping = true
  controls.dampingFactor = 0.05

  controls.enablePan = true
  controls.screenSpacePanning = false

  controls.minDistance = 1_000
  controls.maxDistance = 120_000

  controls.minPolarAngle = THREE.MathUtils.degToRad(5)
  controls.maxPolarAngle = THREE.MathUtils.degToRad(85)

  controls.target.set(0, 0, 0)
  controls.update()

  function flyToSite() {
    const target = new THREE.Vector3(0, 0, 0)

    controls.target.copy(target)

    camera.position.set(
      target.x,
      30_000,
      32_000,
    )

    controls.update()
  }

  function resize(width: number, height: number) {
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  function dispose() {
    controls.dispose()
  }

  return {
    camera,
    controls,
    flyToSite,
    resize,
    dispose,
  }
}
