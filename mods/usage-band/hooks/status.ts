// Status logic: pure functions, no UI and no engine API, so they test alone.

export type Status = 'normal' | 'warning' | 'critical'

export type WindowKind = 'five_hour' | 'seven_day'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export const WINDOW_MS: Record<WindowKind, number> = {
  five_hour: 5 * HOUR,
  seven_day: 7 * 24 * HOUR,
}

/** A projected run-out this close (and before reset) is critical. */
export const CRITICAL_HORIZON_MS: Record<WindowKind, number> = {
  five_hour: 30 * MINUTE,
  seven_day: 24 * HOUR,
}

/** Below this elapsed fraction there is too little data to project. */
export const MIN_ELAPSED_FOR_PACE = 0.05

export const USAGE_WARNING = 0.75
export const USAGE_CRITICAL = 0.9
export const CONTEXT_WARNING = 70
export const CONTEXT_CRITICAL = 90

export type Pace =
  | { kind: 'insufficient' }
  | { kind: 'under' }
  | { kind: 'over'; timeToLimitMs: number }

export type WindowAssessment = {
  status: Status
  pace: Pace
  /** Fraction of the window that has passed, 0 to 1; null without a reset time. */
  elapsed: number | null
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/** `1 − remaining / window`, clamped to 0..1. */
export function elapsedFraction(remainingMs: number, windowMs: number): number {
  return clamp01(1 - remainingMs / windowMs)
}

/**
 * Projects when the window runs out at the pace so far. `u` and `e` are the
 * used and elapsed fractions; `remainingMs` is the time until reset.
 */
export function projectPace(u: number, e: number, windowMs: number, remainingMs: number): Pace {
  if (e < MIN_ELAPSED_FOR_PACE) return { kind: 'insufficient' }
  if (u <= 0) return { kind: 'under' }

  const elapsedMs = e * windowMs
  const rate = u / elapsedMs
  const timeToLimitMs = Math.max(0, (1 - u) / rate)

  return timeToLimitMs < remainingMs ? { kind: 'over', timeToLimitMs } : { kind: 'under' }
}

/**
 * Classifies a rate-limit window by usage and pace. `remainingMs` is null when
 * the window reported no reset time: then only raw usage counts.
 */
export function assessWindow(
  kind: WindowKind,
  percentUsed: number,
  remainingMs: number | null,
): WindowAssessment {
  const u = percentUsed / 100
  const windowMs = WINDOW_MS[kind]

  if (remainingMs === null) {
    return { status: statusByUsage(u, false, false), pace: { kind: 'insufficient' }, elapsed: null }
  }

  const remaining = Math.max(0, remainingMs)
  const elapsed = elapsedFraction(remaining, windowMs)
  const pace = projectPace(u, elapsed, windowMs, remaining)
  const isOver = pace.kind === 'over'
  const isOverSoon = isOver && pace.timeToLimitMs <= CRITICAL_HORIZON_MS[kind]

  return { status: statusByUsage(u, isOver, isOverSoon), pace, elapsed }
}

function statusByUsage(u: number, isOver: boolean, isOverSoon: boolean): Status {
  if (u >= USAGE_CRITICAL || isOverSoon) return 'critical'
  if (u >= USAGE_WARNING || isOver) return 'warning'

  return 'normal'
}

/** Context fill, 0 to 100: warning from 70, critical from 90. */
export function contextStatus(percent: number): Status {
  if (percent >= CONTEXT_CRITICAL) return 'critical'
  if (percent >= CONTEXT_WARNING) return 'warning'

  return 'normal'
}
