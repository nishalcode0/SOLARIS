
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  calculateEarthVisibility,
  type EarthVisibilityAnalysis,
} from './lib/lunarCommunications'

import {
  analyzeLunarIllumination,
  calculateSolarPosition,
  type LunarIlluminationAnalysis,
} from './lib/lunarIllumination'


import {
  sampleElevation,
  sampleSlope,
  sampleTerrainHorizon,
  type ElevationSample,
  type SlopeSample,
  type TerrainHorizonProfile,
} from './lib/lolaElevation'

import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
} from 'react'

import {
  Crosshair,
  Database,
  Layers3, 
  Maximize2,
  Minus,
  Move3D,
  Plus,
  RotateCcw,
  Satellite,
  X,
  Map as MapIcon,
} from 'lucide-react'

// --------------------------------------------------
// TYPES
// --------------------------------------------------

type Site = {
  id: string
  name: string
  code: string
  latitude: number
  longitude: number
  terrain: string
  description: string
  source: string
}

type Point = {
  latitude: number
  longitude: number
}

type Selection = Site | Point

// --------------------------------------------------
// REFERENCE LOCATIONS
// Named-feature reference coordinates,
// NOT surveyed landing ellipses.
// --------------------------------------------------

const SITES: Site[] = [
  {
    id: 'shackleton',
    name: 'Shackleton Rim',
    code: 'SITE 04 / R04',
    latitude: -89.7668,
    longitude: -171.87,
    terrain: 'Crater rim',
    description:
      'NASA Lunar Surface Data Book reference coordinate. This is a named-feature reference point, not a surveyed landing ellipse.',
    source: 'NASA Lunar Surface Data Book, Table A2-2',
  },
  {
    id: 'connecting',
    name: 'Connecting Ridge',
    code: 'SITE 01 / R01',
    latitude: -89.4632,
    longitude: -137.49,
    terrain: 'Ridge',
    description:
      'NASA Lunar Surface Data Book reference coordinate. This is a named-feature reference point, not a surveyed landing ellipse.',
    source: 'NASA Lunar Surface Data Book, Table A2-2',
  },
  {
    id: 'malapert',
    name: 'Malapert Massif',
    code: 'SITE 23 / R23',
    latitude: -85.9948,
    longitude: -0.23578,
    terrain: 'Massif',
    description:
      'NASA Lunar Surface Data Book reference coordinate. Local terrain analysis has not yet been integrated.',
    source: 'NASA Lunar Surface Data Book, Table A2-2',
  },
]

// --------------------------------------------------
// MAP PROJECTION
// South Polar Stereographic
// --------------------------------------------------

const MOON_RADIUS_M = 1_737_400

// Existing NASA raster coverage: 80°S–90°S.
const DATA_RADIUS_M = 304_000

// Approximate projection radius at 70°S.
// This is viewport geometry, not terrain coverage.
const VIEW_RADIUS_M = 622_000

// Map navigation settings.
const DEFAULT_ZOOM = 1.95
const MIN_ZOOM = 0.75
const MAX_ZOOM = 5

function projectedRadius(latitude: number): number {
  const lat = (latitude * Math.PI) / 180

  return (
    2 *
    MOON_RADIUS_M *
    Math.tan(Math.PI / 4 + lat / 2)
  )
}

function project(latitude: number, longitude: number) {
  const lon = (longitude * Math.PI) / 180
  const rho = projectedRadius(latitude)

  return {
    left: `${
      50 +
      (rho * Math.sin(lon) / (2 * VIEW_RADIUS_M)) * 100
    }%`,

    top: `${
      50 -
      (rho * Math.cos(lon) / (2 * VIEW_RADIUS_M)) * 100
    }%`,
  }
}

function inverseProject(
  xPercent: number,
  yPercent: number,
): Point {
  const x =
    (xPercent / 100 - 0.5) *
    2 *
    VIEW_RADIUS_M

  const y =
    (0.5 - yPercent / 100) *
    2 *
    VIEW_RADIUS_M

  const rho = Math.hypot(x, y)

  const latitude =
    (
      2 *
      Math.atan(rho / (2 * MOON_RADIUS_M)) -
      Math.PI / 2
    ) *
    180 /
    Math.PI

  const longitude =
    (Math.atan2(x, y) * 180) / Math.PI

 

  return {
    latitude,
    longitude,
  }
}

function fmtLat(value: number): string {
  return `${Math.abs(value).toFixed(4)}° ${
    value < 0 ? 'S' : 'N'
  }`
}

function fmtLon(value: number): string {
  const signed =
    value > 180 ? value - 360 : value

  return `${Math.abs(signed).toFixed(4)}° ${
    signed < 0 ? 'W' : 'E'
  }`
}

function insideView(point: Point): boolean {
  return (
    point.latitude >= -90 &&
    point.latitude <= -70
  )
}

function isSite(selection: Selection): selection is Site {
  return 'id' in selection
}

// --------------------------------------------------
// MAIN APPLICATION
// --------------------------------------------------

