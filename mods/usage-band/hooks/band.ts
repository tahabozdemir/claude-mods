// The band's view model: which pills show, what each says, and how they fit.
// Pure: the renderers and the command read it, nothing here touches `$`.

import type {
  UsageBandCostMode,
  UsageBandPlan,
  UsageBandSnapshot,
  UsageBandTokens,
  UsageBandWindow,
} from '../types'
import {
  formatClock,
  formatCount,
  formatDuration,
  formatExact,
  formatPercent,
  formatUsd,
} from './format'
import { assessWindow, contextStatus } from './status'
import type { Pace, Status, WindowKind } from './status'

const DAY = 24 * 60 * 60_000

export type PillId = 'fiveHour' | 'sevenDay' | 'context' | 'tokens' | 'cost'

/** Groups, left to right: [5h 7d context] [tokens] [cost]. */
export type PillGroup = 0 | 1 | 2

type PillBase = { group: PillGroup; tooltip: string; alt: string }

export type WindowPill = PillBase & {
  kind: 'window'
  id: 'fiveHour' | 'sevenDay'
  label: '5h' | '7d'
  status: Status
  /** Bar fill, 0 to 1. */
  fraction: number
  percentText: string
  /** Elapsed fraction of the window for the tick; null without a reset time. */
  elapsed: number | null
  resetText: string
  pace: Pace
}

export type ContextPill = PillBase & {
  kind: 'context'
  id: 'context'
  label: 'ctx'
  status: Status
  fraction: number
  percentText: string
}

/** A bar pill with no reading yet, drawn dimmed at its final width. */
export type PlaceholderPill = PillBase & {
  kind: 'placeholder'
  id: 'fiveHour' | 'sevenDay' | 'context'
  label: '5h' | '7d' | 'ctx'
}

export type TokensPill = PillBase & {
  kind: 'tokens'
  id: 'tokens'
  inText: string
  outText: string
  isEstimated: boolean
}

export type CostPill = PillBase & {
  kind: 'cost'
  id: 'cost'
  text: string
}

export type Pill = WindowPill | ContextPill | PlaceholderPill | TokensPill | CostPill

export type BandInput = {
  snapshot: UsageBandSnapshot | null
  now: number
  plan: UsageBandPlan
  costMode: UsageBandCostMode
}

const WINDOW_NAME: Record<WindowKind, string> = {
  five_hour: '5-hour limit',
  seven_day: '7-day limit',
}

export function paceLine(pace: Pace): string {
  switch (pace.kind) {
    case 'over':
      return `At this pace you'll hit the limit in ~${formatDuration(pace.timeToLimitMs)}`
    case 'under':
      return 'On pace to stay under the limit'
    case 'insufficient':
      return 'Not enough data yet'
  }
}

function windowPill(
  kind: WindowKind,
  window: UsageBandWindow,
  now: number,
  utcOffsetMinutes: number,
): WindowPill {
  const id = kind === 'five_hour' ? 'fiveHour' : 'sevenDay'
  const label = kind === 'five_hour' ? '5h' : '7d'
  const name = WINDOW_NAME[kind]
  const base = { kind: 'window', id, label, group: 0 } as const

  // A window whose reset time has passed has started over; the next response
  // reports its new figure.
  if (window.resetsAt !== null && window.resetsAt <= now) {
    return {
      ...base,
      status: 'normal',
      fraction: 0,
      percentText: '0%',
      elapsed: 0,
      resetText: 'reset',
      pace: { kind: 'insufficient' },
      tooltip: `${name}: the window has reset\nNew figures arrive with the next response`,
      alt: `${name}: reset`,
    }
  }

  const remainingMs = window.resetsAt === null ? null : window.resetsAt - now
  const { status, pace, elapsed } = assessWindow(kind, window.percentUsed, remainingMs)
  const percentText = formatPercent(window.percentUsed)

  let resetText = '—'
  let resetLine = 'Reset time not reported'
  if (window.resetsAt !== null && remainingMs !== null) {
    const countdown = formatDuration(remainingMs)
    const clock = formatClock(window.resetsAt, utcOffsetMinutes)
    resetText = kind === 'five_hour' || remainingMs < DAY ? countdown : clock
    resetLine = `Resets in ${countdown} · ${clock}`
  }

  const lines = [`${name}: ${percentText} used`]
  if (elapsed !== null) lines.push(`${formatPercent(elapsed * 100)} of the window elapsed`)
  lines.push(resetLine, paceLine(pace))

  return {
    ...base,
    status,
    fraction: clamp01(window.percentUsed / 100),
    percentText,
    elapsed,
    resetText,
    pace,
    tooltip: lines.join('\n'),
    alt: `${name}: ${percentText} used, resets ${resetText}${statusSuffix(status)}`,
  }
}

