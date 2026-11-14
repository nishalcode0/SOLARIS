
import {
  Body,
  HelioVector,
  RotationAxis,
} from 'astronomy-engine'

import {
  getHorizonAtAzimuth,
  type TerrainHorizonProfile,
} from './lolaElevation'


const SAMPLE_INTERVAL_HOURS = 1
const MS_PER_HOUR = 60 * 60 * 1000

 export type Vector3 = {
  x: number
  y: number
  z: number
}

export interface SolarPositionSample {
  timestamp: string
  solarElevationDeg: number
  solarAzimuthDeg: number
  geometricallySunlit: boolean
}

export interface LunarIlluminationAnalysis {
  startTime: string
  endTime: string
  durationDays: number
  sampleIntervalHours: number
  current: SolarPositionSample
  samples: SolarPositionSample[]
  illuminatedHours: number
  shadowHours: number
  illuminationPercent: number
  maxSolarElevationDeg: number
  minSolarElevationDeg: number
  method: 'SPHERICAL_HORIZON'
}

function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(
    vector.x,
    vector.y,
    vector.z,
  )

  if (length === 0) {
    throw new Error('Invalid zero-length solar vector.')
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  }
}

function degreesToRadians(degrees: number): number {
  return degrees * Math.PI / 180
}

function radiansToDegrees(radians: number): number {
  return radians * 180 / Math.PI
}

// Convert the Sun direction from J2000 equatorial
// coordinates into the Moon's IAU body-fixed frame.
// Convert a J2000 equatorial direction into the Moon's
// IAU body-fixed frame.
export function directionToMoonFixed(
  directionJ2000: Vector3,
  date: Date,
): Vector3 {
  const direction = normalize(directionJ2000)

  const axis = RotationAxis(Body.Moon, date)

  const alpha = degreesToRadians(axis.ra * 15)
  const delta = degreesToRadians(axis.dec)
  const spin = degreesToRadians(axis.spin)

  const cosAlpha = Math.cos(alpha)
  const sinAlpha = Math.sin(alpha)
  const cosDelta = Math.cos(delta)
  const sinDelta = Math.sin(delta)
  const cosSpin = Math.cos(spin)
  const sinSpin = Math.sin(spin)

  const primeMeridianZero: Vector3 = {
    x: -sinAlpha,
    y: cosAlpha,
    z: 0,
  }

  const ninetyEast: Vector3 = {
    x: -sinDelta * cosAlpha,
    y: -sinDelta * sinAlpha,
    z: cosDelta,
  }

  const northPole: Vector3 = {
    x: cosDelta * cosAlpha,
    y: cosDelta * sinAlpha,
    z: sinDelta,
  }

  const bodyX: Vector3 = {
    x:
      primeMeridianZero.x * cosSpin +
      ninetyEast.x * sinSpin,
    y:
      primeMeridianZero.y * cosSpin +
      ninetyEast.y * sinSpin,
    z:
      primeMeridianZero.z * cosSpin +
      ninetyEast.z * sinSpin,
  }

  const bodyY: Vector3 = {
    x:
      -primeMeridianZero.x * sinSpin +
      ninetyEast.x * cosSpin,
    y:
      -primeMeridianZero.y * sinSpin +
      ninetyEast.y * cosSpin,
    z:
      -primeMeridianZero.z * sinSpin +
      ninetyEast.z * cosSpin,
  }

  return normalize({
    x: dot(direction, bodyX),
    y: dot(direction, bodyY),
    z: dot(direction, northPole),
  })
}

export function calculateSolarPosition(
  latitude: number,
  longitude: number,
  date: Date = new Date(),
): SolarPositionSample {
    
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new Error(
  `Invalid lunar coordinates: latitude=${latitude}, longitude=${longitude}`,
)
  }

  const lat = degreesToRadians(latitude)
  const lon = degreesToRadians(longitude)

  const moonFromSun = HelioVector(Body.Moon, date)

const sun = directionToMoonFixed(
  {
    x: -moonFromSun.x,
    y: -moonFromSun.y,
    z: -moonFromSun.z,
  },
  date,
)

  // Local spherical surface reference frame.
  const surfaceNormal: Vector3 = {
    x: Math.cos(lat) * Math.cos(lon),
    y: Math.cos(lat) * Math.sin(lon),
    z: Math.sin(lat),
  }

  const east: Vector3 = {
    x: -Math.sin(lon),
    y: Math.cos(lon),
    z: 0,
  }

  const north: Vector3 = {
    x: -Math.sin(lat) * Math.cos(lon),
    y: -Math.sin(lat) * Math.sin(lon),
    z: Math.cos(lat),
  }

  const upComponent = Math.max(
    -1,
    Math.min(1, dot(sun, surfaceNormal)),
  )

  const solarElevationDeg = radiansToDegrees(
    Math.asin(upComponent),
  )

  const eastComponent = dot(sun, east)
  const northComponent = dot(sun, north)

  const solarAzimuthDeg = (
    radiansToDegrees(
      Math.atan2(eastComponent, northComponent),
    ) + 360
  ) % 360

  return {
    timestamp: date.toISOString(),
    solarElevationDeg,
    solarAzimuthDeg,
    geometricallySunlit: solarElevationDeg > 0,
  }
}

