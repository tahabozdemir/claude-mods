// Desktop pills: one SVG document per pill, generated as markup. Pure.
//
// Every width comes from the monospace advance (0.6em), so a pill is as wide
// as its widest realistic content whatever the numbers say now. The gap after
// a pill is drawn inside its own SVG as transparent space, so the spacing is
// exact in CSS pixels whatever the host does between elements.

import { fitPills, gapBefore } from './band'
import type { Density, Pill } from './band'

const FONT_PX = 11
const CHAR_PX = FONT_PX * 0.6
const HEIGHT = 22
const PAD = 8
const ICON = 12
const ICON_GAP = 5
const GAP = 6
const BAR = 36
const BAR_H = 4
const BAR_Y = 9
const CLOCK = 10
const CLOCK_GAP = 4
const BASELINE = 15

export const GAP_WITHIN_PX = 4
export const GAP_BETWEEN_PX = 10

/**
 * CSS pixels per cell of `bodyColumns` on the desktop. The engine reports the
 * desktop's width only in cells of its code font, never in pixels, so this is
 * a lower bound: a 12px monospace font (0.6em advance). A larger code font
 * only leaves room unused; the band never overflows. `desktopCellPx` in
 * /config overrides it.
 */
export const DEFAULT_DESKTOP_CELL_PX = 7.2

/** Widest realistic content per slot, in characters. */
const SLOT = {
  label: { '5h': 2, '7d': 2, ctx: 3 },
  percent: 4, // "100%"
  reset: { fiveHour: 6, sevenDay: 9 }, // "4h 59m", "Sun 14:00"
  tokens: 15, // "↑999.9k ↓999.9k"
  cost: 8, // "≈$999.99"
} as const

const chars = (n: number): number => n * CHAR_PX

const STYLE = `
svg{--bg:#F1F1EF;--text:#2B2B2B;--muted:#6B6B6B;--track:#DDDDD9;--fill:#6B6B6B;--warn:#B26B00;--warn-text:#A06000;--warn-bg:#FFF4DE;--crit:#C2261C;--crit-bg:#FDE7E5}
@media (prefers-color-scheme:dark){svg{--bg:#2A2A2C;--text:#E4E4E6;--muted:#9A9AA0;--track:#3D3D42;--fill:#A8A8AE;--warn:#F0B341;--warn-text:#F0B341;--warn-bg:#3A2E14;--crit:#FF6B5E;--crit-bg:#3D1A18}}
text{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;font-size:${FONT_PX}px;fill:var(--text)}
.bg{fill:var(--bg)}
.warning .bg{fill:var(--warn-bg);stroke:var(--warn)}
.critical .bg{fill:var(--crit-bg);stroke:var(--crit)}
.muted{fill:var(--muted)}
.warning .pct{fill:var(--warn-text);font-weight:700}
.critical .pct{fill:var(--crit);font-weight:700}
.icon{fill:none;stroke:var(--muted);stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}
.dot{fill:var(--muted);stroke:none}
.warning .icon{stroke:var(--warn)}.warning .dot{fill:var(--warn)}
.critical .icon{stroke:var(--crit)}.critical .dot{fill:var(--crit)}
.track{fill:var(--track)}
.fill{fill:var(--fill)}
.warning .fill{fill:var(--warn)}
.critical .fill{fill:var(--crit)}
.tick{fill:var(--text)}
.divider{stroke:var(--muted)}
`

/** 12×12 icons, stroked in the secondary color (or the status color). */
const ICONS = {
  gauge:
    '<path d="M1.5 9.5a4.5 4.5 0 0 1 9 0"/><path d="M6 9.5 8.6 6.4"/><circle class="dot" cx="6" cy="9.5" r="1"/>',
  calendar: '<rect x="1.5" y="2.5" width="9" height="8.5" rx="1.5"/><path d="M1.5 5.5h9M4 1v3M8 1v3"/>',
  stack: '<path d="M1.5 2.5h9M1.5 6h9M1.5 9.5h9"/>',
  arrows: '<path d="M3.5 10.5v-9M1.3 3.7 3.5 1.5l2.2 2.2M8.5 1.5v9M6.3 8.3l2.2 2.2 2.2-2.2"/>',
  dollar:
    '<path d="M8.6 3.3C8.1 2.5 7.2 2 6 2 4.6 2 3.6 2.8 3.6 3.8c0 2.4 4.8 1.5 4.8 4.2 0 1.1-1 1.9-2.4 1.9-1.2 0-2.1-.5-2.6-1.3M6 .6V2M6 9.9v1.5"/>',
  warning: '<path d="M6 1.3 11 10.5H1z"/><path d="M6 4.8v2.6"/><circle class="dot" cx="6" cy="9" r=".75"/>',
} as const

/** 10×10 countdown icon: an hourglass. */
const HOURGLASS = '<path d="M2.5 1h5L5 5l2.5 4h-5L5 5z"/>'

type IconName = keyof typeof ICONS

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const n = (x: number): string => String(Math.round(x * 100) / 100)

function icon(name: IconName, x: number): string {
  return `<g class="icon" transform="translate(${n(x)} ${(HEIGHT - ICON) / 2})">${ICONS[name]}</g>`
}

function text(x: number, content: string, attrs = ''): string {
  return `<text x="${n(x)}" y="${BASELINE}"${attrs}>${escapeXml(content)}</text>`
}

