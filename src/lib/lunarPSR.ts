
import { fromUrl } from 'geotiff'
import { projectedCoordinates } from './lolaElevation'

const PSR_TIFF_URL = '/data/LPSR_80S_20MPP_ADJ.TIF'

const PIXEL_SIZE_M = 20
const RASTER_ORIGIN_X = -304_000
const RASTER_ORIGIN_Y = 304_000
const RASTER_WIDTH = 30_400
const RASTER_HEIGHT = 30_400
const COVERAGE_RADIUS_M = 304_000

export type PSRSample =
  | {
      status: 'available'
      maskValue: 0 | 1
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
  | {
      status: 'invalid-value'
      value: number
    }
  | {
      status: 'unavailable'
    }

let imagePromise: ReturnType<typeof loadPSRImage> | null = null

async function loadPSRImage() {
  const tiff = await fromUrl(PSR_TIFF_URL)
  const image = await tiff.getImage(0)

  if (
    image.getWidth() !== RASTER_WIDTH ||
    image.getHeight() !== RASTER_HEIGHT
  ) {
    throw new Error('Unexpected NASA LOLA PSR raster dimensions.')
  }

  return image
}

function getPSRImage() {
  if (!imagePromise) {
    imagePromise = loadPSRImage().catch((error) => {
      imagePromise = null
      throw error
    })
  }

  return imagePromise
}

export async function samplePSR(
  latitude: number,
  longitude: number,
): Promise<PSRSample> {
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

  const image = await getPSRImage()

  const raster = await image.readRasters({
    window: [
      pixelColumn,
      pixelRow,
      pixelColumn + 1,
      pixelRow + 1,
    ],
  })

  const value = Number(raster[0][0])

  if (!Number.isFinite(value)) {
    return { status: 'no-data' }
  }

  if (value !== 0 && value !== 1) {
    return {
      status: 'invalid-value',
      value,
    }
  }

  return {
    status: 'available',
    maskValue: value as 0 | 1,
    pixelColumn,
    pixelRow,
    pixelSpacingM: PIXEL_SIZE_M,
    source: 'NASA GSFC PGDA LOLA PSR 20 m raster',
  }
}
