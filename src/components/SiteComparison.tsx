
import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Compass,
  Database,
  Globe2,
  Mountain,
  Sun,
  X,
} from 'lucide-react'

import {
  sampleElevation,
  sampleSlope,
  sampleTerrainHorizon,
  type ElevationSample,
  type SlopeSample,
  type TerrainHorizonProfile,
} from '../lib/lolaElevation'

import { samplePSR, type PSRSample } from '../lib/lunarPSR'
import MatplotlibComparison from './MatplotlibComparison'

import {
  analyzeLunarIllumination,
  type LunarIlluminationAnalysis,
} from '../lib/lunarIllumination'

import {
  calculateEarthVisibility,
  type EarthVisibilityAnalysis,
} from '../lib/lunarCommunications'

import { evaluateMissionDecision } from '../lib/missionDecision'
import { buildLunarResourceAssessment } from '../lib/lunarResources'
import type { ShadowStatus } from '../types/lunarResources'

type ComparisonSite = {
  id: string
  name: string
  code: string
  latitude: number
  longitude: number
  terrain: string
  description: string
  source: string
}

type SiteResult = {
  site: ComparisonSite
  elevation: ElevationSample
  slope: SlopeSample
  horizon: TerrainHorizonProfile | null
  psr: PSRSample
  shadowStatus: ShadowStatus
  illumination: LunarIlluminationAnalysis | null
  communications: EarthVisibilityAnalysis | null
  decision: ReturnType<typeof evaluateMissionDecision>
  errors: string[]
}

type Props = {
  sites: ComparisonSite[]
  simulationTime: Date
  onClose: () => void
  onRemoveSite: (siteId: string) => void
  assessShadow: (latitude: number, longitude: number) => ShadowStatus
}

function unavailableElevation(): ElevationSample {
  return { status: 'no-data' }
}

function unavailableSlope(): SlopeSample {
  return { status: 'no-data' }
}

function unavailablePSR(): PSRSample {
  return { status: 'unavailable' }
}

function formatNumber(
  value: number | null | undefined,
  digits = 1,
) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return 'N/A'
  }

  return value.toFixed(digits)
}

function statusClass(status: string) {
  return status.toLowerCase().replaceAll(' ', '-')
}



/* -------------------------------------------------------
   METRIC COMPONENT
------------------------------------------------------- */

function Metric({
  label,
  value,
  unit,
  detail,
}: {
  label: string
  value: string
  unit?: string
  detail?: string
}) {
  return (
    <div className="compare-metric">
      <span className="compare-metric-label">
        {label}
      </span>

      <strong>
        {value}
        {unit && <small>{unit}</small>}
      </strong>

      {detail && (
        <span className="compare-metric-detail">
          {detail}
        </span>
      )}
    </div>
  )
}

/* -------------------------------------------------------
   DECISION BADGE
------------------------------------------------------- */

function DecisionBadge({
  status,
}: {
  status: string
}) {
  const Icon =
    status === 'GO'
      ? CheckCircle2
      : status === 'NO-GO'
        ? CircleAlert
        : Activity

  return (
    <span className={`compare-decision ${statusClass(status)}`}>
      <Icon size={15} />
      {status}
    </span>
  )
}

/* -------------------------------------------------------
   INDEPENDENT SITE ANALYSIS
------------------------------------------------------- */