function bar(x: number, fraction: number, elapsed: number | null): string {
  const fill = fraction > 0 ? Math.max(2, fraction * BAR) : 0
  const parts = [`<rect class="track" x="${n(x)}" y="${BAR_Y}" width="${BAR}" height="${BAR_H}" rx="2"/>`]
  if (fill > 0) parts.push(`<rect class="fill" x="${n(x)}" y="${BAR_Y}" width="${n(fill)}" height="${BAR_H}" rx="2"/>`)
  if (elapsed !== null) {
    const tickX = x + Math.min(BAR - 1.5, Math.max(0, elapsed * BAR - 0.75))
    parts.push(`<rect class="tick" x="${n(tickX)}" y="${BAR_Y - 4}" width="1.5" height="${BAR_H + 4}" rx=".5"/>`)
  }

  return parts.join('')
}

const PILL_ICON: Record<Pill['id'], IconName> = {
  fiveHour: 'gauge',
  sevenDay: 'calendar',
  context: 'stack',
  tokens: 'arrows',
  cost: 'dollar',
}

/** A bar pill: icon, label, the bar unless minimal, percent, the reset when full. */
function barPillWidth(labelChars: number, hasBar: boolean, resetChars: number | null): number {
  let width = PAD + ICON + ICON_GAP + chars(labelChars) + GAP
  if (hasBar) width += BAR + GAP
  width += chars(SLOT.percent)
  if (resetChars !== null) width += GAP + 1 + GAP + CLOCK + CLOCK_GAP + chars(resetChars)

  return Math.ceil(width + PAD)
}

/** The pill's width in CSS pixels, from its widest realistic content. */
export function pillWidthPx(pill: Pill, density: Density): number {
  const lead = PAD + ICON + ICON_GAP
  switch (pill.kind) {
    case 'window':
    case 'context':
    case 'placeholder': {
      const reset = pill.id !== 'context' && density === 'full' ? SLOT.reset[pill.id] : null

      return barPillWidth(SLOT.label[pill.label], density !== 'minimal', reset)
    }
    case 'tokens': {
      const length = `${pill.inText} ${pill.outText}`.length

      return Math.ceil(lead + chars(Math.max(SLOT.tokens, length)) + PAD)
    }
    case 'cost':
      return Math.ceil(lead + chars(Math.max(SLOT.cost, pill.text.length)) + PAD)
  }
}

function body(pill: Pill, density: Density): string {
  const isCritical = 'status' in pill && pill.status === 'critical'
  const parts = [icon(isCritical ? 'warning' : PILL_ICON[pill.id], PAD)]
  let x = PAD + ICON + ICON_GAP

  switch (pill.kind) {
    case 'placeholder':
      parts.push(text(x, pill.label, ' class="muted"'))
      x += chars(SLOT.label[pill.label]) + GAP
      parts.push(text(x, '—', ' class="muted"'))
      break
    case 'window':
    case 'context': {
      parts.push(text(x, pill.label, ' class="muted"'))
      x += chars(SLOT.label[pill.label]) + GAP
      if (density !== 'minimal') {
        parts.push(bar(x, pill.fraction, pill.kind === 'window' ? pill.elapsed : null))
        x += BAR + GAP
      }
      x += chars(SLOT.percent)
      parts.push(text(x, pill.percentText, ' class="pct" text-anchor="end"'))
      if (pill.kind === 'window' && density === 'full') {
        x += GAP
        parts.push(`<path class="divider" d="M${n(x + 0.5)} 6v10"/>`)
        x += 1 + GAP
        parts.push(`<g class="icon" transform="translate(${n(x)} ${(HEIGHT - CLOCK) / 2})">${HOURGLASS}</g>`)
        x += CLOCK + CLOCK_GAP
        parts.push(text(x, pill.resetText, ' class="muted"'))
      }
      break
    }
    case 'tokens':
      parts.push(text(x, `${pill.inText} ${pill.outText}`))
      break
    case 'cost':
      parts.push(text(x, pill.text))
      break
  }

  return parts.join('')
}

export type PillSvg = {
  id: Pill['id']
  source: string
  alt: string
  width: number
  height: number
}

/** One pill as a standalone SVG, `trailing` px of transparent gap after it. */
export function pillSvg(pill: Pill, trailing: number, density: Density): PillSvg {
  const pillWidth = pillWidthPx(pill, density)
  const width = pillWidth + trailing
  const status = pill.kind === 'window' || pill.kind === 'context' ? pill.status : 'normal'
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}">` +
    `<style>${STYLE}</style>` +
    `<g class="pill ${status}"><title>${escapeXml(pill.tooltip)}</title>` +
    `<rect class="bg" x=".5" y=".5" width="${pillWidth - 1}" height="${HEIGHT - 1}" rx="6"/>` +
    body(pill, density) +
    '</g></svg>'

  return { id: pill.id, source, alt: pill.alt, width, height: HEIGHT }
}

/** The band for `availablePx`: pills dropped, then compacted, until it fits; gaps inside. */
export function bandSvgs(pills: readonly Pill[], availablePx: number): PillSvg[] {
  const { pills: shown, density } = fitPills(pills, availablePx, pillWidthPx, GAP_WITHIN_PX, GAP_BETWEEN_PX)

  return shown.map((pill, i) =>
    pillSvg(pill, gapBefore(shown, i + 1, GAP_WITHIN_PX, GAP_BETWEEN_PX), density),
  )
}
