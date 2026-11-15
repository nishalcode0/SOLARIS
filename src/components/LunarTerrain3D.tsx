
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import { calculateSolarPosition } from '../lib/lunarIllumination'
import { createTerrainTextures } from '../three/createTerrainTextures'
import {
  loadTerrainPatch,
  type TerrainPatch,
} from '../lib/lolaElevation'
import { createTerrainMesh } from '../three/createTerrainMesh'
import { createLunarScene } from '../three/createLunarScene'

import {
  createPSROverlay,
  type PSRFeature,
} from '../three/createPSROverlay'

interface LunarTerrain3DProps {
  latitude: number
  longitude: number
  simulationTime: Date
  psrFeatures: PSRFeature[]
}

function disposeMaterial(
  material: THREE.Material | THREE.Material[],
) {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose())
  } else {
    material.dispose()
  }
}

function disposePSROverlay(overlay: THREE.Group) {
  overlay.traverse((object) => {
    if (object instanceof THREE.LineSegments) {
      object.geometry.dispose()
      disposeMaterial(object.material)
    }
  })
}

export default function LunarTerrain3D({
  latitude,
  longitude,
  simulationTime,
  psrFeatures,
}: LunarTerrain3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const materialRef =
    useRef<THREE.MeshStandardMaterial | null>(null)

  const texturesRef = useRef<{
    elevation: THREE.DataTexture
    slope: THREE.DataTexture
  } | null>(null)

  const lightingRef =
    useRef<ReturnType<typeof createLunarScene>['lighting'] | null>(
      null,
    )

  const sceneRef = useRef<THREE.Scene | null>(null)
  const terrainPatchRef = useRef<TerrainPatch | null>(null)
  const psrOverlayRef = useRef<THREE.Group | null>(null)

  const simulationTimeRef = useRef(simulationTime)
  simulationTimeRef.current = simulationTime

  const [status, setStatus] = useState(
    'Loading lunar terrain...',
  )

  const [error, setError] = useState<string | null>(null)
  const [slopeEnabled, setSlopeEnabled] = useState(false)
  const [psrContextEnabled, setPsrContextEnabled] =
    useState(false)

  const [terrainReady, setTerrainReady] = useState(false)

  // Initialize the terrain scene when the selected location changes.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let animationFrame = 0

    let lunarScene: ReturnType<typeof createLunarScene> | null =
      null

    let terrain: ReturnType<typeof createTerrainMesh> | null =
      null

    let resizeObserver: ResizeObserver | null = null
    let landingMarker: THREE.Group | null = null

    setTerrainReady(false)
    setError(null)

    async function initialize() {
      try {
        setStatus('Loading NASA LOLA elevation data...')

        lunarScene = createLunarScene(container!)

        sceneRef.current = lunarScene.scene
        lightingRef.current = lunarScene.lighting

        const solar = calculateSolarPosition(
          latitude,
          longitude,
          simulationTimeRef.current,
        )

        lunarScene.lighting.updateSun(
          solar.solarAzimuthDeg,
          solar.solarElevationDeg,
        )

        const animate = () => {
          if (cancelled || !lunarScene) return

          lunarScene.render()
          animationFrame = requestAnimationFrame(animate)
        }

        animate()

        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0]

          if (!entry || !lunarScene) return

          lunarScene.resize(
            entry.contentRect.width,
            entry.contentRect.height,
          )
        })

        resizeObserver.observe(container!)

        const patch = await loadTerrainPatch(
          latitude,
          longitude,
          50_000,
        )

        if (cancelled || !lunarScene) return

        terrainPatchRef.current = patch

        setStatus('Generating 3D lunar terrain...')

        terrain = createTerrainMesh(patch)

        const textures = createTerrainTextures(patch)
        texturesRef.current = textures

        const material = new THREE.MeshStandardMaterial({
          color: 0xb5b0a5,
          map: null,
          roughness: 0.96,
          metalness: 0,
          side: THREE.DoubleSide,
        })

        materialRef.current = material
        terrain.mesh.material = material

        lunarScene.scene.add(terrain.mesh)

        // Create the selected landing-location marker.
        const centerIndex =
          Math.floor(patch.height / 2) * patch.width +
          Math.floor(patch.width / 2)

        const centerElevation = patch.elevations[centerIndex]

        if (Number.isFinite(centerElevation)) {
          landingMarker = new THREE.Group()
          landingMarker.name = 'SELECTED_LANDING_SITE'

          const ringGeometry = new THREE.RingGeometry(
            400,
            480,
            80,
          )

          const ringMaterial = new THREE.MeshBasicMaterial({
            color: 0xff3030,
            side: THREE.DoubleSide,
            depthWrite: false,
          })

          const ring = new THREE.Mesh(
            ringGeometry,
            ringMaterial,
          )

          ring.rotation.x = -Math.PI / 2
          ring.position.y = 25
          ring.renderOrder = 10

          const dotGeometry = new THREE.CircleGeometry(90, 32)

          const dotMaterial = new THREE.MeshBasicMaterial({
            color: 0xff3030,
            side: THREE.DoubleSide,
            depthWrite: false,
          })

          const dot = new THREE.Mesh(
            dotGeometry,
            dotMaterial,
          )

          dot.rotation.x = -Math.PI / 2
          dot.position.y = 27
          dot.renderOrder = 11

          landingMarker.add(ring, dot)

          landingMarker.position.set(
            0,
            centerElevation * 2,
            0,
          )

          lunarScene.scene.add(landingMarker)
        }

        lunarScene.cameraRig.flyToSite()

        setStatus(
          `LOLA TERRAIN READY · ${terrain.validSamples.toLocaleString()} valid samples`,
        )

        setTerrainReady(true)
      } catch (err) {
        if (cancelled) return

        console.error('3D lunar terrain error:', err)

        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load lunar terrain.',
        )

        setStatus('TERRAIN LOAD FAILED')
      }
    }

    initialize()

    return () => {
      cancelled = true

      cancelAnimationFrame(animationFrame)
      resizeObserver?.disconnect()

      if (psrOverlayRef.current) {
        lunarScene?.scene.remove(psrOverlayRef.current)
        disposePSROverlay(psrOverlayRef.current)
        psrOverlayRef.current = null
      }

      if (terrain) {
        terrain.mesh.geometry.dispose()
        disposeMaterial(terrain.mesh.material)
      }

      if (landingMarker) {
        landingMarker.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose()
            disposeMaterial(object.material)
          }
        })

        landingMarker.removeFromParent()
      }

      texturesRef.current?.elevation.dispose()
      texturesRef.current?.slope.dispose()
      texturesRef.current = null

      materialRef.current = null
      lightingRef.current = null
      sceneRef.current = null
      terrainPatchRef.current = null

      lunarScene?.dispose()
    }
  }, [latitude, longitude])

  // Update sunlight when simulation time changes.
  useEffect(() => {
    const lighting = lightingRef.current
    if (!lighting) return

    const solar = calculateSolarPosition(
      latitude,
      longitude,
      simulationTime,
    )

    lighting.updateSun(
      solar.solarAzimuthDeg,
      solar.solarElevationDeg,
    )
  }, [latitude, longitude, simulationTime])

  // Switch between natural lunar grey and slope heatmap.
  useEffect(() => {
    const material = materialRef.current
    const textures = texturesRef.current

    if (!material || !textures) return

    if (slopeEnabled) {
      material.map = textures.slope
      material.color.setHex(0xffffff)
    } else {
      material.map = null
      material.color.setHex(0xb5b0a5)
    }

    material.needsUpdate = true
  }, [slopeEnabled])

  // Display or remove the mapped NASA PSR boundaries.
  useEffect(() => {
    const scene = sceneRef.current
    const patch = terrainPatchRef.current

    if (psrOverlayRef.current) {
      const previous = psrOverlayRef.current

      scene?.remove(previous)
      disposePSROverlay(previous)

      psrOverlayRef.current = null
    }

    if (
      !psrContextEnabled ||
      !terrainReady ||
      !scene ||
      !patch ||
      psrFeatures.length === 0
    ) {
      return
    }

    const overlay = createPSROverlay(
      patch,
      psrFeatures,
    )

    if (overlay.children.length === 0) {
      setStatus(
        'LOLA TERRAIN READY · No mapped PSR boundaries in this patch',
      )
      return
    }

    psrOverlayRef.current = overlay
    scene.add(overlay)

    return () => {
      scene.remove(overlay)
      disposePSROverlay(overlay)

      if (psrOverlayRef.current === overlay) {
        psrOverlayRef.current = null
      }
    }
  }, [
    psrContextEnabled,
    psrFeatures,
    terrainReady,
  ])

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '520px',
        overflow: 'hidden',
        background: '#171b20',
        borderRadius: '12px',
      }}
    >
      {/* Three.js terrain */}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          inset: 0,
        }}
      />

      {/* Terrain information */}
      <div
        style={{
          position: 'absolute',
          left: '18px',
          top: '18px',
          zIndex: 2,
          padding: '10px 14px',
          borderRadius: '8px',
          background: 'rgba(20, 25, 32, 0.85)',
          color: '#e9e5dc',
          fontSize: '12px',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            fontWeight: 700,
            letterSpacing: '1px',
          }}
        >
          SOLARIS · LUNAR TERRAIN
        </div>

        <div
          style={{
            marginTop: '5px',
            color: '#c49b72',
          }}
        >
          50 × 50 KM · 2× VERTICAL EXAGGERATION
        </div>

        <div
          style={{
            marginTop: '5px',
            color: '#b8c2cc',
          }}
        >
          {status}
        </div>

        {error && (
          <div
            style={{
              marginTop: '8px',
              color: '#ff8b75',
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Floating terrain layer controls */}
      <div
        style={{
          position: 'absolute',
          right: '18px',
          top: '18px',
          zIndex: 5,
          width: '190px',
          padding: '14px',
          borderRadius: '10px',
          background: 'rgba(20, 25, 32, 0.92)',
          color: '#e9e5dc',
          border: '1px solid rgba(255,255,255,.12)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '1px',
            marginBottom: '12px',
          }}
        >
          TERRAIN LAYERS
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={slopeEnabled}
            onChange={(event) =>
              setSlopeEnabled(event.target.checked)
            }
          />
          Slope heatmap
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            marginTop: '12px',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={psrContextEnabled}
            onChange={(event) =>
              setPsrContextEnabled(event.target.checked)
            }
          />
          Mapped PSR context
        </label>

        {psrContextEnabled && (
          <div
            style={{
              marginTop: '12px',
              padding: '9px',
              borderRadius: '6px',
              background: 'rgba(255,147,90,0.12)',
              color: '#ffb17f',
              fontSize: '10px',
              lineHeight: 1.5,
            }}
          >
            NASA MAPPED PSR BOUNDARIES
            <br />
            Orange outlines show mapped permanently shadowed
            regions intersecting this terrain patch.
            <br />
            <br />
            Context only. Not direct water-ice detection.
          </div>
        )}
      </div>
    </div>
  )
}