export default function App() {
  // Location workflow:
  // pendingSite = temporary popup selection
  // selectedSite = confirmed inspection selection

  const [pendingSite, setPendingSite] =
    useState<Selection | null>(null)

  const [selectedSite, setSelectedSite] =
    useState<Selection | null>(null)

  // Map navigation.
  // No pan state: the South Pole remains centred.

  const [zoom, setZoom] = useState(DEFAULT_ZOOM)

  const [hillshadeOn, setHillshadeOn] =
    useState(true)

  const [slopeHeatmapOn, setSlopeHeatmapOn] =
    useState(false)  

  const [illuminationHeatmapOn, setIlluminationHeatmapOn] = 
    useState(false)

  const [gridOn, setGridOn] =
    useState(true)

  const [sitesOn, setSitesOn] =
    useState(true)

  const [mapReady, setMapReady] =
    useState(false)

  const [mapMissing, setMapMissing] =
    useState(false)

  const [expanded, setExpanded] =
    useState(false)

  const [cursor, setCursor] =
    useState<Point | null>(null)

  const [elevationSample, setElevationSample] =
    useState<ElevationSample | null>(null)

  const [elevationLoading, setElevationLoading] =
    useState(false)

  const [elevationError, setElevationError] =
    useState<string | null>(null)

  const [slopeSample, setSlopeSample] = useState<SlopeSample | null>(null)
  const [slopeLoading, setSlopeLoading] = useState(false)
  const [slopeError, setSlopeError] = useState<string | null>(null)

  const [illuminationAnalysis, setIlluminationAnalysis] =
    useState<LunarIlluminationAnalysis | null>(null)

  const [illuminationLoading, setIlluminationLoading] =
    useState(false)

  const [illuminationError, setIlluminationError] =
    useState<string | null>(null)

  const [simulationTime, setSimulationTime] =
    useState(() => new Date())

  const [terrainHorizon, setTerrainHorizon] =
    useState<TerrainHorizonProfile | null>(null)

  const [horizonLoading, setHorizonLoading] =
    useState(false)

  const [horizonError, setHorizonError] =
    useState<string | null>(null)

  const [communicationsAnalysis, setCommunicationsAnalysis] =
    useState<EarthVisibilityAnalysis | null>(null)

  const [communicationsLoading, setCommunicationsLoading] =
    useState(false)

  const [communicationsError, setCommunicationsError] =
    useState<string | null>(null)

  // Refs

  const viewportRef =
    useRef<HTMLDivElement>(null)

  const mapRef =
    useRef<HTMLDivElement>(null)

  // ------------------------------------------------
  // DERIVED DATA
  // ------------------------------------------------

  const pendingPoint = useMemo(() => {
    if (!pendingSite) return null

    return {
      latitude: pendingSite.latitude,
      longitude: pendingSite.longitude,
    }
  }, [pendingSite])

  const selectedPoint = useMemo(() => {
    if (!selectedSite) return null

    return {
      latitude: selectedSite.latitude,
      longitude: selectedSite.longitude,
    }
  }, [selectedSite])

 const simulationTimeInput = useMemo(() => {
  const localTime = new Date(
    simulationTime.getTime() -
    simulationTime.getTimezoneOffset() * 60000,
  )

  return localTime.toISOString().slice(0, 16)
}, [simulationTime])

const liveSolarPosition = useMemo(() => {
  if (!selectedSite) return null

  return calculateSolarPosition(
    selectedSite.latitude,
    selectedSite.longitude,
    simulationTime,
  )
}, [selectedSite, simulationTime])

  // --------------------------------------------------
// NASA LOLA ELEVATION SAMPLING
// --------------------------------------------------

// --------------------------------------------------
// UNIFIED LOCATION ANALYSIS PIPELINE
// --------------------------------------------------
  // --------------------------------------------------
// UNIFIED LOCATION ANALYSIS PIPELINE
// --------------------------------------------------

useEffect(() => {
  if (!selectedSite) {
    setElevationSample(null)
    setElevationError(null)
    setElevationLoading(false)

    setSlopeSample(null)
    setSlopeError(null)
    setSlopeLoading(false)

    setTerrainHorizon(null)
    setHorizonError(null)
    setHorizonLoading(false)

    setIlluminationAnalysis(null)
    setIlluminationError(null)
    setIlluminationLoading(false)

    setCommunicationsAnalysis(null)
    setCommunicationsError(null)
    setCommunicationsLoading(false)

    return
  }

  const latitude = selectedSite.latitude
  const longitude = selectedSite.longitude

  console.log('SOLARIS COMMUNICATIONS INPUT:', {
  latitude,
  longitude,
  latitudeType: typeof latitude,
  longitudeType: typeof longitude,
  latitudeFinite: Number.isFinite(latitude),
  longitudeFinite: Number.isFinite(longitude),
})

  let active = true

  // Reset previous location's results.
  setElevationSample(null)
  setElevationError(null)
  setElevationLoading(true)

  setSlopeSample(null)
  setSlopeError(null)
  setSlopeLoading(true)

  setTerrainHorizon(null)
  setHorizonError(null)
  setHorizonLoading(true)

  setIlluminationAnalysis(null)
  setIlluminationError(null)
  setIlluminationLoading(true)

  async function runLocationAnalysis() {
    const results = await Promise.allSettled([
      sampleElevation(latitude, longitude),

      sampleSlope(latitude, longitude),

      sampleTerrainHorizon(latitude, longitude),

      Promise.resolve().then(() =>
        analyzeLunarIllumination(
          latitude,
          longitude,
          simulationTime,
        ),
      ),
    ])

    if (!active) return

    // 1. NASA LOLA elevation
    const elevationResult = results[0]

    if (elevationResult.status === 'fulfilled') {
      setElevationSample(elevationResult.value)
    } else {
      console.error(
        'NASA LOLA elevation failed:',
        elevationResult.reason,
      )

      setElevationError(
        elevationResult.reason instanceof Error
          ? elevationResult.reason.message
          : 'Unknown elevation sampling error',
      )
    }

    setElevationLoading(false)

    // 2. NASA LOLA slope
    const slopeResult = results[1]

    if (slopeResult.status === 'fulfilled') {
      setSlopeSample(slopeResult.value)
    } else {
      console.error(
        'NASA LOLA slope analysis failed:',
        slopeResult.reason,
      )

      setSlopeError(
        slopeResult.reason instanceof Error
          ? slopeResult.reason.message
          : 'Unknown slope analysis error',
      )
    }

    setSlopeLoading(false)

    // 3. DEM terrain horizon
const horizonResult = results[2]

if (horizonResult.status === 'fulfilled') {
  const horizonProfile = horizonResult.value

  setTerrainHorizon(horizonProfile)

  // 4. Earth line-of-sight analysis
  try {
    const communications =
      calculateEarthVisibility(
        latitude,
        longitude,
        horizonProfile,
        new Date(),
      )

    setCommunicationsAnalysis(communications)
  } catch (error) {
    console.error(
      'Earth visibility calculation failed:',
      error,
    )

    setCommunicationsError(
      error instanceof Error
        ? error.message
        : 'Unknown communications calculation error',
    )
  }
} else {
  console.error(
    'NASA LOLA horizon analysis failed:',
    horizonResult.reason,
  )

  setHorizonError(
    horizonResult.reason instanceof Error
      ? horizonResult.reason.message
      : 'Unknown terrain horizon error',
  )

  setCommunicationsError(
    'Earth visibility unavailable because terrain horizon data could not be calculated.',
  )
}

setHorizonLoading(false)
setCommunicationsLoading(false)

    
  }

  runLocationAnalysis().catch((error: unknown) => {
    if (!active) return

    console.error(
      'Location analysis pipeline failed:',
      error,
    )

    setElevationError('Location analysis failed')
    setSlopeError('Location analysis failed')
    setHorizonError('Location analysis failed')
    setIlluminationError('Location analysis failed')
    setCommunicationsError('Location analysis failed')

    setElevationLoading(false)
    setSlopeLoading(false)
    setHorizonLoading(false)
    setIlluminationLoading(false)
    setCommunicationsLoading(false)
  })

  return () => {
    active = false
  }
}, [selectedSite])
// TIME-DEPENDENT LUNAR ILLUMINATION
useEffect(() => {
  if (!selectedSite) {
    setIlluminationAnalysis(null)
    setIlluminationError(null)
    setIlluminationLoading(false)
    return
  }

  let active = true

  setIlluminationLoading(true)
  setIlluminationError(null)

  Promise.resolve()
    .then(() =>
      analyzeLunarIllumination(
        selectedSite.latitude,
        selectedSite.longitude,
        simulationTime,
      ),
    )
    .then((analysis) => {
  if (!active) return

  console.log('SOLAR ILLUMINATION DIAGNOSTIC', {
    latitude: selectedSite.latitude,
    longitude: selectedSite.longitude,
    start: analysis.startTime,
    end: analysis.endTime,
    illuminatedHours: analysis.illuminatedHours,
    shadowHours: analysis.shadowHours,
    minimumElevation: analysis.minSolarElevationDeg,
    maximumElevation: analysis.maxSolarElevationDeg,
    samplesBelowHorizon: analysis.samples.filter(
      (sample) => sample.solarElevationDeg < 0,
    ).length,
  })

  console.table(
    analysis.samples.map((sample) => ({
      time: sample.timestamp,
      elevation: sample.solarElevationDeg.toFixed(3),
      sunlit: sample.geometricallySunlit,
    })),
  )

  setIlluminationAnalysis(analysis)
})
    .catch((error: unknown) => {
      if (!active) return

      console.error('Lunar illumination calculation failed:', error)

      setIlluminationError(
        error instanceof Error
          ? error.message
          : 'Unknown illumination calculation error',
      )
    })
    .finally(() => {
      if (active) setIlluminationLoading(false)
    })

  return () => {
    active = false
  }
}, [selectedSite, simulationTime])

  // ------------------------------------------------
  // FULLSCREEN
  // ------------------------------------------------

 

  async function toggleFullscreen() {
    const element = viewportRef.current

    if (!element) return

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await element.requestFullscreen()
      }
    } catch (error) {
      console.error(
        'Fullscreen unavailable:',
        error,
      )
    }
  }

  // ------------------------------------------------
  // SITE SELECTION
  // ------------------------------------------------

  function openCandidate(site: Site) {
    setPendingSite(site)
    setSelectedSite(null)
  }

  function landHere() {
    if (!pendingSite) return

    setSelectedSite(pendingSite)
    setPendingSite(null)
    setExpanded(false)
  }

  function closeInspection() {
    setSelectedSite(null)
    setExpanded(false)
  }
  
  // ------------------------------------------------
  // MAP INTERACTION
  // Fixed South Pole. No dragging or panning.
  // Coordinates are calculated against the unscaled
  // map dimensions and current zoom.
  // ------------------------------------------------

  function screenToMapPoint(
    clientX: number,
    clientY: number,
  ): Point | null {
    const viewport = viewportRef.current
    const map = mapRef.current

    if (!viewport || !map) return null

    const rect = viewport.getBoundingClientRect()
    const mapSize = map.offsetWidth

    if (!mapSize || !zoom) return null

    // The map is centred inside the viewport.
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    // Undo the fixed-centre zoom mathematically.
    const xPercent =
      50 +
      ((clientX - centerX) / (mapSize * zoom)) * 100

    const yPercent =
      50 +
      ((clientY - centerY) / (mapSize * zoom)) * 100

    if (
      xPercent < 0 ||
      xPercent > 100 ||
      yPercent < 0 ||
      yPercent > 100
    ) {
      return null
    }

    const point = inverseProject(xPercent, yPercent)

    return insideView(point) ? point : null
  }

  function handleMapClick(
    event: ReactMouseEvent<HTMLDivElement>,
  ) {
    const target = event.target as HTMLElement

    // Candidate markers and controls have their own actions.
    if (target.closest('button')) return

    const point = screenToMapPoint(
      event.clientX,
      event.clientY,
    )

    if (!point) return

    setPendingSite(point)
    setSelectedSite(null)
  }

  function handlePointerMove(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    const point = screenToMapPoint(
      event.clientX,
      event.clientY,
    )

    setCursor(point)
  }

  function zoomBy(factor: number) {
    setZoom((current) =>
      Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, current * factor),
      ),
    )
  }

  function resetView() {
    setZoom(DEFAULT_ZOOM)
    setCursor(null)
    setPendingSite(null)
  }


  // ------------------------------------------------
  // RENDER
  // ------------------------------------------------

  return (
    <main className="selene-app">

      {/* ==========================================
          HEADER
      ========================================== */}

      <header className="topbar">

        <div className="brand">

          <div className="brand-mark">
            <Satellite size={19} />
          </div>

          <div>
            <div className="brand-name">
              SOLARIS
            </div>

            <div className="brand-caption">
              LUNAR SOUTH POLE NAVIGATION SYSTEM
            </div>
          </div>

        </div>

        <div className="top-center">
          <span className="live-square" />

          MISSION PLANNING WORKSTATION

          <span className="top-divider">/</span>

          SOLARIS BUILD
        </div>

        <div className="top-right">
          <span>MOON · LUNA</span>

          <span className="top-separator" />

          <span>70°S — 90°S</span>
        </div>

      </header>

      {/* ==========================================
          MAP WORKSPACE
      ========================================== */}

      <section className="map-workspace">

        <div
          className="map-viewport"
          ref={viewportRef}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setCursor(null)}
          onClick={handleMapClick}
          onWheel={(event) => {
            event.preventDefault()

            zoomBy(
              event.deltaY < 0
                ? 1.12
                : 1 / 1.12,
            )
          }}
        >

          <div className="map-background-grid" />

          {/* MAP CONTENT
              Transform origin is fixed at the centre.
              No translation or pan is permitted.
          */}

          <div
            className="map-content"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          >

            <div
              className="polar-map"
              ref={mapRef}
              style={{
                '--inverse-zoom': 1 / zoom,
              } as CSSProperties}
            >

              {/* NASA HILLSHADE RASTER */}

              {hillshadeOn && !mapMissing && (
                <img
                  className="hillshade-raster"
                  src="/data/lola-south-pole-hillshade.png?v=2"
                  alt="NASA LOLA south polar hillshade, 80 degrees south to the pole"
                  onLoad={() => setMapReady(true)}
                  onError={() => setMapMissing(true)}
                  draggable={false}
                />
              )}

              {hillshadeOn && mapMissing && (
                <div className="raster-error">
                  NASA LOLA HILLSHADE FILE UNAVAILABLE
                </div>
              )}

              {/* NASA LOLA SLOPE HEATMAP */}

