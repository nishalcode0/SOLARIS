
import { fromUrl } from 'geotiff'

const TIFF_URL = '/data/LDEM_80S_80MPP_ADJ.TIF'

const MOON_RADIUS_M = 1_737_400
const PIXEL_SIZE_M = 80
const RASTER_ORIGIN_X = -304_000
const RASTER_ORIGIN_Y = 304_000
const RASTER_WIDTH = 7600
const RASTER_HEIGHT = 7600
const COVERAGE_RADIUS_M = 304_000

export type ElevationSample =
  | {
      status: 'available'
      elevationM: number
      pixelColumn: number
      pixelRow: number
      pixelSpacingM: number
      source: string
    }
  | {
      status: 'outside-coverage'
    }
  | {
      status: 'no-data'
    }

let imagePromise: ReturnType<typeof loadElevationImage> | null = null

async function loadElevationImage() {
  const tiff = await fromUrl(TIFF_URL)
  const image = await tiff.getImage(0)

  if (
    image.getWidth() !== RASTER_WIDTH ||
    image.getHeight() !== RASTER_HEIGHT
  ) {
    throw new Error('Unexpected NASA LOLA elevation raster dimensions.')
  }

  return image
}

function getElevationImage() {
  if (!imagePromise) {
    imagePromise = loadElevationImage().catch((error) => {
      imagePromise = null
      throw error
    })
  }

  return imagePromise
}

function projectedCoordinates(latitude: number, longitude: number) {
  const latitudeRadians = latitude * Math.PI / 180
  const longitudeRadians = longitude * Math.PI / 180

  const rho =
    2 *
    MOON_RADIUS_M *
    Math.tan(Math.PI / 4 + latitudeRadians / 2)

  return {
    x: rho * Math.sin(longitudeRadians),
    y: rho * Math.cos(longitudeRadians),
    rho,
  }
}

export async function sampleElevation(
  latitude: number,
  longitude: number,
): Promise<ElevationSample> {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > -80
  ) {
    return { status: 'outside-coverage' }
  }

  const projected = projectedCoordinates(latitude, longitude)

  if (projected.rho > COVERAGE_RADIUS_M) {
    return { status: 'outside-coverage' }
  }

  const pixelColumn = Math.floor(
    (projected.x - RASTER_ORIGIN_X) / PIXEL_SIZE_M,
  )

  const pixelRow = Math.floor(
    (RASTER_ORIGIN_Y - projected.y) / PIXEL_SIZE_M,
  )

  if (
    pixelColumn < 0 ||
    pixelColumn >= RASTER_WIDTH ||
    pixelRow < 0 ||
    pixelRow >= RASTER_HEIGHT
  ) {
    return { status: 'outside-coverage' }
  }

  const image = await getElevationImage()

  const raster = await image.readRasters({
    window: [
      pixelColumn,
      pixelRow,
      pixelColumn + 1,
      pixelRow + 1,
    ],
    samples: [0],
    interleave: true,
  }) as Float32Array

  const elevationM = Number(raster[0])

  if (!Number.isFinite(elevationM)) {
    return { status: 'no-data' }
  }

  return {
    status: 'available',
    elevationM,
    pixelColumn,
    pixelRow,
    pixelSpacingM: PIXEL_SIZE_M,
    source: 'NASA LOLA LDEM_80S_80MPP_ADJ',
  }
}

const LUNAR_RADIUS_M = 1_737_400
const HORIZON_MAX_DISTANCE_M = 20_000
const HORIZON_SAMPLE_STEP_M = 160
const HORIZON_AZIMUTH_STEP_DEG = 5

export interface TerrainHorizonBin {
  azimuthDeg: number
  horizonElevationDeg: number
  distanceM: number
  validSamples: number
}

export interface TerrainHorizonProfile {
  observerElevationM: number
  maxDistanceM: number
  sampleStepM: number
  azimuthStepDeg: number
  bins: TerrainHorizonBin[]
  validSamples: number
  missingSamples: number
  coveragePercent: number
  source: string
  method: 'LOLA_DEM_SPHERICAL_GEOMETRY'
}

function destinationPoint(
  latitude: number,
  longitude: number,
  bearingDeg: number,
  distanceM: number,
): { latitude: number; longitude: number } {
  const angularDistance = distanceM / LUNAR_RADIUS_M
  const lat1 = latitude * Math.PI / 180
  const lon1 = longitude * Math.PI / 180
  const bearing = bearingDeg * Math.PI / 180

  const sinLat1 = Math.sin(lat1)
  const cosLat1 = Math.cos(lat1)
  const sinDistance = Math.sin(angularDistance)
  const cosDistance = Math.cos(angularDistance)

  const lat2 = Math.asin(
    sinLat1 * cosDistance +
    cosLat1 * sinDistance * Math.cos(bearing),
  )

  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * sinDistance * cosLat1,
    cosDistance - sinLat1 * Math.sin(lat2),
  )

  return {
    latitude: lat2 * 180 / Math.PI,
    longitude: lon2 * 180 / Math.PI,
  }
}

