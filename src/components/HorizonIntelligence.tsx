
import {
  getHorizonAtAzimuth,
  type TerrainHorizonProfile,
} from '../lib/lolaElevation'

import './HorizonIntelligence.css'
import type { SolarPositionSample } from '../lib/lunarIllumination'
import type { EarthVisibilityAnalysis } from '../lib/lunarCommunications'

interface HorizonIntelligenceProps {
  latitude: number
  longitude: number
  simulationTime: Date
  profile: TerrainHorizonProfile | null
  solar: SolarPositionSample | null
  earth: EarthVisibilityAnalysis | null
  loading: boolean
  error: string | null
}

const SIZE = 340
const CENTER = SIZE / 2
const MIN_ELEVATION = -10
const MAX_ELEVATION = 45
const MIN_RADIUS = 35
const MAX_RADIUS = 135

function radiusForElevation(elevation: number) {
  const normalized = Math.max(
    0,
    Math.min(
      1,
      (elevation - MIN_ELEVATION) /
        (MAX_ELEVATION - MIN_ELEVATION),
    ),
  )

  return MIN_RADIUS + normalized * (MAX_RADIUS - MIN_RADIUS)
}

function polarPoint(azimuth: number, elevation: number) {
  const angle = (azimuth * Math.PI) / 180
  const radius = radiusForElevation(elevation)

  return {
    x: CENTER + radius * Math.sin(angle),
    y: CENTER - radius * Math.cos(angle),
  }
}

function formatDegrees(value: number | null | undefined) {
  return Number.isFinite(value) ? `${value!.toFixed(1)}°` : '—'
}

