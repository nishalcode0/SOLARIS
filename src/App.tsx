
import {
  useMemo,
  useRef,
  useState,
} from 'react'

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
const DEFAULT_ZOOM = 1.25
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

  let longitude =
    (Math.atan2(x, y) * 180) / Math.PI

  if (longitude < 0) {
    longitude += 360
  }

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

  const selectedHasRasterCoverage =
    selectedPoint !== null &&
    projectedRadius(selectedPoint.latitude) <=
      DATA_RADIUS_M

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
  // Fixed-centre zoom. No dragging or panning.
  // ------------------------------------------------

  function handleMapClick(
    event: ReactMouseEvent<HTMLDivElement>,
  ) {
    const target = event.target as HTMLElement

    if (target.closest('button')) return

    const frame = mapRef.current

    if (!frame) return

    const rect = frame.getBoundingClientRect()

    const x =
      ((event.clientX - rect.left) / rect.width) *
      100

    const y =
      ((event.clientY - rect.top) / rect.height) *
      100

    if (
      x < 0 ||
      x > 100 ||
      y < 0 ||
      y > 100
    ) {
      return
    }

    const point = inverseProject(x, y)

    if (!insideView(point)) return

    setPendingSite(point)
    setSelectedSite(null)
  }

  // Cursor coordinate readout.
  // The transformed map's bounding rectangle is used
  // so coordinates remain accurate while zooming.

  function handlePointerMove(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    const frame = mapRef.current

    if (!frame) return

    const rect = frame.getBoundingClientRect()

    const x =
      ((event.clientX - rect.left) / rect.width) *
      100

    const y =
      ((event.clientY - rect.top) / rect.height) *
      100

    if (
      x < 0 ||
      x > 100 ||
      y < 0 ||
      y > 100
    ) {
      setCursor(null)
      return
    }

    const point = inverseProject(x, y)

    setCursor(
      insideView(point) ? point : null,
    )
  }

  // Fixed-centre zoom.

  function zoomBy(factor: number) {
    setZoom((current) =>
      Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, current * factor),
      ),
    )
  }

  // Reset always returns to the larger default view.

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
                  src="/data/lola-south-pole-hillshade.png"
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

              {[
                [
                  '01',
                  'Geographic identification',
                  'REFERENCE COORDINATE AVAILABLE',
                ],
                [
                  '02',
                  'Terrain science',
                  selectedHasRasterCoverage
                    ? 'HILLSHADE AVAILABLE · DEM SAMPLING PENDING'
                    : 'HIGH-RESOLUTION TERRAIN UNAVAILABLE',
                ],
                [
                  '03',
                  'Power & illumination',
                  'DATA UNAVAILABLE',
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
