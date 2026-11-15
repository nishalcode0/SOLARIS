
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react'

import LunarTerrain3D from './components/LunarTerrain3D'
import MissionTimeController from './components/MissionTimeController'
import HorizonIntelligence from './components/HorizonIntelligence'
import { samplePSR } from './lib/lunarPSR'
import type { PSRSample } from './lib/lunarPSR'
import { evaluateMissionDecision } from './lib/missionDecision'
import SiteComparison from './components/SiteComparison'


import {
  buildLunarResourceAssessment,
} from './lib/lunarResources'

import type {
  LunarResourceAssessment,
} from './types/lunarResources'

import {
  calculateEarthVisibility,
  type EarthVisibilityAnalysis,
} from './lib/lunarCommunications'

import {
  analyzeLunarIllumination,
  calculateSolarPosition,
  calculateTerrainVisibility,
  type LunarIlluminationAnalysis,
} from './lib/lunarIllumination'

import {
  sampleElevation,
  projectedCoordinates,
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

type PSRPosition = [number, number]
type PSRRing = PSRPosition[]
type PSRPolygon = PSRRing[]

type PSRFeature = {
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
  properties: {
    gid: string
    area_km2: string
    name: string
  }
}

type PSRShadowResult =
  | 'inside-mapped-psr'
  | 'outside-mapped-psr'
  | 'insufficient-data'

function pointInRing(
  x: number,
  y: number,
  ring: PSRPosition[],
): boolean {
  let inside = false

  for (
    let i = 0, j = ring.length - 1;
    i < ring.length;
    j = i++
  ) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]

    const intersects =
      (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi

    if (intersects) inside = !inside
  }

  return inside
}

function pointInPolygon(
  x: number,
  y: number,
  polygon: PSRPolygon,
): boolean {
  const [outerRing, ...holes] = polygon

  if (!outerRing || !pointInRing(x, y, outerRing)) {
    return false
  }

  return !holes.some(hole => pointInRing(x, y, hole))
}

function assessMappedPSR(
  latitude: number,
  longitude: number,
  features: PSRFeature[],
): PSRShadowResult {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > -80 ||
    longitude < -180 ||
    longitude > 180 ||
    features.length === 0
  ) {
    return 'insufficient-data'
  }

  const { x, y, rho } = projectedCoordinates(
    latitude,
    longitude,
  )

  if (rho > 304000) return 'insufficient-data'

  for (const feature of features) {
    const polygons: PSRPolygon[] =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates

    for (const polygon of polygons) {
      if (pointInPolygon(x, y, polygon)) {
        return 'inside-mapped-psr'
      }
    }
  }

  return 'outside-mapped-psr'
}