async function analyzeSite(
  site: ComparisonSite,
  simulationTime: Date,
  assessShadow: Props['assessShadow'],
): Promise<SiteResult> {
  const errors: string[] = []

  const [
    elevationResult,
    slopeResult,
    horizonResult,
    psrResult,
  ] = await Promise.allSettled([
    sampleElevation(site.latitude, site.longitude),
    sampleSlope(site.latitude, site.longitude),
    sampleTerrainHorizon(site.latitude, site.longitude),
    samplePSR(site.latitude, site.longitude),
  ])

  const elevation =
    elevationResult.status === 'fulfilled'
      ? elevationResult.value
      : unavailableElevation()

  const slope =
    slopeResult.status === 'fulfilled'
      ? slopeResult.value
      : unavailableSlope()

  const horizon =
    horizonResult.status === 'fulfilled'
      ? horizonResult.value
      : null

  const psr =
    psrResult.status === 'fulfilled'
      ? psrResult.value
      : unavailablePSR()

  if (elevationResult.status === 'rejected') {
    errors.push('Elevation sampling failed')
  }

  if (slopeResult.status === 'rejected') {
    errors.push('Slope analysis failed')
  }

  if (horizonResult.status === 'rejected') {
    errors.push('Terrain horizon analysis unavailable')
  }

  if (psrResult.status === 'rejected') {
    errors.push('PSR raster sampling failed')
  }

  let illumination: LunarIlluminationAnalysis | null = null

  try {
    illumination = analyzeLunarIllumination(
      site.latitude,
      site.longitude,
      simulationTime,
    )
  } catch {
    errors.push('Solar illumination calculation failed')
  }

  let communications: EarthVisibilityAnalysis | null = null

  if (horizon) {
    try {
      communications = calculateEarthVisibility(
        site.latitude,
        site.longitude,
        horizon,
        simulationTime,
      )
    } catch {
      errors.push('Earth visibility calculation failed')
    }
  }

  const shadowStatus = assessShadow(
    site.latitude,
    site.longitude,
  )

  const decision = evaluateMissionDecision({
    elevationAvailable: elevation.status === 'available',
    slopeAvailable: slope.status === 'available',
    slopeDeg:
      slope.status === 'available'
        ? slope.slopeDeg
        : null,
    horizonAvailable: horizon !== null,
    communicationsAvailable: communications !== null,
    earthVisibility: communications?.visibility ?? null,
    illuminationAvailable: illumination !== null,
    illuminationPercent:
      illumination?.illuminationPercent ?? null,
    psrAssessmentAvailable:
      shadowStatus !== 'insufficient-data',
    waterIceObservationsAvailable: false,
  })

  buildLunarResourceAssessment(
    site.latitude,
    site.longitude,
    elevation,
    slope,
    horizon,
    psr,
    shadowStatus,
  )

  return {
    site,
    elevation,
    slope,
    horizon,
    psr,
    shadowStatus,
    illumination,
    communications,
    decision,
    errors,
  }
}

/* -------------------------------------------------------
   MAIN SITE COMPARISON
------------------------------------------------------- */

