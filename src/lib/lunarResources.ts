
import type {
  ElevationSample,
  SlopeSample,
  TerrainHorizonProfile,
} from './lolaElevation'

import type { PSRSample } from './lunarPSR'

import type {
  LunarResourceAssessment,
  WaterIceEvidence,
  ShadowStatus,
} from '../types/lunarResources'

function unavailableWaterIceEvidence(): WaterIceEvidence {
  return {
    status: 'unavailable',
    confidence: 'unassessed',
    hydrogenEvidence: 'unavailable',
    thermalEvidence: 'unavailable',
    radarEvidence: 'unavailable',
    explanation:
      'No validated water-ice observation datasets are connected yet. ' +
      'Terrain and shadow conditions cannot independently confirm water ice.',
  }
}

export function buildLunarResourceAssessment(
  latitude: number,
  longitude: number,
  elevation: ElevationSample,
  slope: SlopeSample,
  horizon: TerrainHorizonProfile | null,
  psr: PSRSample,
  shadowStatus: ShadowStatus,
): LunarResourceAssessment {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > -80 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error(
      'Resource assessment is currently limited to 80°S–90°S.',
    )
  }

  return {
    latitude,
    longitude,
    elevation,
    slope,
    horizon,
    psr,

    // PSR mask encoding has not yet been independently verified.
    shadowStatus,

    waterIce: unavailableWaterIceEvidence(),

    dataCoverage: {
      terrain:
        elevation.status === 'available' &&
        slope.status === 'available',

      horizon: horizon !== null,

      psr: psr.status === 'available',

      waterIceObservations: false,
      thermalObservations: false,
      radarObservations: false,
    },

    assessedAt: new Date().toISOString(),

    methodology:
      'NASA LOLA terrain, 20 m/pixel PSR raster sampling, and membership testing against mapped NASA PSR polygons. Raster encoding is unverified; polygon membership indicates mapped PSR status, not direct confirmation of surface illumination or water ice.',
      
  }
}