function placeholderPill(id: PlaceholderPill['id']): PlaceholderPill {
  const label = id === 'fiveHour' ? '5h' : id === 'sevenDay' ? '7d' : 'ctx'
  const name = id === 'fiveHour' ? '5-hour limit' : id === 'sevenDay' ? '7-day limit' : 'Context'
  const text = `${name}: not reported yet\nIt appears after the first response`

  return { kind: 'placeholder', id, label, group: 0, tooltip: text, alt: `${name}: not reported yet` }
}

function contextPill(snapshot: UsageBandSnapshot): ContextPill | PlaceholderPill {
  const context = snapshot.context
  if (context === null || context.percent === null) return placeholderPill('context')

  const status = contextStatus(context.percent)
  const percentText = formatPercent(context.percent)
  const used = context.tokens === null ? '' : `${formatExact(context.tokens)} / `

  return {
    kind: 'context',
    id: 'context',
    label: 'ctx',
    group: 0,
    status,
    fraction: clamp01(context.percent / 100),
    percentText,
    tooltip: [
      `Context: ${used}${formatExact(context.window)} tokens (${percentText})`,
      'The session is compacted automatically as it fills up',
    ].join('\n'),
    alt: `Context: ${percentText} used${statusSuffix(status)}`,
  }
}

function tokensPill(tokens: UsageBandTokens, isEstimated: boolean): TokensPill {
  const mark = isEstimated ? '~' : ''
  const inText = `↑${mark}${formatCount(tokens.input + tokens.cacheCreation)}`
  const outText = `↓${mark}${formatCount(tokens.output)}`
  const lines = [
    `Input (uncached): ${formatExact(tokens.input)}`,
    `Cache writes: ${formatExact(tokens.cacheCreation)}`,
    `Output: ${formatExact(tokens.output)}`,
    `Cache reads: ${formatExact(tokens.cacheRead)}`,
    `Cache hit rate: ${cacheHitRate(tokens)}`,
    isEstimated ? `Turns: ${formatExact(tokens.requests)}` : `Requests: ${formatExact(tokens.requests)}`,
  ]
  if (isEstimated) lines.unshift('Estimated — transcript file could not be read')

  return {
    kind: 'tokens',
    id: 'tokens',
    group: 1,
    inText,
    outText,
    isEstimated,
    tooltip: lines.join('\n'),
    alt: `Tokens: ${inText} in, ${outText} out`,
  }
}

function costPill(usd: number): CostPill {
  const text = `≈${formatUsd(usd)}`

  return {
    kind: 'cost',
    id: 'cost',
    group: 2,
    text,
    tooltip: `${text} this session\nEstimated at API list prices. Subscription plans are not billed this amount.`,
    alt: `Cost: about ${formatUsd(usd)} at API list prices`,
  }
}

export function cacheHitRate(tokens: UsageBandTokens): string {
  const input = tokens.input + tokens.cacheCreation + tokens.cacheRead
  if (input === 0) return '—'

  return `${((tokens.cacheRead / input) * 100).toFixed(1)}%`
}

