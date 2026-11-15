
export type MissionStatus =
  | 'GO'
  | 'CONDITIONAL GO'
  | 'NO-GO'
  | 'INCOMPLETE'

export type FindingSeverity =
  | 'CRITICAL'
  | 'WARNING'
  | 'INFO'

export interface MissionDecisionInputs {
  elevationAvailable: boolean
  slopeAvailable: boolean
  slopeDeg: number | null
  horizonAvailable: boolean
  communicationsAvailable: boolean
  earthVisibility: string | null
  illuminationAvailable: boolean
  illuminationPercent: number | null
  psrAssessmentAvailable: boolean
  waterIceObservationsAvailable: boolean
}

export interface MissionFinding {
  category: string
  severity: FindingSeverity
  message: string
  value?: number | string
  threshold?: number | string
}

export interface MissionDecision {
  status: MissionStatus

  // Backward-compatible fields used by the current UI.
  blockers: string[]
  cautions: string[]
  evaluatedCriteria: number

  // Expanded decision-engine outputs.
  totalCriteria: number
  coveragePercent: number
  confidence: 'HIGH' | 'MODERATE' | 'LOW' | 'INSUFFICIENT'
  score: number | null
  findings: MissionFinding[]
  missingData: string[]
  hardFailures: string[]
  explanation: string
  disclaimer: string
}

export interface MissionDecisionConfig {
  maximumSlopeDeg: number
  cautionSlopeDeg: number
  minimumIlluminationPercent: number
}

const DEFAULT_CONFIG: MissionDecisionConfig = {
  maximumSlopeDeg: 15,
  cautionSlopeDeg: 10,
  minimumIlluminationPercent: 50,
}

const TOTAL_CRITERIA = 6

function isValidNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function evaluateMissionDecision(
  input: MissionDecisionInputs,
  config: MissionDecisionConfig = DEFAULT_CONFIG,
): MissionDecision {
  const findings: MissionFinding[] = []
  const missingData: string[] = []
  const hardFailures: string[] = []
  const cautions: string[] = []

  let evaluatedCriteria = 0
  let score = 100

  function missing(category: string, message: string) {
    missingData.push(message)

    findings.push({
      category,
      severity: 'INFO',
      message,
    })
  }

  function warning(
    category: string,
    message: string,
    value?: number | string,
    threshold?: number | string,
  ) {
    cautions.push(message)

    findings.push({
      category,
      severity: 'WARNING',
      message,
      value,
      threshold,
    })
  }

  function failure(
    category: string,
    message: string,
    value?: number | string,
    threshold?: number | string,
  ) {
    hardFailures.push(message)

    findings.push({
      category,
      severity: 'CRITICAL',
      message,
      value,
      threshold,
    })
  }

  // 1. Terrain elevation
  if (!input.elevationAvailable) {
    missing('TERRAIN', 'Terrain elevation data unavailable')
  } else {
    evaluatedCriteria++
  }

  // 2. Landing slope
  if (
    !input.slopeAvailable ||
    !isValidNumber(input.slopeDeg)
  ) {
    missing('SLOPE', 'Landing-site slope data unavailable')
  } else {
    evaluatedCriteria++

    if (input.slopeDeg < 0 || input.slopeDeg > 90) {
      missing('SLOPE', 'Slope value is outside the valid range')
    } else if (input.slopeDeg > config.maximumSlopeDeg) {
      failure(
        'SLOPE',
        `Slope exceeds the preliminary ${config.maximumSlopeDeg}° screening limit`,
        input.slopeDeg,
        config.maximumSlopeDeg,
      )
    } else if (input.slopeDeg > config.cautionSlopeDeg) {
      warning(
        'SLOPE',
        'Slope requires detailed landing and mobility analysis',
        input.slopeDeg,
        config.cautionSlopeDeg,
      )
      score -= 10
    }
  }

  // 3. Terrain horizon
  if (!input.horizonAvailable) {
    missing('HORIZON', 'Terrain horizon analysis unavailable')
  } else {
    evaluatedCriteria++
  }

  // 4. Earth communications visibility
  if (
    !input.communicationsAvailable ||
    input.earthVisibility === null
  ) {
    missing('COMMUNICATIONS', 'Earth visibility assessment unavailable')
  } else {
    evaluatedCriteria++

    if (input.earthVisibility !== 'CLEAR') {
      warning(
        'COMMUNICATIONS',
        'Earth line of sight is not currently clear',
        input.earthVisibility,
      )
      score -= 20
    }
  }

  // 5. Solar illumination
  if (
    !input.illuminationAvailable ||
    !isValidNumber(input.illuminationPercent)
  ) {
    missing('ILLUMINATION', 'Illumination analysis unavailable')
  } else {
    evaluatedCriteria++

    if (
      input.illuminationPercent < 0 ||
      input.illuminationPercent > 100
    ) {
      missing('ILLUMINATION', 'Illumination percentage is outside 0–100%')
    } else if (
      input.illuminationPercent <
      config.minimumIlluminationPercent
    ) {
      warning(
        'ILLUMINATION',
        'Low geometric illumination; power-system analysis required',
        input.illuminationPercent,
        config.minimumIlluminationPercent,
      )

      score -= 20
    }
  }

  // 6. Permanently shadowed region assessment
  if (!input.psrAssessmentAvailable) {
    missing('PSR', 'Mapped PSR assessment unavailable')
  } else {
    evaluatedCriteria++
  }

  // Water-ice observations are tracked separately because they
  // are not one of the six core site-screening criteria.
  if (!input.waterIceObservationsAvailable) {
    warning(
      'WATER ICE',
      'Direct water-ice observations are not integrated',
    )
  }

  // Data coverage and confidence
  const coveragePercent = Math.round(
    (evaluatedCriteria / TOTAL_CRITERIA) * 100,
  )

  const confidence =
    coveragePercent === 100
      ? 'HIGH'
      : coveragePercent >= 67
        ? 'MODERATE'
        : coveragePercent >= 34
          ? 'LOW'
          : 'INSUFFICIENT'

  // Decision precedence:
  // A known hard failure takes priority over missing information.
  // Missing information prevents a positive recommendation.
  let status: MissionStatus

  if (hardFailures.length > 0) {
    status = 'NO-GO'
  } else if (missingData.length > 0) {
    status = 'INCOMPLETE'
  } else if (cautions.length > 0) {
    status = 'CONDITIONAL GO'
  } else {
    status = 'GO'
  }

  // A score is only meaningful when all six core criteria
  // have been evaluated and no hard failure exists.
  const finalScore =
    evaluatedCriteria === TOTAL_CRITERIA &&
    hardFailures.length === 0
      ? clamp(score, 0, 100)
      : null

  let explanation: string

  switch (status) {
    case 'NO-GO':
      explanation =
        'At least one evaluated criterion violates a configured preliminary screening constraint. The candidate fails this screening.'
      break

    case 'INCOMPLETE':
      explanation =
        'Required scientific data is missing or invalid. A reliable positive site assessment cannot be produced.'
      break

    case 'CONDITIONAL GO':
      explanation =
        'All six core screening criteria have data, but one or more warnings require additional engineering analysis.'
      break

    default:
      explanation =
        'All six core screening checks passed without detected warnings. This is a preliminary screening result, not mission certification.'
  }

  return {
    status,

    // Preserve existing UI compatibility.
    blockers: [...missingData, ...hardFailures],
    cautions,
    evaluatedCriteria,

    // Advanced outputs.
    totalCriteria: TOTAL_CRITERIA,
    coveragePercent,
    confidence,
    score: finalScore,
    findings,
    missingData,
    hardFailures,
    explanation,

    disclaimer:
      'Preliminary computational screening only. The slope and illumination thresholds are configurable assumptions, not universal NASA landing requirements. This engine does not certify landing safety or replace validated terrain, hazard, thermal, power, propulsion, communications, or mission engineering analysis.',
  }
}
