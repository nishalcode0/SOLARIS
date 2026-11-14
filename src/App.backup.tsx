import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from 'react'
import {
  Activity,
  Crosshair,
  Database,
  Layers3,
  Maximize2,
  Minimize2,
  Minus,
  Move,
  Plus,
  Radio,
  RotateCcw,
  Satellite,
  ShieldCheck,
  Sun,
  Target,
  Clock3,
} from 'lucide-react'

type LandingSite = {
  id: string
  name: string
  siteCode: string
  region: string
  latitude: number
  longitude: number
  terrain: string
  description: string
  source: string
}

// These are named-feature reference coordinates, not landing ellipses.
// Keep their source and uncertainty visible in the interface.
const landingSites: LandingSite[] = [
  {
    id: 'shackleton',
    name: 'Shackleton Rim',
    siteCode: 'Site04 / R04',
    region: 'South Pole',
    latitude: -89.7668,
    longitude: -171.87,
    terrain: 'Crater rim',
    description: 'NASA Lunar Surface Data Book reference coordinate for the Shackleton Rim candidate. This is a reference point, not a surveyed landing ellipse.',
    source: 'NASA Lunar Surface Data Book, Table A2-2',
  },
  {
    id: 'connecting',
    name: 'Connecting Ridge',
    siteCode: 'Site01 / R01',
    region: 'South Pole',
    latitude: -89.4632,
    longitude: -137.49,
    terrain: 'Ridge',
    description: 'NASA Lunar Surface Data Book reference coordinate for Connecting Ridge. This is a reference point, not a surveyed landing ellipse.',
    source: 'NASA Lunar Surface Data Book, Table A2-2',
  },
  {
    id: 'malapert',
    name: 'Malapert Massif',
    siteCode: 'Site23 / R23',
    region: 'South Pole',
    latitude: -85.9948,
    longitude: -0.23578,
    terrain: 'Massif',
    description: 'NASA Lunar Surface Data Book reference coordinate for Malapert Massif. This is a named-feature reference point; detailed local terrain analysis remains pending.',
    source: 'NASA Lunar Surface Data Book, Table A2-2',
  },
]

type LayerName =
  | 'LOLA hillshade'
  | 'Coordinate grid'
  | 'Candidate sites'
  | 'Elevation'
  | 'Slope'
  | 'Illumination'
  | 'PSR regions'

const initialLayers: Record<LayerName, boolean> = {
  'LOLA hillshade': true,
  'Coordinate grid': true,
  'Candidate sites': true,
  Elevation: false,
  Slope: false,
  Illumination: false,
  'PSR regions': false,
}

const MOON_RADIUS_M = 1_737_400
const MAP_EXTENT_M = 304_000 // Approximate projected radius of the 80°S boundary.
const ZOOM_MIN = 0.75
const ZOOM_MAX = 6

function projectedRadius(latitude: number) {
  const lat = (latitude * Math.PI) / 180
  return 2 * MOON_RADIUS_M * Math.tan(Math.PI / 4 + lat / 2)
}

function projectSite(latitude: number, longitude: number) {
  const lon = (longitude * Math.PI) / 180
  const rho = projectedRadius(latitude)
  const x = rho * Math.sin(lon)
  const y = rho * Math.cos(lon)
  return {
    left: `${((x + MAP_EXTENT_M) / (2 * MAP_EXTENT_M)) * 100}%`,
    top: `${((MAP_EXTENT_M - y) / (2 * MAP_EXTENT_M)) * 100}%`,
  }
}

function latitudeRingRadius(latitude: number) {
  return (projectedRadius(latitude) / MAP_EXTENT_M) * 50
}

function inverseProject(xPercent: number, yPercent: number) {
  const x = (xPercent / 100 - 0.5) * 2 * MAP_EXTENT_M
  const y = (0.5 - yPercent / 100) * 2 * MAP_EXTENT_M
  const rho = Math.hypot(x, y)
  const latitude =
    ((2 * Math.atan(rho / (2 * MOON_RADIUS_M)) - Math.PI / 2) * 180) /
    Math.PI
  let longitude = (Math.atan2(x, y) * 180) / Math.PI
  if (longitude < 0) longitude += 360
  return { latitude, longitude }
}