{slopeHeatmapOn && (
  <img
    className="slope-heatmap-raster"
    src="/data/lola-south-pole-slope.png"
    alt="NASA LOLA derived south polar terrain slope heatmap"
    draggable={false}
  />
)}
{illuminationHeatmapOn && (
  <img
    className="illumination-heatmap-raster"
    src="/data/lola-south-pole-illumination.png"
    alt="Estimated lunar terrain illumination and shadow heatmap"
    draggable={false}
  />
)}

  {slopeHeatmapOn && (
  <div className="slope-map-legend">
    <div className="slope-legend-header">
      <strong>TERRAIN SLOPE</strong>
      <span>DEGREES</span>
    </div>

    <div className="slope-legend-item">
      <i className="slope-legend-color slope-low" />
      <span>0° – 5°</span>
      <small>Gentle</small>
    </div>

    <div className="slope-legend-item">
      <i className="slope-legend-color slope-moderate" />
      <span>5° – 10°</span>
      <small>Moderate</small>
    </div>

    <div className="slope-legend-item">
      <i className="slope-legend-color slope-steep" />
      <span>10° – 15°</span>
      <small>Steep</small>
    </div>

    <div className="slope-legend-item">
      <i className="slope-legend-color slope-extreme" />
      <span>15°+</span>
      <small>Very steep</small>
    </div>

    <p>NASA LOLA · 80 m source DEM</p>
  </div>
)}

              {/* COORDINATE GRID */}

              {gridOn && (
                <svg
                  className="map-grid-svg"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >

                  {[70, 75, 80, 85, 88].map(
                    (latitude) => {
                      const radius =
                        (projectedRadius(-latitude) /
                          (2 * VIEW_RADIUS_M)) *
                        100

                      return (
                        <g key={latitude}>

                          <circle
                            cx="50"
                            cy="50"
                            r={radius}
                            className={
                              latitude === 80
                                ? 'coverage-ring'
                                : 'latitude-ring'
                            }
                          />

                          <text
                            x={50 + radius * 0.72 + 1.2}
                            y={50 - radius * 0.69}
                            dominantBaseline="middle"
                            className="map-label"
                          >
                            {latitude}°S
                          </text>

                        </g>
                      )
                    },
                  )}

                  {[0, 90, 180, 270].map(
                    (angle) => {
                      const radians =
                        (angle * Math.PI) / 180

                      return (
                        <line
                          key={angle}
                          x1="50"
                          y1="50"
                          x2={
                            50 +
                            50 * Math.sin(radians)
                          }
                          y2={
                            50 -
                            50 * Math.cos(radians)
                          }
                          className="longitude-line"
                        />
                      )
                    },
                  )}

                  {/* FIXED SOUTH POLE */}

                  <circle
                    cx="50"
                    cy="50"
                    r="0.65"
                    className="pole-dot"
                  />

                  <text
                    x="52"
                    y="49"
                    className="map-label pole-text"
                  >
                    90°S · SOUTH POLE
                  </text>

                  {/* LONGITUDE LABELS */}

                  <text
                    x="50"
                    y="2.5"
                    textAnchor="middle"
                    className="map-label"
                  >
                    0°
                  </text>

                  <text
                    x="97"
                    y="51"
                    textAnchor="end"
                    className="map-label"
                  >
                    90°E
                  </text>

                  <text
                    x="50"
                    y="98"
                    textAnchor="middle"
                    className="map-label"
                  >
                    180°
                  </text>

                  <text
                    x="3"
                    y="51"
                    className="map-label"
                  >
                    90°W
                  </text>

                </svg>
              )}

              {/* REFERENCE FEATURE MARKERS */}

              {sitesOn &&
                SITES.map((site) => (
                  <button
                    key={site.id}
                    className={`candidate-pin candidate-pin-${site.id}`}
                    style={project(
                      site.latitude,
                      site.longitude,
                    )}
                    onClick={() =>
                      openCandidate(site)
                    }
                    title={site.name}
                    aria-label={`Inspect ${site.name}`}
                  >
                    <i />
                    <span>{site.name}</span>
                  </button>
                ))}

              {/* TEMPORARY LOCATION MARKER */}

              {pendingPoint && (
                <div
                  className="pending-marker"
                  style={project(
                    pendingPoint.latitude,
                    pendingPoint.longitude,
                  )}
                >
                  <i />
                </div>
              )}

              {/* CONFIRMED LOCATION MARKER */}

              {selectedPoint && (
                <div
                  className="committed-marker"
                  style={project(
                    selectedPoint.latitude,
                    selectedPoint.longitude,
                  )}
                >
                  <i />
                </div>
              )}

            </div>

          </div>

          {/* MAP INFORMATION LABELS */}

          <div className="map-top-left">

            <div className="eyebrow">
              ACTIVE REGION
            </div>

            <strong>
              LUNAR SOUTH POLAR REGION
            </strong>

            <small>
              POLAR STEREOGRAPHIC · 70°S–90°S
            </small>

          </div>

          <div className="map-top-right">

            <div className="eyebrow">
              BASE TERRAIN COVERAGE
            </div>

            <strong>80°S–90°S</strong>

            <small>
              {mapReady
                ? 'NASA LOLA HILLSHADE LOADED'
                : 'LOLA RASTER STATUS CHECK'}
            </small>

          </div>

          <div className="map-bottom-left">

            <div className="eyebrow">
              {cursor
                ? 'CURSOR POSITION'
                : 'MAP REFERENCE'}
            </div>

            <strong>
              {cursor
                ? `${fmtLat(cursor.latitude)} / ${fmtLon(cursor.longitude)}`
                : 'MOVE CURSOR OVER MAP'}
            </strong>

            <small>
              CLICK TO SELECT A LOCATION
            </small>

          </div>

          {/* MAP CONTROLS */}

          <div className="map-controls">

            <button
              title="Zoom in"
              onClick={() => zoomBy(1.25)}
            >
              <Plus size={17} />
            </button>

            <button
              title="Zoom out"
              onClick={() => zoomBy(0.8)}
            >
              <Minus size={17} />
            </button>

            <button
              title="Reset map to default South Pole view"
              onClick={resetView}
            >
              <RotateCcw size={16} />
            </button>

            <button
              title="Fullscreen"
              onClick={toggleFullscreen}
            >
              <Maximize2 size={16} />
            </button>

          </div>

          <div className="zoom-label">
            {Math.round(zoom * 100)}%
          </div>

          <div className="map-help">
            <Crosshair size={13} />
            SOUTH POLE FIXED
            <span>·</span>
            SCROLL TO ZOOM
          </div>

          {/* ======================================
              LOCATION SELECTION POPUP
          ====================================== */}

          {pendingSite && pendingPoint && (
            <div
              className="selection-card"
              onPointerDown={(event) =>
                event.stopPropagation()
              }
              onClick={(event) =>
                event.stopPropagation()
              }
            >

              <button
                className="popup-close"
                aria-label="Dismiss selection"
                onClick={() => setPendingSite(null)}
              >
                <X size={15} />
              </button>

              <div className="eyebrow">
                LOCATION SELECTED
              </div>

              <h2>
                {isSite(pendingSite)
                  ? pendingSite.name
                  : 'Uncatalogued location'}
              </h2>

              <div className="popup-coords">
                {fmtLat(pendingPoint.latitude)}
                <br />
                {fmtLon(pendingPoint.longitude)}
              </div>

              <p>
                {isSite(pendingSite)
                  ? pendingSite.description
                  : 'Selected map coordinate. Terrain and mission suitability have not yet been evaluated.'}
              </p>

              <div className="coverage-note">
                {projectedRadius(
                  pendingPoint.latitude,
                ) <= DATA_RADIUS_M
                  ? 'LOLA HILLSHADE COVERAGE'
                  : 'OUTSIDE CURRENT LOLA RASTER COVERAGE'}
              </div>

              <button
                className="land-button"
                onClick={landHere}
              >
                LAND HERE
                <span>→</span>
              </button>

              <small className="land-disclaimer">
                INSPECT CANDIDATE · NOT A LANDING APPROVAL
              </small>

            </div>
          )}

        </div>

        {/* ========================================
            LEFT MAP SIDEBAR
        ======================================== */}

        <aside className="left-rail">

          {/* LAYERS */}

          <div className="rail-section">

            <div className="rail-title">
              <span>MAP LAYERS</span>
              <Layers3 size={16} />
            </div>

            <label className="layer-row">

              <span>
                <i className="layer-swatch hill" />
                LOLA hillshade
              </span>

              <input
                type="checkbox"
                checked={hillshadeOn}
                onChange={(event) =>
                  setHillshadeOn(event.target.checked)
                }
              />

            </label>

            <label className="layer-row">
  <span>
    <i className="layer-swatch slope" />
    Slope heatmap
  </span>

  <input
    type="checkbox"
    checked={slopeHeatmapOn}
    onChange={(event) =>
      setSlopeHeatmapOn(event.target.checked)
    }
  />
