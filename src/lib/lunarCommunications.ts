
import {
  Body,
  HelioVector,
} from 'astronomy-engine'

import {
  directionToMoonFixed,
  type Vector3,
} from './lunarIllumination'

import {
  getHorizonAtAzimuth,
  type TerrainHorizonProfile,
} from './lolaElevation'

export type EarthVisibilityStatus =
  | 'CLEAR'
  | 'TERRAIN_BLOCKED'
  | 'INSUFFICIENT_TERRAIN_DATA'

export type EarthGeometryRating =
  | 'POOR'
  | 'MODERATE'
  | 'GOOD'
  | 'EXCELLENT'
  | 'UNASSESSED'

export interface EarthVisibilityAnalysis {
  timestamp: string

  earthElevationDeg: number
  earthAzimuthDeg: number

  terrainHorizonElevationDeg: number | null
  clearanceAngleDeg: number | null

  earthDistanceKm: number

  visibility: EarthVisibilityStatus
  geometryRating: EarthGeometryRating

  method: 'LOLA_TERRAIN_HORIZON'
  referenceFrame: 'MOON_IAU_BODY_FIXED'
}

function dot(a: Vector3, b: Vector3): number {
  return (
    a.x * b.x +
    a.y * b.y +
    a.z * b.z
  )
}

function degreesToRadians(degrees: number): number {
  return degrees * Math.PI / 180
}

function radiansToDegrees(radians: number): number {
  return radians * 180 / Math.PI
}

function getEarthDirectionMoonFixed(
  date: Date,
): {
  direction: Vector3
  distanceKm: number
} {
  const earth = HelioVector(Body.Earth, date)
  const moon = HelioVector(Body.Moon, date)

  // Both vectors use the same heliocentric frame.
  // Subtract to obtain the Moon-to-Earth direction.
  const moonToEarth = {
    x: earth.x - moon.x,
    y: earth.y - moon.y,
    z: earth.z - moon.z,
  }

  const distanceAu = Math.hypot(
    moonToEarth.x,
    moonToEarth.y,
    moonToEarth.z,
  )

  const direction = directionToMoonFixed(
    moonToEarth,
    date,
  )

  return {
    direction,
    distanceKm: distanceAu * 149597870.7,
  }
}

function getGeometryRating(
  clearance: number | null,
): EarthGeometryRating {
  if (clearance === null) return 'UNASSESSED'

  if (clearance <= 0) return 'POOR'
  if (clearance < 5) return 'MODERATE'
  if (clearance < 15) return 'GOOD'

  return 'EXCELLENT'
}

export function calculateEarthVisibility(
  latitude: number,
  longitude: number,
  horizonProfile: TerrainHorizonProfile,
  date: Date = new Date(),
): EarthVisibilityAnalysis {
    console.log('COMMUNICATIONS ENGINE INPUT:', {
  latitude,
  longitude,
  latitudeType: typeof latitude,
  longitudeType: typeof longitude,
})
    if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error(
  `Invalid lunar coordinates: latitude=${latitude}, longitude=${longitude}`,
)
  }

  const earth = getEarthDirectionMoonFixed(date)

  const lat = degreesToRadians(latitude)
  const lon = degreesToRadians(longitude)

  // Local lunar surface reference frame.
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
    Math.min(1, dot(earth.direction, surfaceNormal)),
  )

  const earthElevationDeg = radiansToDegrees(
    Math.asin(upComponent),
  )

  const eastComponent = dot(earth.direction, east)
  const northComponent = dot(earth.direction, north)

  const earthAzimuthDeg = (
    radiansToDegrees(
      Math.atan2(eastComponent, northComponent),
    ) + 360
  ) % 360

  const terrain = getHorizonAtAzimuth(
    horizonProfile,
    earthAzimuthDeg,
  )

  if (!terrain) {
    return {
      timestamp: date.toISOString(),
      earthElevationDeg,
      earthAzimuthDeg,
      terrainHorizonElevationDeg: null,
      clearanceAngleDeg: null,
      earthDistanceKm: earth.distanceKm,
      visibility: 'INSUFFICIENT_TERRAIN_DATA',
      geometryRating: 'UNASSESSED',
      method: 'LOLA_TERRAIN_HORIZON',
      referenceFrame: 'MOON_IAU_BODY_FIXED',
    }
  }

  const clearanceAngleDeg =
    earthElevationDeg - terrain.horizonElevationDeg

  return {
    timestamp: date.toISOString(),

    earthElevationDeg,
    earthAzimuthDeg,

    terrainHorizonElevationDeg:
      terrain.horizonElevationDeg,

    clearanceAngleDeg,

    earthDistanceKm: earth.distanceKm,

    visibility:
      clearanceAngleDeg > 0
        ? 'CLEAR'
        : 'TERRAIN_BLOCKED',
    
        geometryRating: getGeometryRating(clearanceAngleDeg),

    method: 'LOLA_TERRAIN_HORIZON',
    referenceFrame: 'MOON_IAU_BODY_FIXED',
  }
}