function formatLatitude(value: number) {
  return `${Math.abs(value).toFixed(4)}° ${value < 0 ? 'S' : 'N'}`
}

function formatLongitude(value: number) {
  const normalized = ((value % 360) + 360) % 360
  const signed = normalized > 180 ? normalized - 360 : normalized
  return `${Math.abs(signed).toFixed(4)}° ${signed < 0 ? 'W' : 'E'}`
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <div className="metric-value">{value}</div>
    </div>
  )
}

function App() {
  const [selectedSiteId, setSelectedSiteId] = useState('shackleton')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [mode, setMode] = useState<'Planner' | 'Educator'>('Planner')
  const [layers, setLayers] = useState(initialLayers)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [mapAssetState, setMapAssetState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [cursorCoords, setCursorCoords] = useState<{ latitude: number; longitude: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const mapFrameRef = useRef<HTMLDivElement>(null)

  const selectedSite = useMemo(
    () => landingSites.find((site) => site.id === selectedSiteId) ?? landingSites[0],
    [selectedSiteId],
  )

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement !== null)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const toggleFullscreen = async () => {
    const element = viewportRef.current
    if (!element) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await element.requestFullscreen()
    } catch (error) {
      console.error('Could not change fullscreen mode:', error)
    }
  }

  const toggleLayer = (layer: LayerName) => {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }))
  }

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor))
      const ratio = nextZoom / zoom
      const cx = clientX - (rect.left + rect.width / 2)
      const cy = clientY - (rect.top + rect.height / 2)
      setPan({
        x: cx - (cx - pan.x) * ratio,
        y: cy - (cy - pan.y) * ratio,
      })
      setZoom(nextZoom)
    },
    [zoom, pan],
  )

  const changeZoom = (factor: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  const resetMap = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setCursorCoords(null)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    }
    setIsDragging(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current) {
      setPan({
        x: dragStart.current.panX + event.clientX - dragStart.current.x,
        y: dragStart.current.panY + event.clientY - dragStart.current.y,
      })
      return
    }

    const frame = mapFrameRef.current
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    const xPercent = ((event.clientX - rect.left) / rect.width) * 100
    const yPercent = ((event.clientY - rect.top) / rect.height) * 100
    const dx = xPercent - 50
    const dy = yPercent - 50

    // Do not report coordinates outside the circular 80°S map boundary.
    if (Math.hypot(dx, dy) > 50 || xPercent < 0 || xPercent > 100 || yPercent < 0 || yPercent > 100) {
      setCursorCoords(null)
      return
    }
    setCursorCoords(inverseProject(xPercent, yPercent))
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragStart.current = null
    setIsDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12)
  }

  const availableLayers: LayerName[] = [
    'LOLA hillshade',
    'Coordinate grid',
    'Candidate sites',
    'Elevation',
    'Slope',
    'Illumination',
    'PSR regions',
  ]

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-symbol"><Satellite size={20} strokeWidth={1.8} /></div>
          <div>
            <div className="brand-name">SELENE<span>-360</span></div>
            <div className="brand-subtitle">LUNAR SOUTH POLE NAVIGATION SYSTEM</div>
          </div>
        </div>
        <div className="header-center">
          <span>MISSION WORKSTATION</span>
          <span className="header-divider">/</span>
          <span className="header-build">GEOSPATIAL BUILD 0.4</span>
        </div>
        <div className="header-actions">
          <div className="mode-switch" aria-label="Application mode">
            <button className={mode === 'Planner' ? 'mode-button active' : 'mode-button'} aria-pressed={mode === 'Planner'} onClick={() => setMode('Planner')}>Planner</button>
            <button className={mode === 'Educator' ? 'mode-button active' : 'mode-button'} aria-pressed={mode === 'Educator'} onClick={() => setMode('Educator')}>Educator</button>
          </div>
        </div>
      </header>

      <div className="terminal-strip">
        <div><span className="strip-key">MISSION</span><strong>SELENE-360</strong></div>
        <div><span className="strip-key">BODY</span><strong>MOON / LUNA</strong></div>
        <div><span className="strip-key">REGION</span><strong>80°S — 90°S</strong></div>
        <div><span className="strip-key">BASE DATA</span><strong>NASA LOLA</strong></div>
      </div>

      <section className="workspace">
        <aside className="sidebar terminal-panel">
          <div className="panel-heading">
            <div><span className="section-kicker">01 / TARGET DATABASE</span><h2>Landing Sites</h2></div>
            <Target size={18} className="heading-icon" />
          </div>
          <p className="panel-description">NASA reference coordinates for named candidate regions. These points are not landing ellipses.</p>
          <div className="site-list">
            {landingSites.map((site, index) => (
              <button
                key={site.id}
                className={selectedSiteId === site.id ? 'site-card selected' : 'site-card'}
                onClick={() => setSelectedSiteId(site.id)}
              >
                <div className="site-card-top">
                  <span className="site-number">0{index + 1} · {site.siteCode}</span>
                  <span className={selectedSiteId === site.id ? 'site-indicator selected-indicator' : 'site-indicator'} />
                </div>
                <div className="site-name">{site.name}</div>
                <div className="site-region">{site.region.toUpperCase()} REGION</div>
                <div className="site-coordinate">{formatLatitude(site.latitude)} / {formatLongitude(site.longitude)}</div>
              </button>
            ))}
          </div>

          <div className="sidebar-divider" />
          <div className="panel-heading layer-heading">
            <div><span className="section-kicker">02 / VISUALIZATION</span><h2>Map Layers</h2></div>
            <Layers3 size={18} className="heading-icon" />
          </div>
          <div className="layer-list">
            {availableLayers.map((layer) => {
              const available = ['LOLA hillshade', 'Coordinate grid', 'Candidate sites'].includes(layer)
              const note = layer === 'Elevation' || layer === 'Slope' ? 'DEM processing pending' : 'dataset pending'
              return (
                <label className={`layer-option ${!available ? 'layer-unavailable' : ''}`} key={layer}>
                  <span>{layer}{!available && <small> · {note}</small>}</span>
                  <input type="checkbox" checked={layers[layer]} disabled={!available} onChange={() => toggleLayer(layer)} />
                </label>
              )
            })}
          </div>
          <div className="sidebar-footer">
            <div className="data-source-icon"><ShieldCheck size={16} /></div>
            <div>
              <div className="data-source-title">DATA PROVENANCE</div>
              <div className="data-source-text">NASA LOLA hillshade raster. Candidate reference points from NASA Lunar Surface Data Book.</div>
            </div>
          </div>
        </aside>

        <section className="map-column">
          <div className="map-toolbar terminal-panel">
            <div><span className="section-kicker">03 / GEOSPATIAL INTELLIGENCE</span><h1>Lunar South Pole</h1></div>
            <div className="map-toolbar-right">
              <div className="map-coordinate"><Crosshair size={14} /> SOUTH POLAR STEREOGRAPHIC</div>
              <div className="map-scale">80°S — 90°S</div>
            </div>
          </div>

          <div
            className={`map-viewport ${isDragging ? 'dragging' : ''}`}
            ref={viewportRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={() => { if (!dragStart.current) setCursorCoords(null) }}
            onWheel={handleWheel}
          >
            <div className="map-grid" />
            <div className="map-art" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              <div className="map-image-frame" ref={mapFrameRef}>
                {layers['LOLA hillshade'] && mapAssetState !== 'missing' ? (
                  <img
                    className="nasa-map-image"
                    src="/data/lola-south-pole-hillshade.png"
                    alt="NASA LOLA hillshade raster covering the lunar south polar region from 80 degrees south to 90 degrees south"
                    onLoad={() => setMapAssetState('ready')}
                    onError={() => setMapAssetState('missing')}
                    draggable={false}
                  />
                ) : (
                  <div className="map-asset-message">
                    {mapAssetState === 'missing'
                      ? 'NASA map image not found. Confirm public/data/lola-south-pole-hillshade.png exists.'
                      : 'LOLA hillshade layer is switched off.'}
                  </div>
                )}

                {layers['Coordinate grid'] && (
                  <svg className="coordinate-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="South polar latitude and longitude grid">
                    {[-85, -88, -89].map((latitude) => {
                      const radius = latitudeRingRadius(latitude)
                      return (
                        <g key={latitude}>
                          <circle cx="50" cy="50" r={radius} className="latitude-ring" />
                          <text x="52" y={50 - radius + 1.3} className="grid-label">{Math.abs(latitude)}°S</text>
                        </g>
                      )
                    })}
                    {[0, 90, 180, 270].map((angle) => {
                      const radians = (angle * Math.PI) / 180
                      return (
                        <line
                          key={angle}
                          x1="50"
                          y1="50"
                          x2={50 + 50 * Math.sin(radians)}
                          y2={50 - 50 * Math.cos(radians)}
                          className="longitude-ray"
                        />
                      )
                    })}
                    <line x1="47.5" y1="50" x2="52.5" y2="50" className="pole-crosshair" />
                    <line x1="50" y1="47.5" x2="50" y2="52.5" className="pole-crosshair" />
                    <circle cx="50" cy="50" r="1.15" className="pole-point" />
                    <text x="52" y="48" className="pole-label">90°S · SOUTH POLE</text>
                    <text x="50" y="3.2" textAnchor="middle" className="grid-label">0°</text>
                    <text x="96.5" y="51" textAnchor="end" className="grid-label">90°E</text>
                    <text x="50" y="98" textAnchor="middle" className="grid-label">180°</text>
                    <text x="3.5" y="51" className="grid-label">90°W</text>
                  </svg>
                )}

                {layers['Candidate sites'] && landingSites.map((site) => {
                  const position = projectSite(site.latitude, site.longitude)
                  return (
                    <button
                      key={site.id}
                      className={selectedSiteId === site.id ? 'map-site-pin active' : 'map-site-pin'}
                      style={position}
                      onClick={() => setSelectedSiteId(site.id)}
                      title={`${site.name} — ${formatLatitude(site.latitude)}, ${formatLongitude(site.longitude)}`}
                      aria-label={`Select ${site.name}`}
                    >
                      <span className="pin-core" />
                      <span className="pin-label">{site.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="map-overlay top-left">
              <div className="overlay-label">ACTIVE REGION</div>
              <div className="overlay-value">LUNAR SOUTH POLE</div>
            </div>
            <div className="map-overlay top-right">
              <div className="overlay-label">SELECTED TARGET</div>
              <div className="overlay-value">{selectedSite.name}</div>
            </div>
            <div className="map-overlay bottom-left cursor-readout">
              <div className="overlay-label">{cursorCoords ? 'CURSOR COORDINATES' : 'MAP REFERENCE'}</div>
              <div className="overlay-value">
                {cursorCoords
                  ? `${formatLatitude(cursorCoords.latitude)} · ${formatLongitude(cursorCoords.longitude)}`
                  : '90°S AT MAP CENTRE'}
              </div>
            </div>

            <div className="map-controls">
              <button className="map-control-button" title="Zoom in" aria-label="Zoom in" onClick={() => changeZoom(1.25)}><Plus size={17} /></button>
              <button className="map-control-button" title="Zoom out" aria-label="Zoom out" onClick={() => changeZoom(0.8)}><Minus size={17} /></button>
              <button className="map-control-button" title="Reset map view" aria-label="Reset map view" onClick={resetMap}><RotateCcw size={16} /></button>
              <button className="map-control-button fullscreen-button" title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={toggleFullscreen}>
                {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </button>
            </div>
            <div className="zoom-indicator">{Math.round(zoom * 100)}%</div>
            <div className="map-instruction"><Move size={11} /> DRAG TO PAN · SCROLL TO ZOOM</div>
          </div>

          <div className="map-source-strip">
            <Database size={13} />
            <strong>NASA GODDARD LOLA</strong>
            <span>South polar hillshade</span>
            <span>80°S–90°S coverage</span>
            <span>80 m/px source product</span>
          </div>

          <div className="map-legend terminal-panel">
            <div className="legend-item"><span className="legend-dot selected-dot" /> Selected reference point</div>
            <div className="legend-item"><span className="legend-dot candidate-dot" /> Other reference points</div>
            <div className="legend-item"><span className="legend-line" /> Latitude / longitude grid</div>
            <div className="legend-item"><span className="legend-pole" /> South Pole</div>
          </div>
        </section>

        <aside className="inspection-panel terminal-panel">
          <div className="panel-heading">
            <div><span className="section-kicker">04 / TARGET TELEMETRY</span><h2>Site Inspection</h2></div>
            <Activity size={18} className="heading-icon" />
          </div>
          <div className="selected-site-card">
            <div className="selected-site-tag">NASA REFERENCE FEATURE</div>
            <h3>{selectedSite.name}</h3>
            <p>{selectedSite.description}</p>
          </div>
          <div className="inspection-section">
            <div className="subsection-title">LOCATION DATA</div>
            <div className="coordinate-row"><span>Latitude</span><strong>{formatLatitude(selectedSite.latitude)}</strong></div>
            <div className="coordinate-row"><span>Longitude</span><strong>{formatLongitude(selectedSite.longitude)}</strong></div>
            <div className="coordinate-row"><span>Reference ID</span><strong>{selectedSite.siteCode}</strong></div>
            <div className="coordinate-row"><span>Coordinate source</span><strong>NASA Data Book</strong></div>
          </div>
          <div className="inspection-section">
            <div className="subsection-title">SITE CHARACTERISTICS</div>
            <div className="metric-grid">
              <Metric label="Elevation" value="Pending DEM" />
              <Metric label="Terrain type" value={selectedSite.terrain} />
              <Metric label="Illumination" value="Pending" />
              <Metric label="Communications" value="Pending" />
            </div>
          </div>
          <div className="readiness-card">
            <div className="readiness-header"><span>LANDING READINESS</span><span className="analysis-tag">NOT SCORED</span></div>
            <div className="readiness-score">—<span>/100</span></div>
            <div className="readiness-track"><div className="readiness-fill" /></div>
            <p>Scoring remains disabled until validated terrain, illumination, and communications analyses are integrated.</p>
          </div>
          <div className="source-note"><Database size={13} /><span>{selectedSite.source}</span></div>
        </aside>
      </section>

      <footer className="telemetry-bar">
        <div className="telemetry-heading"><span className="section-kicker">05 / MISSION TELEMETRY</span><span className="telemetry-status">ANALYSIS PENDING</span></div>
        <div className="telemetry-metrics">
          <div className="timeline-metric"><div className="timeline-icon"><Sun size={17} /></div><div><div className="timeline-label">SOLAR ILLUMINATION</div><div className="timeline-value">Awaiting analysis</div></div></div>
          <div className="timeline-metric"><div className="timeline-icon"><Radio size={17} /></div><div><div className="timeline-label">EARTH VISIBILITY</div><div className="timeline-value">Awaiting analysis</div></div></div>
          <div className="timeline-metric"><div className="timeline-icon"><Clock3 size={17} /></div><div><div className="timeline-label">MISSION WINDOW</div><div className="timeline-value">Not calculated</div></div></div>
          <div className="timeline-metric"><div className="timeline-icon"><Database size={17} /></div><div><div className="timeline-label">BASE DATA</div><div className="timeline-value">NASA LOLA</div></div></div>
        </div>
        <div className="footer-note">SELENE-360 · GEOSPATIAL BUILD 0.4 · SCIENTIFIC VALIDATION IN PROGRESS</div>
      </footer>
    </main>
  )
}

export default App
