// Terminal pills: runs of text with a tone each, padded to stable widths. Pure.

import type { Density, Pill } from './band'
import type { Status } from './status'

export const GAP_WITHIN_COLUMNS = 1
export const GAP_BETWEEN_COLUMNS = 3

const BAR_CELLS = 10
const PERCENT_COLUMNS = 4
const RESET_COLUMNS = { fiveHour: 6, sevenDay: 9 } as const
const TOKENS_COLUMNS = 15
const COST_COLUMNS = 8

/** `dim` for neutral text; `status` takes the pill's status color. */
export type Tone = 'dim' | 'plain' | 'status'

export type Segment = { text: string; tone: Tone; isBold?: boolean }

export type TerminalPill = { pill: Pill; status: Status; segments: Segment[] }

/**
 * Ten cells of `█` and `░`. With `elapsed`, a `│` is inserted between the
 * cells where the window's elapsed time falls, so every cell still shows fill.
 */
export function barSegments(fraction: number, elapsed: number | null, status: Status): Segment[] {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * BAR_CELLS)
  const tickAt = elapsed === null ? -1 : Math.round(Math.min(1, Math.max(0, elapsed)) * BAR_CELLS)
  const fillTone: Tone = status === 'normal' ? 'dim' : 'status'
  const cells: Segment[] = []
  for (let cell = 0; cell <= BAR_CELLS; cell += 1) {
    if (cell === tickAt) cells.push({ text: '│', tone: status === 'normal' ? 'dim' : 'plain' })
    if (cell < BAR_CELLS) cells.push(cell < filled ? { text: '█', tone: fillTone } : { text: '░', tone: 'dim' })
  }

  const segments: Segment[] = []
  for (const segment of cells) {
    const last = segments.at(-1)
    if (last !== undefined && last.tone === segment.tone) {
      last.text += segment.text
    } else {
      segments.push(segment)
    }
  }

  return segments
}

/** A critical pill leads with `⚠`; the others keep the same two columns blank. */
function mark(status: Status): Segment {
  return { text: status === 'critical' ? '⚠ ' : '  ', tone: 'status' }
}

export function terminalPill(pill: Pill, density: Density): TerminalPill {
  switch (pill.kind) {
    case 'placeholder': {
      const width = terminalWidth(pill, density)

      return { pill, status: 'normal', segments: [{ text: `  ${pill.label} —`.padEnd(width), tone: 'dim' }] }
    }
    case 'window':
    case 'context': {
      const status = pill.status
      const isNormal = status === 'normal'
      const segments: Segment[] = [mark(status), { text: `${pill.label} `, tone: 'dim' }]
      if (density !== 'minimal') {
        segments.push(...barSegments(pill.fraction, pill.kind === 'window' ? pill.elapsed : null, status))
        // The tick's column stays reserved when the window reported no reset time.
        const tickRoom = pill.kind === 'window' && pill.elapsed === null ? ' ' : ''
        segments.push({ text: `${tickRoom} `, tone: 'dim' })
      }
      segments.push({
        text: pill.percentText.padStart(PERCENT_COLUMNS),
        tone: isNormal ? 'dim' : 'status',
        isBold: !isNormal,
      })
      if (pill.kind === 'window' && density === 'full') {
        segments.push({ text: ` ${pill.resetText.padEnd(RESET_COLUMNS[pill.id])}`, tone: 'dim' })
      }

      return { pill, status, segments }
    }
    case 'tokens':
      return {
        pill,
        status: 'normal',
        segments: [{ text: `${pill.inText} ${pill.outText}`.padEnd(TOKENS_COLUMNS), tone: 'dim' }],
      }
    case 'cost':
      return { pill, status: 'normal', segments: [{ text: pill.text.padEnd(COST_COLUMNS), tone: 'dim' }] }
  }
}

/** Columns the pill takes, from its widest realistic content. */
export function terminalWidth(pill: Pill, density: Density): number {
  switch (pill.kind) {
    case 'placeholder':
    case 'window':
    case 'context': {
      // Mark, "5h " or "ctx ", the bar and its space (a window's tick too),
      // the percent, and a window's " <reset>" when full.
      const isWindow = pill.id !== 'context'
      const bar = density === 'minimal' ? 0 : BAR_CELLS + (isWindow ? 1 : 0) + 1
      const reset = pill.id !== 'context' && density === 'full' ? 1 + RESET_COLUMNS[pill.id] : 0

      return 2 + pill.label.length + 1 + bar + PERCENT_COLUMNS + reset
    }
    case 'tokens':
      return Math.max(TOKENS_COLUMNS, `${pill.inText} ${pill.outText}`.length)
    case 'cost':
      return Math.max(COST_COLUMNS, pill.text.length)
  }
}