export default function App() {
  // Location workflow:
  // pendingSite = temporary popup selection
  // selectedSite = confirmed inspection selection

  const [pendingSite, setPendingSite] =
    useState<Selection | null>(null)

  const [selectedSite, setSelectedSite] =
    useState<Selection | null>(null)

  const [comparisonSites, setComparisonSites] =  
    useState<Site[]>([])
  
  const [comparisonOpen, setComparisonOpen] = 
    useState(false)

  const [terrainFocus, setTerrainFocus] =
    useState<Point | null>(null)

  const [reportOpen, setReportOpen] =
    useState(true)

  // Map navigation.
  // No pan state: the South Pole remains centred.

  const [zoom, setZoom] = useState(DEFAULT_ZOOM)

  const [hillshadeOn, setHillshadeOn] =
    useState(true)

  const [viewMode, setViewMode] =
    useState<'2d' | '3d'>('2d')

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

  const [resourceAssessment, setResourceAssessment] =
    useState<LunarResourceAssessment | null>(null)

  const [resourceError, setResourceError] =
    useState<string | null>(null)

  const [psrOn, setPsrOn] = useState(false)
const [psrFeatures, setPsrFeatures] = useState<PSRFeature[]>([])
const [psrError, setPsrError] = useState(false)

  const comparisonShadowAssessor = useCallback(
  (latitude: number, longitude: number) =>
    assessMappedPSR(latitude, longitude, psrFeatures),
  [psrFeatures],
)

useEffect(() => {
  let active = true

  fetch('/data/lunar-psr-display.geojson')
    .then(response => {
      if (!response.ok) throw new Error('PSR data unavailable')
      return response.json()
    })
    .then(data => {
      if (active) setPsrFeatures(data.features ?? [])
    })
    .catch(error => {
      console.error('PSR overlay loading failed:', error)
      if (active) setPsrError(true)
    })

  return () => {
    active = false
  }
}, [])

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


const missionDecision = useMemo(() => {
  return evaluateMissionDecision({
    elevationAvailable: elevationSample?.status === 'available',
    slopeAvailable: slopeSample?.status === 'available',
    slopeDeg:
      slopeSample?.status === 'available'
        ? slopeSample.slopeDeg
        : null,
    horizonAvailable: terrainHorizon !== null,
    communicationsAvailable: communicationsAnalysis !== null,
    earthVisibility: communicationsAnalysis?.visibility ?? null,
    illuminationAvailable: illuminationAnalysis !== null,
    illuminationPercent:
      illuminationAnalysis?.illuminationPercent ?? null,
    psrAssessmentAvailable:
      resourceAssessment !== null &&
      resourceAssessment.shadowStatus !== 'insufficient-data',
    waterIceObservationsAvailable:
      resourceAssessment?.dataCoverage.waterIceObservations ?? false,
  })
}, [
  elevationSample,
  slopeSample,
  terrainHorizon,
  communicationsAnalysis,
  illuminationAnalysis,
  resourceAssessment,
])

const liveSolarPosition = useMemo(() => {
  if (!selectedSite) return null

  return calculateSolarPosition(
    selectedSite.latitude,
    selectedSite.longitude,
    simulationTime,
  )
}, [selectedSite, simulationTime])

const liveTerrainVisibility = useMemo(() => {
  if (!liveSolarPosition || !terrainHorizon) return null

  return calculateTerrainVisibility(
    liveSolarPosition,
    terrainHorizon,
  )
}, [liveSolarPosition, terrainHorizon])
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

    setCommunicationsAnalysis(null)
    setCommunicationsError(null)
    setCommunicationsLoading(false)

    setResourceAssessment(null)
    setResourceError(null)

    return
  }

  const latitude = selectedSite.latitude
  const longitude = selectedSite.longitude

  console.log('SOLARIS LOCATION INPUT:', {
    latitude,
    longitude,
    latitudeFinite: Number.isFinite(latitude),
    longitudeFinite: Number.isFinite(longitude),
  })

  let active = true

  // Reset results from the previous location.
  setElevationSample(null)
  setElevationError(null)
  setElevationLoading(true)

  setSlopeSample(null)
  setSlopeError(null)
  setSlopeLoading(true)

  setTerrainHorizon(null)
  setHorizonError(null)
  setHorizonLoading(true)

  setCommunicationsAnalysis(null)
  setCommunicationsError(null)
  setCommunicationsLoading(true)

  setResourceAssessment(null)
  setResourceError(null)

  async function runLocationAnalysis() {
    const results = await Promise.allSettled([
    sampleElevation(latitude, longitude),
    sampleSlope(latitude, longitude),
    sampleTerrainHorizon(latitude, longitude),
    samplePSR(latitude, longitude),
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

    let horizonProfile = null

    if (horizonResult.status === 'fulfilled') {
      horizonProfile = horizonResult.value

      setTerrainHorizon(horizonProfile)

      // 4. Earth line-of-sight analysis
      try {
        const communications = calculateEarthVisibility(
          latitude,
          longitude,
          horizonProfile,
          new Date(),
        )

        if (active) {
          setCommunicationsAnalysis(communications)
        }
      } catch (error) {
        console.error(
          'Earth visibility calculation failed:',
          error,
        )

        if (active) {
          setCommunicationsError(
            error instanceof Error
              ? error.message
              : 'Unknown communications calculation error',
          )
        }
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

    // 4. NASA LOLA PSR raster
const psrResult = results[3]

let psrSample: PSRSample

if (psrResult.status === 'fulfilled') {
  psrSample = psrResult.value
} else {
  console.error('NASA LOLA PSR sampling failed:', psrResult.reason)
  psrSample = { status: 'unavailable' }
}

    // 5. Lunar Resource Intelligence
    if (
      elevationResult.status === 'fulfilled' &&
      slopeResult.status === 'fulfilled'
    ) {
      try {
        const assessment = buildLunarResourceAssessment(
  latitude,
  longitude,
  elevationResult.value,
  slopeResult.value,
  horizonProfile,
  psrSample,
  assessMappedPSR(latitude, longitude, psrFeatures),
)

        if (active) {
          setResourceAssessment(assessment)
          setResourceError(null)
        }
      } catch (error) {
        console.error(
          'Lunar resource assessment failed:',
          error,
        )

        if (active) {
          setResourceAssessment(null)
          setResourceError(
            error instanceof Error
              ? error.message
              : 'Unknown resource assessment error',
          )
        }
      }
    } else {
      setResourceError(
        'Resource assessment unavailable because elevation or slope data could not be calculated.',
      )
    }
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
    setCommunicationsError('Location analysis failed')
    setResourceError('Location analysis failed')

    setElevationLoading(false)
    setSlopeLoading(false)
    setHorizonLoading(false)
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

  function toggleComparisonSite(site: Site) {
  setComparisonSites((current) => {
    const alreadySelected = current.some(
      (item) => item.id === site.id,
    )

    if (alreadySelected) {
      return current.filter((item) => item.id !== site.id)
    }

    if (current.length >= 3) {
      return current
    }

    return [...current, site]
  })
}

  function addPendingToComparison() {
  if (!pendingSite) return

  const site: Site = isSite(pendingSite)
    ? pendingSite
    : {
        id: `custom-${pendingSite.latitude.toFixed(5)}-${pendingSite.longitude.toFixed(5)}`,
        name: `Custom location ${comparisonSites.filter(
          (item) => item.id.startsWith('custom-'),
        ).length + 1}`,
        code: 'CUSTOM COORDINATE',
        latitude: pendingSite.latitude,
        longitude: pendingSite.longitude,
        terrain: 'Unclassified terrain',
        description: 'User-selected lunar map coordinate.',
        source: 'User-selected map coordinate',
      }

  setComparisonSites((current) => {
    if (current.some((item) => item.id === site.id)) {
      return current
    }

    if (current.length >= 3) return current

    return [...current, site]
  })
}

function startComparison() {
  if (comparisonSites.length < 2) return
  setComparisonOpen(true)
}

 function landHere() {
  if (!pendingSite) return

  setSelectedSite(pendingSite)

  setTerrainFocus({
    latitude: pendingSite.latitude,
    longitude: pendingSite.longitude,
  })

  setPendingSite(null)
  setExpanded(false)
  setReportOpen(true)
}
  function closeInspection() {
  setReportOpen(false)
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

  <button
    className={`view-toggle ${viewMode === '2d' ? 'active' : ''}`}
    onClick={() => setViewMode('2d')}
  >
    <MapIcon size={14} />
    2D MAP
  </button>

  <button
    className={`view-toggle ${viewMode === '3d' ? 'active' : ''}`}
    onClick={() => setViewMode('3d')}
    disabled={!selectedPoint}
    title={!selectedPoint ? 'Select a location first' : 'Open 3D terrain'}
  >
    <Move3D size={14} />
    3D TERRAIN
  </button>

</div>

      </header>

      {/* ==========================================
          MAP WORKSPACE
      ========================================== */}

     <section className={`map-workspace ${viewMode === '3d' ? 'terrain-mode' : ''}`}>

        {viewMode === '2d' ? (
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

{/* NASA MAPPED PSR POLYGONS */}

{psrOn && psrFeatures.length > 0 && (
  <svg
    className="psr-overlay"
    viewBox={`0 0 ${2 * VIEW_RADIUS_M} ${2 * VIEW_RADIUS_M}`}
    preserveAspectRatio="none"
  >
    <defs>
  <clipPath id="psr-coverage-clip">
    <circle
      cx={VIEW_RADIUS_M}
      cy={VIEW_RADIUS_M}
      r={304000}
    />
  </clipPath>
</defs>

<g clipPath="url(#psr-coverage-clip)">
    {psrFeatures.map(feature => {
      const polygons =
        feature.geometry.type === 'Polygon'
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates

      return polygons.map((polygon, polygonIndex) => {
        const outerRing = polygon[0]

        const points = outerRing
          .map(([x, y]) =>
            `${x + VIEW_RADIUS_M},${VIEW_RADIUS_M - y}`
          )
          .join(' ')

        return (
          <polygon
            key={`${feature.properties.gid}-${polygonIndex}`}
            points={points}
            className="psr-polygon"
          />
        )
      })
    })}
    </g>
  </svg>
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
                              {/* USER-ADDED LANDING SITE MARKERS */}

              {comparisonSites.map((site) => (
                <button
                  key={`comparison-${site.id}`}
                  className="comparison-site-marker"
                  style={project(
                    site.latitude,
                    site.longitude,
                  )}
                  onClick={() => openCandidate(site)}
                  title={site.name}
                  aria-label={`Inspect added site ${site.name}`}
                >
                  <i />
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

              <button
  className="land-button comparison-add-button"
  onClick={addPendingToComparison}
  disabled={
    comparisonSites.length >= 3 &&
    !comparisonSites.some(
      (site) =>
        site.id === (
          isSite(pendingSite)
            ? pendingSite.id
            : `custom-${pendingPoint.latitude.toFixed(5)}-${pendingPoint.longitude.toFixed(5)}`
        ),
    )
  }
>
  ADD TO COMPARISON
  <span>+</span>
</button>

              <small className="land-disclaimer">
                INSPECT CANDIDATE · NOT A LANDING APPROVAL
              </small>

            </div>
          )}

          </div>
        
       
        ) : (
          <div className="map-viewport terrain-3d-viewport">

            {/* 3D LUNAR TERRAIN */}
            {terrainFocus && (
              <LunarTerrain3D
                latitude={terrainFocus.latitude}
                longitude={terrainFocus.longitude}
                simulationTime={simulationTime}
                psrFeatures={psrFeatures}
              />
            )}

            {/* MIDDLE-LEFT MISSION TIME CONTROLLER */}
            {selectedSite && (
              <div className="mission-time-overlay">
                <MissionTimeController
                  simulationTime={simulationTime}
                  onTimeChange={setSimulationTime}
                  compact
                />
              </div>
            )}

            {/* RETURN TO 2D MAP */}
            <button
              className="terrain-exit-button"
              onClick={() => setViewMode('2d')}
            >
              ← 2D MAP
            </button>

          </div>
        )}

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
    <i className="layer-swatch psr" />
    Mapped PSRs (&gt;1 km²)
  </span>

  <input
    type="checkbox"
    checked={psrOn}
    onChange={event => setPsrOn(event.target.checked)}
  />
</label>

{psrError && (
  <small className="layer-error">
    PSR DATA UNAVAILABLE
  </small>
)}

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

            {SITES.map((site, index) => {
  const isAdded = comparisonSites.some(
    (item) => item.id === site.id,
  )

  return (
    <div className="rail-site-row" key={site.id}>
      <button
        className="rail-site"
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

      <button
        className={`rail-compare-add ${isAdded ? 'selected' : ''}`}
        onClick={() => toggleComparisonSite(site)}
        disabled={!isAdded && comparisonSites.length >= 3}
        title={
          isAdded
            ? 'Remove from comparison'
            : 'Add to comparison'
        }
      >
        {isAdded ? 'ADDED' : '+ COMPARE'}
      </button>
    </div>
  )
})}

<p className="rail-footnote">
  Named-feature reference coordinates only.
  Not surveyed landing ellipses.
</p>

<div className="rail-compare-footer">
  <span>
    {comparisonSites.length}/3 SELECTED
  </span>

  <button
    disabled={comparisonSites.length < 2}
    onClick={startComparison}
  >
    COMPARE SITES →
  </button>
</div>

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

        {reportOpen && selectedSite && selectedPoint && (
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

{selectedSite && (
  <HorizonIntelligence
    latitude={selectedSite.latitude}
    longitude={selectedSite.longitude}
    simulationTime={simulationTime}
    profile={terrainHorizon}
    solar={liveSolarPosition}
    earth={communicationsAnalysis}
    loading={horizonLoading}
    error={horizonError}
  />
)}
  
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
  <MissionTimeController
    simulationTime={simulationTime}
    onTimeChange={setSimulationTime}
  />
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

    
<div className="mission-tradeoff-panel">
  <div
    className={`mission-decision-status decision-${missionDecision.status
      .toLowerCase()
      .replace(/\s+/g, '-')}`}
  >
    <span>PRELIMINARY SITE DECISION</span>
    <strong>{missionDecision.status}</strong>
    <small>
      {missionDecision.evaluatedCriteria}/{missionDecision.totalCriteria}
      {' '}screening criteria evaluated
    </small>
  </div>

  <div className="decision-intelligence-grid">
    <div className="decision-intelligence-metric">
      <span>DATA COVERAGE</span>
      <strong>{missionDecision.coveragePercent}%</strong>
    </div>

    <div className="decision-intelligence-metric">
      <span>CONFIDENCE</span>
      <strong>{missionDecision.confidence}</strong>
    </div>

    <div className="decision-intelligence-metric">
      <span>SCREENING SCORE</span>
      <strong>
        {missionDecision.score !== null
          ? `${missionDecision.score}/100`
          : 'N/A'}
      </strong>
    </div>
  </div>

  <div className="decision-explanation">
    <strong>ENGINE EXPLANATION</strong>
    <p>{missionDecision.explanation}</p>
  </div>

  {missionDecision.findings.length > 0 && (
    <div className="decision-findings">
      <strong>DECISION FINDINGS</strong>

      {missionDecision.findings.map((finding, index) => (
        <div
          key={`${finding.category}-${index}`}
          className={`decision-finding finding-${finding.severity.toLowerCase()}`}
        >
          <div className="decision-finding-heading">
            <span>{finding.category}</span>
            <small>{finding.severity}</small>
          </div>

          <p>{finding.message}</p>

          {finding.value !== undefined && (
            <small>
              Observed: {finding.value}
              {finding.threshold !== undefined &&
                ` | Screening threshold: ${finding.threshold}`}
            </small>
          )}
        </div>
      ))}
    </div>
  )}

  <div className="decision-disclaimer">
    {missionDecision.disclaimer}
  </div>


<div className="resource-section-heading">
  <span>05</span>
  <h4>MISSION TRADE-OFF ANALYSIS</h4>
</div>

  <p className="tradeoff-intro">
    Live assessment of the selected lunar landing coordinate.
    Values are measurements or model outputs, not mission guarantees.
  </p>

  <div className="tradeoff-grid">
    <div className="tradeoff-metric">
      <span>Solar illumination</span>
      <strong>
        {illuminationAnalysis
          ? `${illuminationAnalysis.illuminationPercent.toFixed(1)}%`
          : 'UNAVAILABLE'}
      </strong>
      <small>Geometric model</small>
    </div>

    <div className="tradeoff-metric">
      <span>Shadow duration</span>
      <strong>
        {illuminationAnalysis
          ? `${illuminationAnalysis.shadowHours.toFixed(1)} h`
          : 'UNAVAILABLE'}
      </strong>
      <small>Estimated</small>
    </div>

    <div className="tradeoff-metric">
      <span>Terrain slope</span>
      <strong>
        {slopeSample?.status === 'available'
          ? `${slopeSample.slopeDeg.toFixed(1)}°`
          : 'UNAVAILABLE'}
      </strong>
      <small>LOLA-derived</small>
    </div>

    <div className="tradeoff-metric">
      <span>Earth visibility</span>
      <strong>
        {communicationsAnalysis?.visibility ?? 'UNAVAILABLE'}
      </strong>
      <small>Geometric line of sight</small>
    </div>

    <div className="tradeoff-metric">
      <span>Mapped PSR status</span>
      <strong>
        {resourceAssessment?.shadowStatus
          .replace(/-/g, ' ')
          .toUpperCase() ?? 'UNAVAILABLE'}
      </strong>
      <small>Polygon membership</small>
    </div>

    <div className="tradeoff-metric">
      <span>Water-ice observations</span>
      <strong>NOT INTEGRATED</strong>
      <small>Orbital evidence unavailable</small>
    </div>
  </div>

  <div className="tradeoff-warning">
    <strong>ENGINE STATUS: PRELIMINARY</strong>
    <p>
      Power-system sizing, RF link budget, landing dispersion,
      thermal survival and validated water-ice observations
      are not yet included. No final landing approval is implied.
    </p>
  </div>

</div>
 


    </>
  )}

</section>

{/* ==========================================
    LUNAR RESOURCE INTELLIGENCE
========================================== */}

<section className="resource-panel">

  <div className="resource-header">
    <div>
      <span className="section-eyebrow">RESOURCE PROSPECTING</span>
      <h3>Lunar Resource Intelligence</h3>
      <p className="resource-subtitle">
        Scientific assessment of the selected lunar coordinates
      </p>
    </div>

    <span className="data-status">
      {resourceError
        ? 'ERROR'
        : resourceAssessment
          ? 'ASSESSMENT AVAILABLE'
          : 'AWAITING DATA'}
    </span>
  </div>

  {!resourceAssessment && !resourceError && (
    <p>Select a lunar location to calculate its resource assessment.</p>
  )}

  {resourceError && (
    <p className="resource-error">{resourceError}</p>
  )}

  {resourceAssessment && (
    <div className="resource-content">

      {/* PRIMARY ASSESSMENT */}

      <div className="resource-overview">
        <span className="resource-overview-label">
          MAPPED PERMANENTLY SHADOWED REGION
        </span>

        <h4>
          {resourceAssessment.shadowStatus === 'inside-mapped-psr'
            ? 'Inside mapped PSR'
            : resourceAssessment.shadowStatus === 'outside-mapped-psr'
              ? 'Outside mapped PSR'
              : 'PSR classification unavailable'}
        </h4>

        <p>
          {resourceAssessment.shadowStatus === 'inside-mapped-psr'
            ? 'The selected coordinate falls within a mapped NASA permanently shadowed region polygon.'
            : resourceAssessment.shadowStatus === 'outside-mapped-psr'
              ? 'The coordinate is outside the supplied mapped PSR boundaries. This does not establish that the location is currently sunlit.'
              : 'Mapped PSR boundaries are unavailable or the selected coordinate cannot be assessed.'}
        </p>
      </div>

      {/* SUMMARY METRICS */}

      <div className="resource-section">
        <div className="resource-section-heading">
          <span>01</span>
          <h4>RESOURCE SUMMARY</h4>
        </div>

        <div className="resource-summary-grid">

          <div className="resource-card">
            <span>Water-ice evidence</span>
            <strong>{resourceAssessment.waterIce.status.toUpperCase()}</strong>
          </div>

          <div className="resource-card">
            <span>Evidence confidence</span>
            <strong>{resourceAssessment.waterIce.confidence.toUpperCase()}</strong>
          </div>

          <div className="resource-card">
            <span>Terrain data</span>
            <strong>
              {resourceAssessment.dataCoverage.terrain
                ? 'AVAILABLE'
                : 'UNAVAILABLE'}
            </strong>
          </div>

          <div className="resource-card">
            <span>PSR polygon data</span>
            <strong>
              {resourceAssessment.dataCoverage.psr
                ? 'AVAILABLE'
                : 'UNAVAILABLE'}
            </strong>
          </div>

        </div>
      </div>

      {/* LIVE SHADOW ANALYSIS */}

      <div className="resource-section">
        <div className="resource-section-heading">
          <span>02</span>
          <h4>LIVE SHADOW ANALYSIS</h4>
          <span className="resource-live-tag">SIMULATION TIME</span>
        </div>

        <div className="resource-shadow-card">

          <div className="resource-shadow-status">
            <span>Terrain visibility</span>
            <strong>
              {liveTerrainVisibility?.status === 'blocked-estimate'
                ? 'TERRAIN-SHADOWED'
                : liveTerrainVisibility?.status === 'visible-estimate'
                  ? 'SUN ABOVE LOCAL HORIZON'
                  : 'UNCERTAIN'}
            </strong>
          </div>

          <div className="resource-shadow-grid">

            <div>
              <span>Solar elevation</span>
              <strong>
                {liveTerrainVisibility &&
                liveTerrainVisibility.status !== 'uncertain'
                  ? `${liveTerrainVisibility.solarElevationDeg.toFixed(2)}°`
                  : '--'}
              </strong>
            </div>

            <div>
              <span>Terrain horizon</span>
              <strong>
                {liveTerrainVisibility &&
                liveTerrainVisibility.status !== 'uncertain'
                  ? `${liveTerrainVisibility.terrainHorizonDeg.toFixed(2)}°`
                  : '--'}
              </strong>
            </div>

            <div>
              <span>Solar clearance</span>
              <strong>
                {liveTerrainVisibility &&
                liveTerrainVisibility.status !== 'uncertain'
                  ? `${liveTerrainVisibility.clearanceDeg.toFixed(2)}°`
                  : '--'}
              </strong>
            </div>

          </div>

          <p>
            {liveTerrainVisibility?.status === 'blocked-estimate'
              ? 'The calculated local terrain horizon is above the Sun at the selected simulation time. Terrain obstruction is estimated.'
              : liveTerrainVisibility?.status === 'visible-estimate'
                ? 'The Sun is above the calculated local terrain horizon at the selected simulation time.'
                : 'Terrain visibility cannot currently be determined from the available horizon samples.'}
          </p>

          <div className="resource-note">
            Time-specific geometric estimate using NASA LOLA terrain.
            Not proof of permanent shadow or water-ice presence.
          </div>

        </div>
      </div>

      {/* PSR DATA */}

      <div className="resource-section">
        <div className="resource-section-heading">
          <span>03</span>
          <h4>NASA PSR DATA</h4>
        </div>

        <div className="resource-data-list">

          <div>
            <span>Raster sample</span>
            <strong>
              {resourceAssessment.psr.status === 'available'
                ? 'AVAILABLE'
                : resourceAssessment.psr.status === 'outside-coverage'
                  ? 'OUTSIDE COVERAGE'
                  : resourceAssessment.psr.status === 'no-data'
                    ? 'NO DATA'
                    : resourceAssessment.psr.status === 'invalid-value'
                      ? 'INVALID VALUE'
                      : 'UNAVAILABLE'}
            </strong>
          </div>

          <div>
            <span>Raw mask value</span>
            <strong>
              {resourceAssessment.psr.status === 'available'
                ? resourceAssessment.psr.maskValue
                : resourceAssessment.psr.status === 'invalid-value'
                  ? resourceAssessment.psr.value
                  : 'NOT AVAILABLE'}
            </strong>
          </div>

          <div>
            <span>Spatial resolution</span>
            <strong>
              {resourceAssessment.psr.status === 'available'
                ? `${resourceAssessment.psr.pixelSpacingM} m / pixel`
                : 'NOT AVAILABLE'}
            </strong>
          </div>

          <div>
            <span>Raster pixel coordinates</span>
            <strong>
              {resourceAssessment.psr.status === 'available'
                ? `${resourceAssessment.psr.pixelColumn}, ${resourceAssessment.psr.pixelRow}`
                : 'NOT AVAILABLE'}
            </strong>
          </div>

          <div>
            <span>Raster coverage</span>
            <strong>
              {resourceAssessment.dataCoverage.psr
                ? 'AVAILABLE'
                : 'UNAVAILABLE'}
            </strong>
          </div>

          {resourceAssessment.psr.status === 'available' && (
            <div>
              <span>Data source</span>
              <strong>{resourceAssessment.psr.source}</strong>
            </div>
          )}

        </div>

        <div className="resource-note">
          The raster's binary encoding has not been independently
          verified. Raw values are displayed without interpreting
          them as confirmed PSR membership.
        </div>
      </div>

      {/* WATER ICE OBSERVATIONS */}

      <div className="resource-section">
        <div className="resource-section-heading">
          <span>04</span>
          <h4>WATER-ICE OBSERVATIONS</h4>
        </div>

        <div className="resource-observation-grid">

          <div className="resource-observation-card">
            <span className="resource-observation-icon">H</span>
            <div>
              <span>Hydrogen evidence</span>
              <strong>
                {resourceAssessment.waterIce.hydrogenEvidence
                  .replace(/-/g, ' ')
                  .toUpperCase()}
              </strong>
            </div>
          </div>

          <div className="resource-observation-card">
            <span className="resource-observation-icon">T</span>
            <div>
              <span>Thermal evidence</span>
              <strong>
                {resourceAssessment.waterIce.thermalEvidence
                  .replace(/-/g, ' ')
                  .toUpperCase()}
              </strong>
            </div>
          </div>

          <div className="resource-observation-card">
            <span className="resource-observation-icon">R</span>
            <div>
              <span>Radar evidence</span>
              <strong>
                {resourceAssessment.waterIce.radarEvidence
                  .replace(/-/g, ' ')
                  .toUpperCase()}
              </strong>
            </div>
          </div>

          <div className="resource-observation-card">
            <span className="resource-observation-icon">D</span>
            <div>
              <span>Terrain horizon</span>
              <strong>
                {resourceAssessment.dataCoverage.horizon
                  ? 'AVAILABLE'
                  : 'UNAVAILABLE'}
              </strong>
            </div>
          </div>

        </div>

        <div className="resource-explanation">
          {resourceAssessment.waterIce.explanation}
        </div>
      </div>

      {/* METHODOLOGY */}

      <div className="resource-methodology">
        <span>METHODOLOGY & PROVENANCE</span>
        <p>{resourceAssessment.methodology}</p>
      </div>

    </div>
  )}

  <div className="resource-disclaimer">
    <strong>SCIENTIFIC LIMITATION</strong>
    <p>
      Shadow conditions alone do not establish water-ice presence.
      PSR raster values are displayed as raw data because their
      binary encoding has not been independently verified.
      Validated orbital observations are required to establish
      water-ice evidence.
    </p>
  </div>

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
  resourceError
    ? 'ASSESSMENT ERROR'
    : resourceAssessment
      ? resourceAssessment.waterIce.status.toUpperCase()
      : 'AWAITING ASSESSMENT',
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

      {comparisonOpen && (
        <SiteComparison
  sites={comparisonSites}
  simulationTime={simulationTime}
  onClose={() => setComparisonOpen(false)}
  onRemoveSite={(siteId) => {
    setComparisonSites((current) =>
      current.filter((site) => site.id !== siteId)
    )
  }}
  assessShadow={comparisonShadowAssessor}
/>
      )}

    </main>
  )
}