function statusSuffix(status: Status): string {
  return status === 'normal' ? '' : ` (${status})`
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/** True once anything the band shows has a reading. */
export function hasAnyData(snapshot: UsageBandSnapshot | null): snapshot is UsageBandSnapshot {
  if (snapshot === null) return false
  const tokens = snapshot.tokens
  const tokenSum =
    tokens === null ? 0 : tokens.input + tokens.cacheCreation + tokens.output + tokens.cacheRead

  return (
    snapshot.fiveHour !== null ||
    snapshot.sevenDay !== null ||
    snapshot.context?.percent != null ||
    tokenSum > 0 ||
    (snapshot.costUsd ?? 0) > 0
  )
}

export function isCostShown(plan: UsageBandPlan, costMode: UsageBandCostMode): boolean {
  if (costMode !== 'auto') return costMode === 'on'

  return plan !== 'subscription'
}

/** The pills in band order, or null when there is nothing to show yet. */
export function buildPills(input: BandInput): Pill[] | null {
  const { snapshot, now, plan, costMode } = input
  if (!hasAnyData(snapshot)) return null

  const offset = snapshot.utcOffsetMinutes
  const pills: Pill[] = []

  if (plan !== 'api') {
    pills.push(
      snapshot.fiveHour === null
        ? placeholderPill('fiveHour')
        : windowPill('five_hour', snapshot.fiveHour, now, offset),
      snapshot.sevenDay === null
        ? placeholderPill('sevenDay')
        : windowPill('seven_day', snapshot.sevenDay, now, offset),
    )
  }
  pills.push(contextPill(snapshot))
  if (snapshot.tokens !== null) pills.push(tokensPill(snapshot.tokens, snapshot.isTokensEstimated))
  if (snapshot.costUsd !== null && isCostShown(plan, costMode)) pills.push(costPill(snapshot.costUsd))

  return pills
}

/** Pills dropped first when the band is too narrow; 5h and context stay. */
export const DROP_ORDER: readonly PillId[] = ['tokens', 'cost', 'sevenDay']

/**
 * How much a bar pill shows: `full`, then `compact` (no reset time), then
 * `minimal` (label and percentage). Chosen by width alone, never by data.
 */
export type Density = 'full' | 'compact' | 'minimal'

export const DENSITIES: readonly Density[] = ['full', 'compact', 'minimal']

export type Fit = { pills: Pill[]; density: Density }

/** Space before `pills[index]`: none for the first, then within or between groups. */
export function gapBefore(pills: readonly Pill[], index: number, within: number, between: number): number {
  const previous = pills[index - 1]
  const pill = pills[index]
  if (previous === undefined || pill === undefined) return 0

  return previous.group === pill.group ? within : between
}

export function bandWidth(
  pills: readonly Pill[],
  widthOf: (pill: Pill) => number,
  within: number,
  between: number,
): number {
  return pills.reduce((sum, pill, i) => sum + gapBefore(pills, i, within, between) + widthOf(pill), 0)
}

/**
 * Fits the band to `available`: drops pills in DROP_ORDER, then draws the
 * pills that must stay more compactly. Never wraps; below the minimal width
 * the row is clipped.
 */
export function fitPills(
  pills: readonly Pill[],
  available: number,
  widthOf: (pill: Pill, density: Density) => number,
  within: number,
  between: number,
): Fit {
  const fits = (list: readonly Pill[], density: Density) =>
    bandWidth(list, pill => widthOf(pill, density), within, between) <= available

  let shown = [...pills]
  for (const id of DROP_ORDER) {
    if (fits(shown, 'full')) return { pills: shown, density: 'full' }
    shown = shown.filter(pill => pill.id !== id)
  }
  const density = DENSITIES.find(each => fits(shown, each)) ?? 'minimal'

  return { pills: shown, density }
}

/** The `/usage-pill` line: every reading, with status markers and pace. */
export function summaryLine(input: BandInput): string {
  const pills = buildPills({ ...input, costMode: 'on' })
  if (pills === null) return 'No usage data yet. It appears after the first response.'

  const tokens = input.snapshot?.tokens ?? null
  const parts = pills.map(pill => {
    switch (pill.kind) {
      case 'placeholder':
        return `${pill.label} —`
      case 'window': {
        const head = `${marker(pill.status)}${pill.label} ${pill.percentText}${criticalWord(pill.status)}`
        if (pill.status !== 'normal' && pill.pace.kind === 'over') {
          return `${head} — limit in ~${formatDuration(pill.pace.timeToLimitMs)} at this pace`
        }

        return `${head} (${pill.resetText})`
      }
      case 'context':
        return `${marker(pill.status)}ctx ${pill.percentText}${criticalWord(pill.status)}`
      case 'tokens': {
        const mark = pill.isEstimated ? '~' : ''
        const cached = tokens === null ? '' : ` ⧉${mark}${formatCount(tokens.cacheRead)}`

        return `${pill.inText} ${pill.outText}${cached}`
      }
      case 'cost':
        return pill.text
    }
  })

  return parts.join(' · ')
}

function marker(status: Status): string {
  return status === 'normal' ? '' : '⚠ '
}

function criticalWord(status: Status): string {
  return status === 'critical' ? ' critical' : ''
}
