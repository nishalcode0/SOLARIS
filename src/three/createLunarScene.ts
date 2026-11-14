import * as THREE from 'three'
import { createLunarLighting } from './lunarLighting'
import { createTerrainCamera } from './terrainCamera'

export function createLunarScene(container: HTMLDivElement) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x171b20)

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
  })

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15

  container.appendChild(renderer.domElement)

  const lighting = createLunarLighting(scene)
  const cameraRig = createTerrainCamera(renderer)

  cameraRig.resize(
    container.clientWidth,
    container.clientHeight,
  )

  function render() {
    cameraRig.controls.update()
    renderer.render(scene, cameraRig.camera)
  }

  function resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return

    renderer.setSize(width, height)
    cameraRig.resize(width, height)
  }

  function dispose() {
    cameraRig.dispose()
    renderer.dispose()

    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement)
    }
  }

  return {
    scene,
    renderer,
    lighting,
    cameraRig,
    render,
    resize,
    dispose,
  }
}