function illuminatedHoursBetween(
  elevationA: number,
  elevationB: number,
  intervalHours: number,
): number {
  if (elevationA >= 0 && elevationB >= 0) {
    return intervalHours
  }

  if (elevationA < 0 && elevationB < 0) {
    return 0
  }

  if (elevationA === 0) {
    return elevationB > 0 ? intervalHours : 0
  }

  if (elevationB === 0) {
    return elevationA > 0 ? intervalHours : 0
  }

  const crossingFraction =
    Math.abs(elevationA) /
    (Math.abs(elevationA) + Math.abs(elevationB))

  return elevationA > 0
    ? intervalHours * crossingFraction
    : intervalHours * (1 - crossingFraction)
}

export function analyzeLunarIllumination(
  latitude: number,
  longitude: number,
  startDate: Date = new Date(),
): LunarIlluminationAnalysis {
  const totalHours = 24

  const intervalMs =
    SAMPLE_INTERVAL_HOURS * MS_PER_HOUR

  const intervalCount = Math.ceil(
    totalHours / SAMPLE_INTERVAL_HOURS,
  )

  const samples: SolarPositionSample[] = []

  for (let i = 0; i <= intervalCount; i++) {
    const elapsedMs = Math.min(
      i * intervalMs,
      totalHours * MS_PER_HOUR,
    )

    const date = new Date(
      startDate.getTime() + elapsedMs,
    )

    samples.push(
      calculateSolarPosition(
        latitude,
        longitude,
        date,
      ),
    )
  }

  let illuminatedHours = 0

  for (let i = 0; i < samples.length - 1; i++) {
    const current = samples[i]
    const next = samples[i + 1]

    const intervalHours =
      (
        new Date(next.timestamp).getTime() -
        new Date(current.timestamp).getTime()
      ) / MS_PER_HOUR

    illuminatedHours += illuminatedHoursBetween(
      current.solarElevationDeg,
      next.solarElevationDeg,
      intervalHours,
    )
  }

  const shadowHours = totalHours - illuminatedHours

  const elevations = samples.map(
    (sample) => sample.solarElevationDeg,
  )

  return {
    startTime: samples[0].timestamp,
    endTime: samples[samples.length - 1].timestamp,
    durationDays: 1,
    sampleIntervalHours: SAMPLE_INTERVAL_HOURS,
    current: samples[0],
    samples,
    illuminatedHours,
    shadowHours,
    illuminationPercent:
      (illuminatedHours / totalHours) * 100,
    maxSolarElevationDeg: Math.max(...elevations),
    minSolarElevationDeg: Math.min(...elevations),
    method: 'SPHERICAL_HORIZON',
  }
}
export type TerrainVisibilityResult =
  | {
      status: 'visible-estimate'
      solarElevationDeg: number
      terrainHorizonDeg: number
      clearanceDeg: number
      azimuthDeg: number
      obstructionDistanceM: number
      method: 'EXPERIMENTAL_TERRAIN_HORIZON'
    }
  | {
      status: 'blocked-estimate'
      solarElevationDeg: number
      terrainHorizonDeg: number
      clearanceDeg: number
      azimuthDeg: number
      obstructionDistanceM: number
      method: 'EXPERIMENTAL_TERRAIN_HORIZON'
    }
  | {
      status: 'uncertain'
      reason: string
      method: 'EXPERIMENTAL_TERRAIN_HORIZON'
    }

export function calculateTerrainVisibility(
  solar: SolarPositionSample,
  profile: TerrainHorizonProfile,
): TerrainVisibilityResult {
  const uncertain = (reason: string): TerrainVisibilityResult => ({
    status: 'uncertain',
    reason,
    method: 'EXPERIMENTAL_TERRAIN_HORIZON',
  })

  if (
    !Number.isFinite(solar.solarElevationDeg) ||
    !Number.isFinite(solar.solarAzimuthDeg)
  ) {
    return uncertain('Solar position is invalid.')
  }

  if (
    !Number.isFinite(profile.azimuthStepDeg) ||
    profile.azimuthStepDeg <= 0 ||
    profile.bins.length === 0
  ) {
    return uncertain('Terrain horizon profile is invalid.')
  }

  // Check that both bins used for interpolation contain
  // at least one valid terrain sample.
  const normalizedAzimuth =
    ((solar.solarAzimuthDeg % 360) + 360) % 360

  const position =
    normalizedAzimuth / profile.azimuthStepDeg

  const lowerIndex =
    Math.floor(position) % profile.bins.length

  const upperIndex =
    (lowerIndex + 1) % profile.bins.length

  const lowerBin = profile.bins[lowerIndex]
  const upperBin = profile.bins[upperIndex]

  if (
    !lowerBin ||
    !upperBin ||
    lowerBin.validSamples <= 0 ||
    upperBin.validSamples <= 0
  ) {
    return uncertain(
      'Insufficient valid terrain samples near the Sun azimuth.',
    )
  }

  const horizon = getHorizonAtAzimuth(
    profile,
    solar.solarAzimuthDeg,
  )

  if (
    !horizon ||
    !Number.isFinite(horizon.horizonElevationDeg) ||
    !Number.isFinite(horizon.distanceM)
  ) {
    return uncertain('Terrain horizon is unavailable.')
  }

  const clearanceDeg =
    solar.solarElevationDeg -
    horizon.horizonElevationDeg

  const result = {
    solarElevationDeg: solar.solarElevationDeg,
    terrainHorizonDeg: horizon.horizonElevationDeg,
    clearanceDeg,
    azimuthDeg: normalizedAzimuth,
    obstructionDistanceM: horizon.distanceM,
    method: 'EXPERIMENTAL_TERRAIN_HORIZON' as const,
  }

  return clearanceDeg > 0
    ? { status: 'visible-estimate', ...result }
    : { status: 'blocked-estimate', ...result }
}
