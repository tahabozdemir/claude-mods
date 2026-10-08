import { describe, expect, test } from 'claude-code/testing'

import type { UsageBandSnapshot } from '../types'
import { buildPills, DROP_ORDER, fitPills, summaryLine } from '../hooks/band'
import { formatClock, formatCount, formatDuration, formatExact } from '../hooks/format'
import { assessWindow, contextStatus, elapsedFraction } from '../hooks/status'
import { pillWidthPx } from '../hooks/svg'
import { barSegments, terminalPill, terminalWidth } from '../hooks/terminal'

const MIN = 60_000
const H = 60 * MIN

describe('rate-limit status', () => {
  test('5h 20%, 2h 40m left → normal', () => {
    const result = assessWindow('five_hour', 20, 2 * H + 40 * MIN)
    expect(result.status).toBe('normal')
    expect(result.pace.kind).toBe('under')
  })

  test('5h 40%, 4h 30m left → warning, runs out in ~45m', () => {
    const result = assessWindow('five_hour', 40, 4 * H + 30 * MIN)
    expect(result.status).toBe('warning')
    expect(result.pace.kind).toBe('over')
    if (result.pace.kind !== 'over') throw new Error('expected a projection')
    expect(formatDuration(result.pace.timeToLimitMs)).toBe('45m')
  })

  test('5h 95% → critical', () => {
    expect(assessWindow('five_hour', 95, 2 * H).status).toBe('critical')
  })

  test('5h 10%, 4h 55m left → normal: not enough data to project', () => {
    const result = assessWindow('five_hour', 10, 4 * H + 55 * MIN)
    expect(result.status).toBe('normal')
    expect(result.pace.kind).toBe('insufficient')
  })

  test('5h run-out within 30m and before reset → critical', () => {
    // 60% after 30m: the rest goes in 20m, with 4h 30m left.
    expect(assessWindow('five_hour', 60, 4 * H + 30 * MIN).status).toBe('critical')
    // 50% after 1h: the rest goes in 1h, with 4h left: before reset, not within 30m.
    expect(assessWindow('five_hour', 50, 4 * H).status).toBe('warning')
  })

  test('5h 76% on pace to stay under → warning by usage alone', () => {
    const result = assessWindow('five_hour', 76, 30 * MIN)
    expect(result.pace.kind).toBe('under')
    expect(result.status).toBe('warning')
  })

  test('7d run-out within 24h and before reset → critical', () => {
    // 60% after 3 days: the rest goes in 2 days, with 4 days left → warning.
    expect(assessWindow('seven_day', 60, 4 * 24 * H).status).toBe('warning')
    // 70% after 6 days: the rest takes ~2.6 days, with 1 day left → normal.
    expect(assessWindow('seven_day', 70, 24 * H).status).toBe('normal')
    // 55% after 1 day: the rest goes in ~20h, with 6 days left → critical.
    expect(assessWindow('seven_day', 55, 6 * 24 * H).status).toBe('critical')
  })

  test('no reset time → usage alone, no tick', () => {
    const result = assessWindow('five_hour', 80, null)
    expect(result.status).toBe('warning')
    expect(result.elapsed).toBe(null)
  })

  test('elapsed fraction is clamped to 0..1', () => {
    expect(elapsedFraction(6 * H, 5 * H)).toBe(0)
    expect(elapsedFraction(-H, 5 * H)).toBe(1)
    expect(elapsedFraction(2.5 * H, 5 * H)).toBe(0.5)
  })
})

describe('context status', () => {
  test('72% → warning', () => expect(contextStatus(72)).toBe('warning'))
  test('69% → normal', () => expect(contextStatus(69)).toBe('normal'))
  test('90% → critical', () => expect(contextStatus(90)).toBe('critical'))
})

describe('formatting', () => {
  test('counts', () => {
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1000)).toBe('1.0k')
    expect(formatCount(15_600)).toBe('15.6k')
    expect(formatCount(999_949)).toBe('999.9k')
    expect(formatCount(999_950)).toBe('1.00M')
    expect(formatCount(1_250_000)).toBe('1.25M')
    expect(formatExact(3_253_023)).toBe('3,253,023')
  })

  test('durations', () => {
    expect(formatDuration(20_000)).toBe('<1m')
    expect(formatDuration(45 * MIN)).toBe('45m')
    expect(formatDuration(2 * H + 40 * MIN)).toBe('2h 40m')
    expect(formatDuration(31 * H)).toBe('1d 7h')
  })

  test('absolute times use a 3-letter weekday and 24-hour local time', () => {
    // Sun 2026-10-04 11:00 UTC is 14:00 at UTC+3.
    expect(formatClock(Date.UTC(2026, 9, 4, 11), 180)).toBe('Sun 14:00')
    expect(formatClock(Date.UTC(2026, 9, 4, 23, 5), 180)).toBe('Mon 02:05')
  })
})

// Sat 2026-10-03 07:00 at UTC+3: the 7d window resets 1d 7h later, Sun 14:00.
const NOW = Date.UTC(2026, 9, 3, 4)
const SAMPLE: UsageBandSnapshot = {
  fiveHour: { percentUsed: 20, resetsAt: NOW + 2 * H + 40 * MIN },
  sevenDay: { percentUsed: 58, resetsAt: NOW + 31 * H },
  context: { tokens: 124_000, window: 200_000, percent: 62 },
  costUsd: 4.32,
  tokens: { input: 2_100, cacheCreation: 13_500, output: 3_000, cacheRead: 954_200, requests: 42 },
  isTokensEstimated: false,
  utcOffsetMinutes: 180,
}
const INPUT = { snapshot: SAMPLE, now: NOW, plan: 'subscription', costMode: 'auto' } as const