export async function sampleTerrainHorizon(
  latitude: number,
  longitude: number,
): Promise<TerrainHorizonProfile> {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > -80
  ) {
    throw new Error('Location is outside the LOLA elevation coverage.')
  }

  const observer = await sampleElevation(latitude, longitude)

  if (observer.status !== 'available') {
    throw new Error(
      observer.status === 'outside-coverage'
        ? 'Selected location is outside LOLA coverage.'
        : 'Observer elevation is unavailable.',
    )
  }

  const projected = projectedCoordinates(latitude, longitude)

  // Read one local square around the observer.
  const paddingM = HORIZON_MAX_DISTANCE_M + 500

  const left = Math.max(
    0,
    Math.floor(
      (projected.x - paddingM - RASTER_ORIGIN_X) / PIXEL_SIZE_M,
    ),
  )

  const right = Math.min(
    RASTER_WIDTH,
    Math.ceil(
      (projected.x + paddingM - RASTER_ORIGIN_X) / PIXEL_SIZE_M,
    ),
  )

  const top = Math.max(
    0,
    Math.floor(
      (RASTER_ORIGIN_Y - (projected.y + paddingM)) / PIXEL_SIZE_M,
    ),
  )

  const bottom = Math.min(
    RASTER_HEIGHT,
    Math.ceil(
      (RASTER_ORIGIN_Y - (projected.y - paddingM)) / PIXEL_SIZE_M,
    ),
  )

  if (left >= right || top >= bottom) {
    throw new Error('No LOLA raster data around the selected location.')
  }

  const image = await getElevationImage()

  const rasterWidth = right - left

  const raster = await image.readRasters({
    window: [left, top, right, bottom],
    samples: [0],
    interleave: true,
  }) as Float32Array

  const bins: TerrainHorizonBin[] = []

  let totalValidSamples = 0
  let totalMissingSamples = 0

  const sampleCount = Math.floor(
    HORIZON_MAX_DISTANCE_M / HORIZON_SAMPLE_STEP_M,
  )

  for (
    let azimuthDeg = 0;
    azimuthDeg < 360;
    azimuthDeg += HORIZON_AZIMUTH_STEP_DEG
  ) {
    let maximumHorizonDeg = -90
    let maximumHorizonDistanceM = 0
    let validSamples = 0

    for (let step = 1; step <= sampleCount; step++) {
      const distanceM = step * HORIZON_SAMPLE_STEP_M

      const target = destinationPoint(
        latitude,
        longitude,
        azimuthDeg,
        distanceM,
      )

      if (target.latitude < -90 || target.latitude > -80) {
        totalMissingSamples++
        continue
      }

      const targetProjected = projectedCoordinates(
        target.latitude,
        target.longitude,
      )

      const column = Math.floor(
        (targetProjected.x - RASTER_ORIGIN_X) / PIXEL_SIZE_M,
      )

      const row = Math.floor(
        (RASTER_ORIGIN_Y - targetProjected.y) / PIXEL_SIZE_M,
      )

      if (
        column < left ||
        column >= right ||
        row < top ||
        row >= bottom
      ) {
        totalMissingSamples++
        continue
      }

      const index =
        (row - top) * rasterWidth +
        (column - left)

      const targetElevationM = Number(raster[index])

      if (!Number.isFinite(targetElevationM)) {
        totalMissingSamples++
        continue
      }

      validSamples++
      totalValidSamples++

      // Account for lunar curvature and both surface elevations.
      const centralAngle = distanceM / LUNAR_RADIUS_M

      const targetRadius = LUNAR_RADIUS_M + targetElevationM
      const observerRadius = LUNAR_RADIUS_M + observer.elevationM

      const horizontalDistance =
        targetRadius * Math.sin(centralAngle)

      const verticalDifference =
        targetRadius * Math.cos(centralAngle) -
        observerRadius

      const horizonElevationDeg =
        Math.atan2(
          verticalDifference,
          horizontalDistance,
        ) * 180 / Math.PI

      if (horizonElevationDeg > maximumHorizonDeg) {
        maximumHorizonDeg = horizonElevationDeg
        maximumHorizonDistanceM = distanceM
      }
    }

    

    bins.push({
      azimuthDeg,
      horizonElevationDeg:
        validSamples > 0 ? maximumHorizonDeg : NaN,
      distanceM: maximumHorizonDistanceM,
      validSamples,
    })
  }

  const expectedSamples = bins.length * sampleCount

  return {
    observerElevationM: observer.elevationM,
    maxDistanceM: HORIZON_MAX_DISTANCE_M,
    sampleStepM: HORIZON_SAMPLE_STEP_M,
    azimuthStepDeg: HORIZON_AZIMUTH_STEP_DEG,
    bins,
    validSamples: totalValidSamples,
    missingSamples: totalMissingSamples,
    coveragePercent:
      expectedSamples > 0
        ? totalValidSamples / expectedSamples * 100
        : 0,
    source: 'NASA LOLA LDEM_80S_80MPP_ADJ',
    method: 'LOLA_DEM_SPHERICAL_GEOMETRY',
  }
}
export interface HorizonLookup {
  azimuthDeg: number
  horizonElevationDeg: number
  distanceM: number
}

export function getHorizonAtAzimuth(
  profile: TerrainHorizonProfile,
  azimuthDeg: number,
): HorizonLookup | null {
  if (!Number.isFinite(azimuthDeg)) {
    return null
  }

  const normalizedAzimuth =
    ((azimuthDeg % 360) + 360) % 360

  const position =
    normalizedAzimuth / profile.azimuthStepDeg

  const lowerIndex =
    Math.floor(position) % profile.bins.length

  const upperIndex =
    (lowerIndex + 1) % profile.bins.length

  const fraction = position - Math.floor(position)

  const lower = profile.bins[lowerIndex]
  const upper = profile.bins[upperIndex]

  if (
    !lower ||
    !upper ||
    !Number.isFinite(lower.horizonElevationDeg) ||
    !Number.isFinite(upper.horizonElevationDeg)
  ) {
    return null
  }

  return {
    azimuthDeg: normalizedAzimuth,

    horizonElevationDeg:
      lower.horizonElevationDeg +
      (
        upper.horizonElevationDeg -
        lower.horizonElevationDeg
      ) * fraction,

    distanceM:
      lower.distanceM +
      (upper.distanceM - lower.distanceM) * fraction,
  }
}