export default function SiteComparison({
  sites,
  simulationTime,
  onClose,
  onRemoveSite,
  assessShadow,
}: Props) {
  const [results, setResults] = useState<SiteResult[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSiteId, setActiveSiteId] = useState(
    sites[0]?.id ?? '',
  )

  // Keep the active selection valid when a site is removed.
  useEffect(() => {
    if (!sites.some((site) => site.id === activeSiteId)) {
      setActiveSiteId(sites[0]?.id ?? '')
    }
  }, [sites, activeSiteId])

  // Recalculate whenever the selected sites or simulation time changes.
  useEffect(() => {
    let active = true

    async function runComparison() {
      setLoading(true)
      setResults([])

      const calculated = await Promise.all(
        sites.map((site) =>
          analyzeSite(site, simulationTime, assessShadow),
        ),
      )

      if (active) {
        setResults(calculated)
        setLoading(false)
      }
    }

    void runComparison()

    return () => {
      active = false
    }
  }, [sites, simulationTime, assessShadow])

    // Prepare measured and calculated results for the Python Matplotlib service.
  const plotSites = useMemo(
    () =>
      results.map((result) => ({
        name: result.site.name,

        elevationM:
          result.elevation.status === 'available'
            ? result.elevation.elevationM
            : null,

        slopeDeg:
          result.slope.status === 'available'
            ? result.slope.slopeDeg
            : null,

        horizonBins: result.horizon?.bins ?? [],

        illuminationSamples:
          result.illumination?.samples.map((sample) => ({
            timestamp: sample.timestamp,
            solarElevationDeg: sample.solarElevationDeg,
          })) ?? [],

        illuminationPercent:
          result.illumination?.illuminationPercent ?? null,

        earthElevationDeg:
          result.communications?.earthElevationDeg ?? null,

        earthAzimuthDeg:
          result.communications?.earthAzimuthDeg ?? null,

        terrainClearanceDeg:
          result.communications?.clearanceAngleDeg ?? null,

        earthVisibility:
          result.communications?.visibility ?? null,

        psrStatus: result.shadowStatus,

        decisionStatus: result.decision.status,

        decisionScore: result.decision.score,

        coveragePercent: result.decision.coveragePercent,
      })),
    [results],
  )

  const activeResult = useMemo(
    () =>
      results.find(
        (result) => result.site.id === activeSiteId,
      ) ?? results[0],
    [results, activeSiteId],
  )

  const bestIllumination = useMemo(() => {
    const available = results.filter(
      (result) => result.illumination,
    )

    if (!available.length) return null

    return available.reduce((best, current) =>
      (current.illumination?.illuminationPercent ?? -1) >
      (best.illumination?.illuminationPercent ?? -1)
        ? current
        : best,
    )
  }, [results])

  const lowestSlope = useMemo(() => {
    const available = results.filter(
      (result) => result.slope.status === 'available',
    )

    if (!available.length) return null

    return available.reduce((best, current) =>
      current.slope.status === 'available' &&
      best.slope.status === 'available' &&
      current.slope.slopeDeg < best.slope.slopeDeg
        ? current
        : best,
    )
  }, [results])

  return (
    <div className="site-comparison-overlay">
      <header className="compare-header">
        <div className="compare-brand">
          <div className="compare-brand-mark">
            <Compass size={21} />
          </div>

          <div>
            <span className="compare-eyebrow">
              SOLARIS / MISSION ANALYSIS
            </span>
            <h1>Candidate comparison</h1>
          </div>
        </div>

        <div className="compare-header-right">
          <span className="compare-site-count">
            {sites.length} / 3 LOCATIONS
          </span>

          <button
            className="compare-close"
            onClick={onClose}
            aria-label="Close comparison"
          >
            <X size={19} />
            CLOSE
          </button>
        </div>
      </header>

      {loading ? (
        <main className="compare-loading">
          <div className="compare-loader" />

          <span className="compare-eyebrow">
            RUNNING INDEPENDENT SITE ANALYSES
          </span>

          <h2>Calculating lunar conditions</h2>

          <p>
            Sampling LOLA terrain, slope, terrain horizon,
            PSR context, solar illumination, and Earth
            visibility for each candidate.
          </p>

          <div className="compare-loading-sites">
            {sites.map((site) => (
              <span key={site.id}>{site.name}</span>
            ))}
          </div>
        </main>
      ) : sites.length === 0 ? (
        <main className="compare-loading">
          <Compass size={36} />

          <span className="compare-eyebrow">
            COMPARISON WORKSPACE
          </span>

          <h2>No comparison sites selected</h2>

          <p>
            Close this panel and add locations from the lunar
            map or candidate list. You can compare up to three
            locations at once.
          </p>

          <button
            className="compare-close"
            onClick={onClose}
          >
            <ArrowLeft size={16} />
            RETURN TO MAP
          </button>
        </main>
      ) : (
        <main className="compare-main">
          <section className="compare-overview">
            <div>
              <span className="compare-eyebrow">
                COMPARATIVE SCREENING
              </span>

              <h2>
                {sites.length === 3
                  ? 'Three locations. One consistent model.'
                  : `${sites.length} selected location${sites.length === 1 ? '' : 's'}. One consistent model.`}
              </h2>

              <p>
                Measurements are evaluated using the same
                methods and preliminary screening thresholds
                at every selected location.
              </p>
            </div>

            <div className="compare-overview-insights">
              <div>
                <Sun size={17} />
                <span>Highest illumination</span>
                <strong>
                  {bestIllumination?.site.name ?? 'Not available'}
                </strong>
              </div>

              <div>
                <Mountain size={17} />
                <span>Lowest measured slope</span>
                <strong>
                  {lowestSlope?.site.name ?? 'Not available'}
                </strong>
              </div>
            </div>
          </section>

          <section className="compare-decision-grid">
            {results.map((result) => (
              <div
                key={result.site.id}
                className={`compare-site-card ${
                  activeResult?.site.id === result.site.id
                    ? 'active'
                    : ''
                }`}
              >
                <button
                  type="button"
                  className="compare-remove-site"
                  onClick={() => onRemoveSite(result.site.id)}
                  aria-label={`Remove ${result.site.name} from comparison`}
                  title="Remove this comparison site"
                >
                  REMOVE ×
                </button>

                <button
                  type="button"
                  className="compare-site-select"
                  onClick={() => setActiveSiteId(result.site.id)}
                >
                  <div className="compare-site-card-top">
                    <span>{result.site.code}</span>
                    <DecisionBadge status={result.decision.status} />
                  </div>

                  <h3>{result.site.name}</h3>

                  <p>
                    {result.site.latitude.toFixed(4)}°,
                    {' '}
                    {result.site.longitude.toFixed(4)}°
                  </p>

                  <div className="compare-card-metrics">
                    <span>
                      SLOPE
                      <strong>
                        {result.slope.status === 'available'
                          ? `${formatNumber(result.slope.slopeDeg)}°`
                          : 'N/A'}
                      </strong>
                    </span>

                    <span>
                      ILLUMINATION
                      <strong>
                        {result.illumination
                          ? `${formatNumber(result.illumination.illuminationPercent)}%`
                          : 'N/A'}
                      </strong>
                    </span>

                    <span>
                      EARTH LOS
                      <strong>
                        {result.communications?.visibility ?? 'N/A'}
                      </strong>
                    </span>
                  </div>

                  <span className="compare-card-action">
                    INSPECT SITE <ArrowLeft size={13} />
                  </span>
                </button>
              </div>
            ))}
          </section>

          {activeResult && (
            <>
              <section className="compare-section-heading">
                <div>
                  <span className="compare-eyebrow">
                    DETAILED SITE INSPECTION
                  </span>
                  <h2>{activeResult.site.name}</h2>
                </div>

                <DecisionBadge
                  status={activeResult.decision.status}
                />
              </section>

              <section className="compare-detail-grid">
                <div className="compare-panel compare-metrics-panel">
                  <div className="compare-panel-heading">
                    <Database size={17} />
                    <h3>Terrain & resource context</h3>
                  </div>

                  <div className="compare-metric-grid">
                    <Metric
                      label="Elevation"
                      value={
                        activeResult.elevation.status === 'available'
                          ? formatNumber(
                              activeResult.elevation.elevationM,
                              0,
                            )
                          : 'N/A'
                      }
                      unit="m"
                      detail="NASA LOLA · 80 m/pixel"
                    />

                    <Metric
                      label="Local slope"
                      value={
                        activeResult.slope.status === 'available'
                          ? formatNumber(
                              activeResult.slope.slopeDeg,
                            )
                          : 'N/A'
                      }
                      unit="°"
                      detail="Horn 3×3 terrain gradient"
                    />

                    <Metric
                      label="Horizon coverage"
                      value={
                        activeResult.horizon
                          ? formatNumber(
                              activeResult.horizon.coveragePercent,
                            )
                          : 'N/A'
                      }
                      unit="%"
                      detail="Terrain horizon samples"
                    />

                    <Metric
                      label="PSR context"
                      value={
                        activeResult.shadowStatus === 'inside-mapped-psr'
                          ? 'INSIDE'
                          : activeResult.shadowStatus === 'outside-mapped-psr'
                            ? 'OUTSIDE'
                            : 'UNASSESSED'
                      }
                      detail="Mapped PSR polygon membership"
                    />
                  </div>

                  <div className="compare-data-note">
                    <strong>
                      Water-ice observations: NOT INTEGRATED
                    </strong>

                    <p>
                      PSR membership is contextual evidence only.
                      It does not confirm water ice. LEND, Diviner,
                      and Mini-RF observations are not yet integrated.
                    </p>
                  </div>
                </div>

                <div className="compare-panel">
                  <div className="compare-panel-heading">
                    <Globe2 size={17} />
                    <h3>Earth communications geometry</h3>
                  </div>

                  {activeResult.communications ? (
                    <div className="compare-metric-grid">
                      <Metric
                        label="Earth elevation"
                        value={formatNumber(
                          activeResult.communications.earthElevationDeg,
                        )}
                        unit="°"
                      />

                      <Metric
                        label="Earth azimuth"
                        value={formatNumber(
                          activeResult.communications.earthAzimuthDeg,
                        )}
                        unit="°"
                      />

                      <Metric
                        label="Terrain clearance"
                        value={formatNumber(
                          activeResult.communications.clearanceAngleDeg,
                        )}
                        unit="°"
                      />

                      <Metric
                        label="Geometry rating"
                        value={
                          activeResult.communications.geometryRating
                        }
                      />
                    </div>
                  ) : (
                    <div className="compare-unavailable">
                      <CircleAlert size={18} />
                      Earth visibility unavailable because
                      terrain-horizon analysis could not be completed.
                    </div>
                  )}

                  <div className="compare-data-note">
                    <strong>
                      {activeResult.communications?.visibility ??
                        'UNASSESSED'}
                    </strong>

                    <p>
                      Geometric line-of-sight screening only.
                      This is not an RF link budget or
                      communications availability guarantee.
                    </p>
                  </div>
                </div>
              </section>

              <section className="compare-section-heading">
                <div>
                  <span className="compare-eyebrow">
                    24-HOUR FORECAST
                  </span>
                  <h2>Solar illumination profile</h2>
                </div>

                <div className="compare-forecast-stats">
                  <span>
                    <Sun size={15} />
                    {formatNumber(
                      activeResult.illumination?.illuminationPercent,
                    )}% illuminated
                  </span>

                  <span>
                    <Clock3 size={15} />
                    {formatNumber(
                      activeResult.illumination?.illuminatedHours,
                    )} h sunlit
                  </span>

                  <span>
                    {formatNumber(
                      activeResult.illumination?.shadowHours,
                    )} h shadow
                  </span>
                </div>
              </section>

                            <section className="compare-panel compare-chart-panel">
                <MatplotlibComparison sites={plotSites} />
              </section>

              <section className="compare-panel compare-decision-panel">
                <div className="compare-panel-heading">
                  <Activity size={17} />
                  <h3>Mission screening findings</h3>
                  <DecisionBadge
                    status={activeResult.decision.status}
                  />
                </div>

                <div className="compare-decision-summary">
                  <div>
                    <span>DATA COVERAGE</span>
                    <strong>
                      {activeResult.decision.coveragePercent}%
                    </strong>
                  </div>

                  <div>
                    <span>CONFIDENCE</span>
                    <strong>
                      {activeResult.decision.confidence}
                    </strong>
                  </div>

                  <div>
                    <span>EVALUATED CRITERIA</span>
                    <strong>
                      {activeResult.decision.evaluatedCriteria}/
                      {activeResult.decision.totalCriteria}
                    </strong>
                  </div>

                  <div>
                    <span>SCREENING SCORE</span>
                    <strong>
                      {activeResult.decision.score === null
                        ? 'N/A'
                        : `${activeResult.decision.score}/100`}
                    </strong>
                  </div>
                </div>

                <p className="compare-decision-explanation">
                  {activeResult.decision.explanation}
                </p>

                <div className="compare-findings">
                  {activeResult.decision.findings.map(
                    (finding, index) => (
                      <div
                        className={`compare-finding ${finding.severity.toLowerCase()}`}
                        key={`${finding.category}-${index}`}
                      >
                        <span>{finding.severity}</span>

                        <div>
                          <strong>{finding.category}</strong>
                          <p>{finding.message}</p>
                        </div>
                      </div>
                    ),
                  )}
                </div>

                {activeResult.errors.length > 0 && (
                  <div className="compare-data-note">
                    <strong>ANALYSIS WARNINGS</strong>

                    {activeResult.errors.map((error) => (
                      <p key={error}>{error}</p>
                    ))}
                  </div>
                )}

                <p className="compare-disclaimer">
                  Preliminary comparative screening only.
                  This is not a landing-site certification,
                  engineering safety case, or NASA mission
                  approval. Thresholds are configurable project
                  assumptions, not official NASA landing criteria.
                </p>
              </section>
            </>
          )}
        </main>
      )}
    </div>
  )
}