describe('band', () => {
  test('summary line', () => {
    expect(summaryLine(INPUT)).toBe(
      '5h 20% (2h 40m) · 7d 58% (Sun 14:00) · ctx 62% · ↑15.6k ↓3.0k ⧉954.2k · ≈$4.32',
    )
  })

  test('summary line with a pace warning', () => {
    const snapshot = { ...SAMPLE, fiveHour: { percentUsed: 40, resetsAt: NOW + 4 * H + 30 * MIN } }
    expect(summaryLine({ ...INPUT, snapshot })).toBe(
      '⚠ 5h 40% — limit in ~45m at this pace · 7d 58% (Sun 14:00) · ctx 62% · ↑15.6k ↓3.0k ⧉954.2k · ≈$4.32',
    )
  })

  test('7d under 24h shows a countdown', () => {
    const snapshot = { ...SAMPLE, sevenDay: { percentUsed: 58, resetsAt: NOW + 18 * H + 20 * MIN } }
    expect(summaryLine({ ...INPUT, snapshot })).toContain('7d 58% (18h 20m)')
  })

  test('no data → no band', () => {
    const empty: UsageBandSnapshot = {
      ...SAMPLE,
      fiveHour: null,
      sevenDay: null,
      context: { tokens: null, window: 200_000, percent: null },
      costUsd: 0,
      tokens: { input: 0, cacheCreation: 0, output: 0, cacheRead: 0, requests: 0 },
    }
    expect(buildPills({ ...INPUT, snapshot: empty })).toBe(null)
  })

  test('before the first response: 5h and 7d are placeholders', () => {
    const resumed = { ...SAMPLE, fiveHour: null, sevenDay: null }
    const pills = buildPills({ ...INPUT, snapshot: resumed }) ?? []
    expect(pills.map(p => `${p.id}:${p.kind}`)).toEqual([
      'fiveHour:placeholder',
      'sevenDay:placeholder',
      'context:context',
      'tokens:tokens',
    ])
  })

  test('cost pill: hidden on a subscription by default, shown with cost on, shown off one', () => {
    const ids = (input: Parameters<typeof buildPills>[0]) => (buildPills(input) ?? []).map(p => p.id)
    expect(ids(INPUT)).not.toContain('cost')
    expect(ids({ ...INPUT, costMode: 'on' })).toContain('cost')
    expect(ids({ ...INPUT, plan: 'unknown' })).toContain('cost')
    expect(ids({ ...INPUT, plan: 'api', costMode: 'off' })).not.toContain('cost')
  })

  test('narrow terminal: drop tokens, cost, 7d; then compact 5h and context', () => {
    const pills = buildPills({ ...INPUT, costMode: 'on' }) ?? []
    const fit = (columns: number) => {
      const { pills: shown, density } = fitPills(pills, columns, terminalWidth, 1, 3)

      return `${shown.map(p => p.id).join(',')} ${density}`
    }
    expect(DROP_ORDER).toEqual(['tokens', 'cost', 'sevenDay'])
    expect(fit(111)).toBe('fiveHour,sevenDay,context,tokens,cost full')
    expect(fit(110)).toBe('fiveHour,sevenDay,context,cost full')
    expect(fit(92)).toBe('fiveHour,sevenDay,context full')
    expect(fit(81)).toBe('fiveHour,context full')
    expect(fit(50)).toBe('fiveHour,context full')
    expect(fit(49)).toBe('fiveHour,context compact')
    expect(fit(43)).toBe('fiveHour,context compact')
    expect(fit(42)).toBe('fiveHour,context minimal')
    expect(fit(20)).toBe('fiveHour,context minimal')
  })

  test('narrow desktop: the same order in pixels', () => {
    const pills = buildPills({ ...INPUT, costMode: 'on' }) ?? []
    const fit = (px: number) => {
      const { pills: shown, density } = fitPills(pills, px, pillWidthPx, 4, 10)

      return `${shown.map(p => p.id).join(',')} ${density}`
    }
    expect(fit(769)).toBe('fiveHour,sevenDay,context,tokens,cost full')
    expect(fit(627)).toBe('fiveHour,sevenDay,context,cost full')
    expect(fit(531)).toBe('fiveHour,sevenDay,context full')
    expect(fit(320)).toBe('fiveHour,context full')
    expect(fit(319)).toBe('fiveHour,context compact')
    expect(fit(253)).toBe('fiveHour,context compact')
    expect(fit(252)).toBe('fiveHour,context minimal')
    expect(fit(169)).toBe('fiveHour,context minimal')
  })

  test('every density draws exactly its width', () => {
    const critical = { ...SAMPLE, fiveHour: { percentUsed: 95, resetsAt: null } }
    const placeholder = { ...SAMPLE, fiveHour: null, sevenDay: null }
    for (const snapshot of [SAMPLE, critical, placeholder]) {
      for (const density of ['full', 'compact', 'minimal'] as const) {
        for (const pill of buildPills({ ...INPUT, snapshot, costMode: 'on' }) ?? []) {
          const drawn = terminalPill(pill, density).segments.map(s => s.text).join('')
          expect(`${pill.id} ${density} ${drawn.length}`).toBe(`${pill.id} ${density} ${terminalWidth(pill, density)}`)
        }
      }
    }
  })

  test('terminal bar: ten cells with the elapsed tick between them', () => {
    const bar = (fraction: number, elapsed: number | null) =>
      barSegments(fraction, elapsed, 'normal').map(s => s.text).join('')
    expect(bar(0.2, 0.47)).toBe('██░░░│░░░░░')
    // 10% elapsed lands between the first and second cell despite float error.
    expect(bar(0.4, 1 - (4.5 * H) / (5 * H))).toBe('█│███░░░░░░')
    expect(bar(0.62, null)).toBe('██████░░░░')
  })
})
