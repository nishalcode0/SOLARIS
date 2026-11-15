
import type {
  ElevationSample,
  SlopeSample,
  TerrainHorizonProfile,
} from '../lib/lolaElevation'

import type { PSRSample } from '../lib/lunarPSR'

export type ResourceEvidenceStatus =
  | 'available'
  | 'unavailable'
  | 'insufficient-data'

  export type ShadowStatus =
  | 'inside-mapped-psr'
  | 'outside-mapped-psr'
  | 'insufficient-data'

export interface WaterIceEvidence {
  status: ResourceEvidenceStatus
  confidence: 'high' | 'moderate' | 'low' | 'unassessed'
  hydrogenEvidence: ResourceEvidenceStatus
  thermalEvidence: ResourceEvidenceStatus
  radarEvidence: ResourceEvidenceStatus
  explanation: string
}

export interface LunarResourceAssessment {
  latitude: number
  longitude: number
  elevation: ElevationSample
  slope: SlopeSample
  horizon: TerrainHorizonProfile | null

  // Raw NASA PSR raster sample.
  // The 0/1 interpretation is not yet verified.
  psr: PSRSample

  shadowStatus: ShadowStatus
  waterIce: WaterIceEvidence

  dataCoverage: {
    terrain: boolean
    horizon: boolean
    psr: boolean
    waterIceObservations: boolean
    thermalObservations: boolean
    radarObservations: boolean
  }

  assessedAt: string
  methodology: string
}