</label>
<label className="layer-row">
  <span>
    <i className="layer-swatch illumination" />
    Illumination heatmap
  </span>
  <input
    type="checkbox"
    checked={illuminationHeatmapOn}
    onChange={(event) =>
      setIlluminationHeatmapOn(event.target.checked)
    }
  />
</label>

            <label className="layer-row">

              <span>
                <i className="layer-swatch grid" />
                Coordinate grid
              </span>

              <input
                type="checkbox"
                checked={gridOn}
                onChange={(event) =>
                  setGridOn(event.target.checked)
                }
              />

            </label>

            <label className="layer-row">

              <span>
                <i className="layer-swatch site" />
                Candidate sites
              </span>

              <input
                type="checkbox"
                checked={sitesOn}
                onChange={(event) =>
                  setSitesOn(event.target.checked)
                }
              />

            </label>

          </div>

          {/* REFERENCE FEATURES */}

          <div className="rail-section candidates-section">

            <div className="rail-title">
              <span>REFERENCE FEATURES</span>
              <Crosshair size={16} />
            </div>

            {SITES.map((site, index) => (
              <button
                className="rail-site"
                key={site.id}
                onClick={() => openCandidate(site)}
              >

                <span className="site-index">
                  0{index + 1}
                </span>

                <span className="rail-site-copy">

                  <strong>{site.name}</strong>

                  <small>
                    {fmtLat(site.latitude)} ·{' '}
                    {fmtLon(site.longitude)}
                  </small>

                </span>

                <span className="rail-chevron">
                  ↗
                </span>

              </button>
            ))}

            <p className="rail-footnote">
              Named-feature reference coordinates only.
              Not surveyed landing ellipses.
            </p>

          </div>

          {/* DATA PROVENANCE */}

          <div className="rail-data">

            <Database size={15} />

            <div>
              <strong>DATA PROVENANCE</strong>

              <p>
                NASA Goddard LOLA hillshade raster.
                80°S–90°S coverage; elevation sampling
                is not active yet.
              </p>
            </div>

          </div>

        </aside>

        {/* ========================================
            FLOATING INSPECTION PANEL
        ======================================== */}

        {selectedSite && selectedPoint && (
          <aside
            className={`inspection-panel ${
              expanded ? 'expanded' : ''
            }`}
          >

            <div className="inspection-head">

              <div>

                <div className="eyebrow">
                  SITE INSPECTION · 01
                </div>

                <h2>
                  {isSite(selectedSite)
                    ? selectedSite.name
                    : 'Selected coordinate'}
                </h2>

              </div>

              <div className="inspection-actions">

                <button
                  title={
                    expanded
                      ? 'Reduce panel'
                      : 'Expand panel'
                  }
                  onClick={() =>
                    setExpanded((value) => !value)
                  }
                >
                  <Maximize2 size={16} />
                </button>

                <button
                  title="Close inspection"
                  onClick={closeInspection}
                >
                  <X size={18} />
                </button>

              </div>

            </div>

            <div className="inspection-scroll">

              {/* COORDINATES */}

              <div className="inspection-coordinate">

                <span>LATITUDE</span>

                <strong>
                  {fmtLat(selectedPoint.latitude)}
                </strong>

                <span>LONGITUDE</span>

                <strong>
                  {fmtLon(selectedPoint.longitude)}
                </strong>

              </div>

              {/* 3D VIEWER PLACEHOLDER */}

              <div className="terrain-preview">

                <div className="preview-heading">
                  <span>3D TERRAIN VIEWER</span>
                  <span className="planned-tag">
                    NEXT STAGE
                  </span>
                </div>

                <div className="terrain-empty">

                  <Move3D size={25} />

                  <strong>
                    3D TERRAIN NOT YET INTEGRATED
                  </strong>

                  <p>
                    The viewer will use sampled NASA
                    LOLA elevation data. Hillshade
                    imagery is not elevation and will
                    not be used as a terrain mesh.
                  </p>

                </div>

                <div className="terrain-meta">
                  <span>INSPECTION PATCH</span>
                  <strong>20 × 20 KM · PLANNED</strong>
                </div>

              </div>

              {/* SCIENTIFIC REPORT */}

              <div className="report-heading">
                <span>SCIENTIFIC SITE REPORT</span>
                <small>LIVE DATA STATUS</small>
              </div>
              <div className="elevation-card">
  <div className="elevation-card-header">
    <span>NASA LOLA · SURFACE ELEVATION</span>
    <span className="elevation-indicator">DEM</span>
  </div>

  <div className="elevation-value">
    {elevationLoading
      ? '...'
      : elevationSample?.status === 'available'
        ? elevationSample.elevationM.toFixed(2)
        : '—'}

    {elevationSample?.status === 'available' && (
      <span> m</span>
    )}
  </div>

  <div className="elevation-description">
    {elevationLoading
      ? 'Reading elevation data'
      : elevationError
        ? 'Raster read error'
        : elevationSample?.status === 'available'
          ? 'Elevation above lunar reference datum'
          : elevationSample?.status === 'outside-coverage'
            ? 'Outside available DEM coverage'
            : elevationSample?.status === 'no-data'
              ? 'No valid elevation sample'
              : 'Awaiting elevation data'}
  </div>

  {elevationSample?.status === 'available' && (
    <div className="elevation-footer">
      <span>PIXEL SPACING</span>
      <strong>{elevationSample.pixelSpacingM} m</strong>
      <span>SOURCE</span>
      <strong>NASA LOLA</strong>
    </div>

      )}
</div>

{/* SURFACE SLOPE ANALYSIS */}

<section className="slope-panel">
  <div className="slope-header">
    <div>
      <span className="section-eyebrow">
        NASA LOLA · TERRAIN ANALYSIS
      </span>
      <h3>Surface Slope</h3>
    </div>

    <span className="data-status">
      {slopeLoading
        ? 'ANALYZING'
        : slopeError
          ? 'ERROR'
          : slopeSample?.status === 'available'
            ? 'AVAILABLE'
            : slopeSample?.status === 'outside-coverage'
              ? 'OUTSIDE COVERAGE'
              : slopeSample?.status === 'no-data'
                ? 'NO DATA'
                : 'AWAITING DATA'}
    </span>
  </div>

  {slopeLoading && (
    <p>Calculating local terrain gradient...</p>
  )}

  {slopeError && <p>{slopeError}</p>}

  {!slopeLoading && !slopeError &&
    slopeSample?.status === 'available' && (
      <>
        <div className="slope-value">
          {slopeSample.slopeDeg.toFixed(2)}°
        </div>

        <div className="slope-details">
          <div>
            <span>Gradient magnitude</span>
            <strong>{slopeSample.gradientMagnitude.toFixed(4)}</strong>
          </div>

          <div>
            <span>DEM pixel spacing</span>
            <strong>{slopeSample.pixelSpacingM} m</strong>
          </div>

          <div>
            <span>Calculation method</span>
            <strong>Horn 3 × 3</strong>
          </div>
        </div>
      </>
    )}

  {!slopeLoading && !slopeError &&
    slopeSample?.status === 'outside-coverage' && (
      <p>Outside available slope data coverage.</p>
    )}

  {!slopeLoading && !slopeError &&
    slopeSample?.status === 'no-data' && (
      <p>No valid surrounding elevation data.</p>
    )}

  <p className="slope-note">
    Derived from a 3 × 3 neighborhood of NASA LOLA
    elevation pixels. Preliminary terrain measurement,
    not a landing-safety verdict.
  </p>
</section>

<section className="horizon-panel">

  <div className="horizon-header">
    <div>
      <span className="section-eyebrow">
        NASA LOLA · TERRAIN ANALYSIS
      </span>

      <h3>360° Terrain Horizon</h3>
    </div>

    <span className="data-status">
      {horizonLoading
        ? 'SAMPLING'
        : horizonError
          ? 'ERROR'
          : terrainHorizon
            ? 'DEM PROFILE'
            : 'NO DATA'}
    </span>
  </div>

  {horizonLoading && (
    <p className="horizon-message">
      Sampling terrain in 72 compass directions...
    </p>
  )}

  {horizonError && (
    <p className="horizon-error">
      {horizonError}
    </p>
  )}

  {terrainHorizon && (
    <>
      <div className="horizon-chart">

        <div className="horizon-chart-label">
          HORIZON ELEVATION ANGLE
        </div>

        <svg
          viewBox="0 0 360 110"
          role="img"
          aria-label="Terrain horizon elevation by compass bearing"
          preserveAspectRatio="none"
        >
          {[0, 90, 180, 270, 360].map((angle) => (
            <g key={angle}>
              <line
                x1={angle}
                y1="8"
                x2={angle}
                y2="88"
                className="horizon-grid-line"
              />

              <text
                x={angle === 360 ? 356 : angle}
                y="105"
                textAnchor={angle === 0 ? 'start' : angle === 360 ? 'end' : 'middle'}
                className="horizon-axis-label"
              >
                {angle === 360 ? 'N' : `${angle}°`}
              </text>
            </g>
          ))}

          {[0, 30, 60].map((y) => (
            <line
              key={y}
              x1="0"
              y1={y + 8}
              x2="360"
              y2={y + 8}
              className="horizon-grid-line"
            />
          ))}

          <line
            x1="0"
            y1="88"
            x2="360"
            y2="88"
            className="horizon-baseline"
          />

          {terrainHorizon.bins.map((bin) => {
            if (!Number.isFinite(bin.horizonElevationDeg)) {
              return null
            }

            const angle = Math.max(
              -10,
              Math.min(30, bin.horizonElevationDeg),
            )

            const y = 88 - ((angle + 10) / 40) * 80

            return (
              <line
                key={bin.azimuthDeg}
                x1={bin.azimuthDeg}
                y1="88"
                x2={bin.azimuthDeg}
                y2={y}
                className="horizon-bar"
              />
            )
          })}
        </svg>

        <div className="horizon-chart-scale">
          <span>−10°</span>
          <span>0°</span>
          <span>+10°</span>
          <span>+20°</span>
          <span>+30°</span>
        </div>

      </div>

      <div className="horizon-stats">

        <div>
          <span>DIRECTIONS</span>
          <strong>{terrainHorizon.bins.length}</strong>
        </div>

        <div>
          <span>MAX RANGE</span>
          <strong>
            {(terrainHorizon.maxDistanceM / 1000).toFixed(0)} km
          </strong>
        </div>

        <div>
          <span>DEM COVERAGE</span>
          <strong>
            {terrainHorizon.coveragePercent.toFixed(1)}%
          </strong>
        </div>

      </div>

      <div className="horizon-quality">

        <div>
          <span>VALID TERRAIN SAMPLES</span>
          <strong>
            {terrainHorizon.validSamples.toLocaleString()}
          </strong>
        </div>

        <div>
          <span>MISSING SAMPLES</span>
          <strong>
            {terrainHorizon.missingSamples.toLocaleString()}
          </strong>
        </div>

        <div>
          <span>SAMPLE SPACING</span>
          <strong>
            {terrainHorizon.sampleStepM} m
          </strong>
        </div>

        <div>
          <span>ANGULAR SPACING</span>
          <strong>
            {terrainHorizon.azimuthStepDeg}°
          </strong>
        </div>

      </div>

      <div className="horizon-disclaimer">
        <strong>MODEL LIMITATIONS</strong>

        <p>
          DEM-derived terrain horizon using sampled LOLA
          elevations and spherical lunar geometry. Small
          features between samples may be missed. Results
          are limited by DEM coverage and effective
          resolution; they are not a certified visibility
          or landing-safety assessment.
        </p>
      </div>
    </>
  )}

</section>
  
<section className="communications-panel">

  <div className="communications-header">
    <div>
      <span className="section-eyebrow">
        NETWORK & CONNECTIVITY
      </span>

      <h3>Lunar Communications</h3>
    </div>

    <span className="data-status">
      {communicationsLoading
        ? 'CALCULATING'
        : communicationsError
          ? 'ERROR'
          : communicationsAnalysis
            ? communicationsAnalysis.visibility
            : 'NO DATA'}
    </span>
  </div>

  {communicationsLoading && (
    <p className="communications-message">
      Calculating Earth line-of-sight against local terrain...
    </p>
  )}

  {communicationsError && (
    <p className="communications-error">
      {communicationsError}
    </p>
  )}

  {communicationsAnalysis && (
    <>
      <div className="communications-status">
        <div className="communications-status">
  <span>GEOMETRIC VISIBILITY</span>
  <strong>{communicationsAnalysis.visibility}</strong>
</div>
      </div>
      <div className="communications-rating">
  <span>COMMUNICATIONS RATING</span>
  <strong>{communicationsAnalysis.geometryRating}</strong>
  <small>
    Based on Earth-centre clearance above the
    sampled terrain horizon. Not a radio-link quality rating.
  </small>
</div>

      <div className="communications-grid">

        <div className="solar-metric">
          <span>Earth elevation</span>
          <strong>
            {communicationsAnalysis.earthElevationDeg.toFixed(2)}°
          </strong>
        </div>

        <div className="solar-metric">
          <span>Earth azimuth</span>
          <strong>
            {communicationsAnalysis.earthAzimuthDeg.toFixed(2)}°
          </strong>
        </div>

        <div className="solar-metric">
          <span>Terrain horizon</span>
          <strong>
  {communicationsAnalysis.terrainHorizonElevationDeg !== null
    ? `${communicationsAnalysis.terrainHorizonElevationDeg.toFixed(2)}°`
    : 'UNAVAILABLE'}
</strong>
        </div>

        <div className="solar-metric">
          <span>Clearance angle</span>
          <strong>
  {communicationsAnalysis.clearanceAngleDeg !== null
    ? `${communicationsAnalysis.clearanceAngleDeg.toFixed(2)}°`
    : 'UNAVAILABLE'}
</strong>
        </div>

        <div className="solar-metric">
          <span>Earth distance</span>
          <strong>
            {communicationsAnalysis.earthDistanceKm.toLocaleString(
              'en-US',
              { maximumFractionDigits: 0 },
            )} km
          </strong>
        </div>

      </div>

      <div className="communications-disclaimer">
        <strong>MODEL LIMITATIONS</strong>

        <p>
          Geometric Earth-centre line-of-sight compared
          against the sampled LOLA terrain horizon.
          This is not a radio-frequency link budget.
          Antenna characteristics, transmission power,
          receiver sensitivity, atmospheric effects and
          actual communication performance are not evaluated.
          Terrain sampling and DEM coverage also limit accuracy.
        </p>
      </div>
    </>
  )}

</section>

  <section className="illumination-panel">

  <div className="illumination-header">
    <div>
      <span className="section-eyebrow">
        POWER & ENVIRONMENT
      </span>

      <h3>Lunar Illumination</h3>
    </div>

    <span className="data-status">
      {illuminationLoading
        ? 'CALCULATING'
        : illuminationError
          ? 'ERROR'
          : illuminationAnalysis
            ? 'PRELIMINARY MODEL'
            : 'NO DATA'}
    </span>
  </div>
          {selectedSite && (
    <div className="solar-time-controls">
      <span className="section-eyebrow">
        SIMULATION TIME · LOCAL TIME
      </span>

      <input
        type="datetime-local"
        value={simulationTimeInput}
        onChange={(event) => {
          if (!event.target.value) return

          const nextTime = new Date(event.target.value)

          if (!Number.isNaN(nextTime.getTime())) {
            setSimulationTime(nextTime)
          }
        }}
      />

      <div className="solar-time-buttons">
        <button
          onClick={() =>
            setSimulationTime(
              (previous) =>
                new Date(previous.getTime() - 60 * 60 * 1000),
            )
          }
        >
          − 1 HOUR
        </button>

        <button
          onClick={() => setSimulationTime(new Date())}
        >
          NOW
        </button>

        <button
          onClick={() =>
            setSimulationTime(
              (previous) =>
                new Date(previous.getTime() + 60 * 60 * 1000),
            )
          }
        >
          + 1 HOUR
        </button>
      </div>
    </div>
  )}
  {illuminationLoading && (
    <p className="illumination-message">
      Calculating solar geometry across one lunar day...
    </p>
  )}

  {illuminationError && (
    <p className="illumination-error">
      {illuminationError}
    </p>
  )}

  {illuminationAnalysis && (
    <>
      <div className="solar-position-grid">

        <div className="solar-metric">
          <span>Solar elevation</span>

          <strong>
            {liveSolarPosition?.solarElevationDeg.toFixed(2) ?? '--'}
          </strong>
        </div>

        <div className="solar-metric">
          <span>Solar azimuth</span>

          <strong>
            {liveSolarPosition?.solarAzimuthDeg.toFixed(2) ?? '--'}
          </strong>
        </div>

      </div>
      {liveSolarPosition && (
  <div className="solar-live-status">
    <strong>
      {liveSolarPosition.geometricallySunlit
        ? 'SUN ABOVE SPHERICAL HORIZON'
        : 'GEOMETRIC LUNAR NIGHT'}
    </strong>

    <span>
      {simulationTime.toLocaleString()}
    </span>
  </div>
)}

      <div className="illumination-percentage">
        <div>
          <span>Geometric illumination</span>

          <strong>
            {illuminationAnalysis.illuminationPercent.toFixed(1)}%
          </strong>
        </div>

        <div className="illumination-track">
          <div
            className="illumination-fill"
            style={{
              width: `${illuminationAnalysis.illuminationPercent}%`,
            }}
          />
        </div>
      </div>

      <div className="illumination-hours-grid">

        <div>
          <span>Estimated illuminated time</span>

          <strong>
            {illuminationAnalysis.illuminatedHours.toFixed(1)} h
          </strong>
        </div>

        <div>
          <span>Estimated shadow time</span>

          <strong>
            {illuminationAnalysis.shadowHours.toFixed(1)} h
          </strong>
        </div>

      </div>

      <div className="solar-range">
        <div>
          <span>Maximum solar elevation</span>
          <strong>
            {illuminationAnalysis.maxSolarElevationDeg.toFixed(2)}°
          </strong>
        </div>

        <div>
          <span>Minimum solar elevation</span>
          <strong>
            {illuminationAnalysis.minSolarElevationDeg.toFixed(2)}°
          </strong>
        </div>
      </div>

      <div className="illumination-disclaimer">
        <strong>MODEL LIMITATION</strong>

        <p>
          Preliminary spherical-horizon calculation.
          Local terrain obstruction, surface relief and
          solar-panel orientation are not included.
          These values must not be interpreted as
          actual available power or verified sunlight duration.
        </p>
      </div>
    </>
  )}

</section>

              {[
                [
  '01',
  'Geographic identification',
  `${fmtLat(selectedPoint.latitude)} · ${fmtLon(selectedPoint.longitude)}`,
],
                [
  '02',
  'Terrain science',
  horizonLoading
  ? 'CALCULATING TERRAIN HORIZON'
  : horizonError
    ? 'TERRAIN HORIZON UNAVAILABLE'
    : terrainHorizon
      ? 'LOLA TERRAIN HORIZON AVAILABLE'
      : elevationSample?.status === 'available'
        ? 'ELEVATION AVAILABLE · HORIZON PENDING'
        : 'TERRAIN DATA UNAVAILABLE',
],
                [
  '03',
  'Power & illumination',
  illuminationLoading
    ? 'CALCULATING SOLAR POSITION'
    : illuminationAnalysis
      ? 'PRELIMINARY SOLAR GEOMETRY AVAILABLE'
      : illuminationError
        ? 'CALCULATION ERROR'
        : 'NOT CALCULATED',
],
                [
                  '04',
                  'Communications',
                  'DATA UNAVAILABLE',
                ],
                [
                  '05',
                  'Lunar resources',
                  'DATA UNAVAILABLE',
                ],
              ].map(([number, title, status]) => (
                <div
                  className="report-row"
                  key={number}
                >

                  <span className="report-number">
                    {number}
                  </span>

                  <div>
                    <strong>{title}</strong>
                    <small>{status}</small>
                  </div>

                </div>
              ))}

              {/* LANDING ASSESSMENT */}

              <div className="assessment-box">

                <div>
                  <span>LANDING ASSESSMENT</span>

                  <strong>NOT EVALUATED</strong>
                </div>

                <p>
                  Insufficient validated datasets.
                  Missing data is not treated as a
                  safe or unsafe result.
                </p>

              </div>

              {/* SOURCE */}

              <div className="source-line">

                <Database size={13} />

                {isSite(selectedSite)
                  ? selectedSite.source
                  : 'User-selected map coordinate'}

              </div>

            </div>

            <button
              className="back-map"
              onClick={closeInspection}
            >
              <MapIcon size={15} />
              BACK TO MAP
            </button>

          </aside>
        )}

      </section>

      {/* ==========================================
          BOTTOM STATUS BAR
      ========================================== */}

      <footer className="bottom-status">

        <span>
          <i />
          SYSTEM READY
        </span>

        <span>
          BASE MAP: NASA LOLA HILLSHADE
        </span>

        <span>
          RASTER COVERAGE: 80°S–90°S
        </span>

        <span>
          ASSESSMENT: NOT EVALUATED
        </span>

      </footer>

    </main>
  )
}
