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
      'Direct orbital water-ice observations are not yet integrated. ' +
      'LEND hydrogen measurements, Diviner thermal observations, and ' +
      'Mini-RF radar observations must be evaluated independently. ' +
      'Terrain and permanently shadowed region mapping provide context, ' +
      'not proof of water-ice presence.',
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
      'Terrain assessment uses NASA LOLA elevation and derived slope. ' +
      'Mapped PSR membership uses NASA south-polar PSR polygons. ' +
      'The PSR raster binary encoding remains unverified. Terrain ' +
      'shadow and mapped PSR membership are contextual indicators only. ' +
      'No direct LEND hydrogen, Diviner thermal, or Mini-RF radar ' +
      'water-ice observations are currently integrated.',
  }
}