export default function HorizonIntelligence({
  latitude,
  longitude,
  simulationTime,
  profile,
  solar,
  earth,
  loading,
  error,
}: HorizonIntelligenceProps) {
  const horizonPath = profile
    ? profile.bins
        .filter((bin) =>
          Number.isFinite(bin.horizonElevationDeg),
        )
        .map((bin, index) => {
          const point = polarPoint(
            bin.azimuthDeg,
            bin.horizonElevationDeg,
          )

          return `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
        })
        .join(' ')
    : ''

  const sunHorizon = solar && profile
    ? getHorizonAtAzimuth(profile, solar.solarAzimuthDeg)
    : null

  const sunVisible = solar && sunHorizon
    ? solar.solarElevationDeg > sunHorizon.horizonElevationDeg
    : null

  const sunPoint = solar
    ? polarPoint(
        solar.solarAzimuthDeg,
        solar.solarElevationDeg,
      )
    : null

  const earthPoint = earth
    ? polarPoint(
        earth.earthAzimuthDeg,
        earth.earthElevationDeg,
      )
    : null

  return (
    <section className="horizon-intelligence">
      <header className="horizon-header">
        <div>
          <span className="horizon-eyebrow">
            SOLARIS / TERRAIN INTELLIGENCE
          </span>
          <h2>Horizon Intelligence</h2>
          <p>
            Terrain obstruction and celestial visibility
          </p>
        </div>

        <span className="horizon-live-indicator">
          {loading ? 'ANALYSING' : 'SITE ANALYSIS'}
        </span>
      </header>

      {loading && (
        <p className="horizon-message">
          Calculating terrain horizon from LOLA elevation data…
        </p>
      )}

      {error && (
        <p className="horizon-error">{error}</p>
      )}

      {!loading && !error && !profile && (
        <p className="horizon-message">
          Select a location to calculate its terrain horizon.
        </p>
      )}

      {profile && (
        <>
          <div className="horizon-chart-wrap">
            <svg
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              className="horizon-chart"
              role="img"
              aria-label="Circular terrain horizon plot. North is at the top and azimuth increases clockwise."
            >
              <defs>
                <linearGradient
                  id="horizonTerrainGradient"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="#f29b62" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#f29b62" stopOpacity="0.04" />
                </linearGradient>
              </defs>

              {[0, 10, 20, 30, 40].map((elevation) => {
                const radius = radiusForElevation(elevation)

                return (
                  <g key={elevation}>
                    <circle
                      cx={CENTER}
                      cy={CENTER}
                      r={radius}
                      fill="none"
                      stroke="#8c969c"
                      strokeOpacity="0.3"
                      strokeDasharray="3 5"
                    />
                    <text
                      x={CENTER + 5}
                      y={CENTER - radius + 12}
                      fill="#7c858b"
                      fontSize="9"
                    >
                      {elevation}°
                    </text>
                  </g>
                )
              })}

              {[0, 45, 90, 135].map((azimuth) => {
                const angle = (azimuth * Math.PI) / 180
                const x = CENTER + MAX_RADIUS * Math.sin(angle)
                const y = CENTER - MAX_RADIUS * Math.cos(angle)

                return (
                  <line
                    key={azimuth}
                    x1={CENTER}
                    y1={CENTER}
                    x2={x}
                    y2={y}
                    stroke="#8c969c"
                    strokeOpacity="0.25"
                    strokeDasharray="3 5"
                  />
                )
              })}

              {horizonPath && (
                <path
                  d={horizonPath}
                  fill="none"
                  stroke="#f09a60"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
              )}

              {sunPoint && (
                <g>
                  <line
                    x1={CENTER}
                    y1={CENTER}
                    x2={sunPoint.x}
                    y2={sunPoint.y}
                    stroke="#e6ad36"
                    strokeOpacity="0.45"
                    strokeDasharray="4 4"
                  />
                  <circle
                    cx={sunPoint.x}
                    cy={sunPoint.y}
                    r="7"
                    fill="#f4bd45"
                    stroke="#fff4d7"
                    strokeWidth="2"
                  />
                </g>
              )}

              {earthPoint && (
                <g>
                  <line
                    x1={CENTER}
                    y1={CENTER}
                    x2={earthPoint.x}
                    y2={earthPoint.y}
                    stroke="#64a8d8"
                    strokeOpacity="0.5"
                    strokeDasharray="4 4"
                  />
                  <circle
                    cx={earthPoint.x}
                    cy={earthPoint.y}
                    r="6"
                    fill="#64a8d8"
                    stroke="#e2f2ff"
                    strokeWidth="2"
                  />
                </g>
              )}

              <circle
                cx={CENTER}
                cy={CENTER}
                r="3"
                fill="#263c50"
              />

              <text
                x={CENTER}
                y="17"
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill="currentColor"
              >
                N
              </text>
              <text
                x={SIZE - 15}
                y={CENTER + 4}
                textAnchor="middle"
                fontSize="10"
                fill="currentColor"
              >
                E
              </text>
              <text
                x={CENTER}
                y={SIZE - 7}
                textAnchor="middle"
                fontSize="10"
                fill="currentColor"
              >
                S
              </text>
              <text
                x="15"
                y={CENTER + 4}
                textAnchor="middle"
                fontSize="10"
                fill="currentColor"
              >
                W
              </text>
            </svg>
          </div>

          <div className="horizon-legend">
            <span><i className="legend-terrain" /> TERRAIN HORIZON</span>
            <span><i className="legend-sun" /> SUN</span>
            <span><i className="legend-earth" /> EARTH</span>
          </div>

          <div className="horizon-readouts">
            <article>
              <span className="readout-label">SUN ELEVATION</span>
              <strong>{formatDegrees(solar?.solarElevationDeg)}</strong>
              <small>
                AZ {formatDegrees(solar?.solarAzimuthDeg)}
              </small>
              <small>
                {sunVisible === null
                  ? 'VISIBILITY UNASSESSED'
                  : sunVisible
                    ? 'ABOVE TERRAIN HORIZON'
                    : 'BELOW TERRAIN HORIZON'}
              </small>
            </article>

            <article>
              <span className="readout-label">EARTH ELEVATION</span>
              <strong>{formatDegrees(earth?.earthElevationDeg)}</strong>
              <small>
                AZ {formatDegrees(earth?.earthAzimuthDeg)}
              </small>
              <small>
                {earth?.visibility === 'CLEAR'
                  ? 'GEOMETRIC LINE OF SIGHT'
                  : earth?.visibility === 'TERRAIN_BLOCKED'
                    ? 'TERRAIN OBSTRUCTED'
                    : 'VISIBILITY UNASSESSED'}
              </small>
            </article>
          </div>

          <footer className="horizon-footer">
            <span>
              COVERAGE: {profile.coveragePercent.toFixed(1)}%
            </span>
            <span>
              RANGE: {(profile.maxDistanceM / 1000).toFixed(0)} KM
            </span>
            <span>
              RESOLUTION: {profile.sampleStepM} M
            </span>
          </footer>

          <p className="horizon-location">
            {latitude.toFixed(4)}° · {longitude.toFixed(4)}°
            <span>{simulationTime.toLocaleString()}</span>
          </p>
        </>
      )}
    </section>
  )
}
