// Renders the README images from usage-band's own code, in a light and a dark theme.
//
//   bun tools/screenshots/render.ts
//
// Writes docs/images/{hero,states}-{light,dark}.png with headless Chrome at 2x.
// Set CHROME to the browser binary when it is not at the macOS default path.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { UsageBandSnapshot } from '../../mods/usage-band/types'
import { buildPills, fitPills, gapBefore } from '../../mods/usage-band/hooks/band'
import type { BandInput, Pill } from '../../mods/usage-band/hooks/band'
import { bandSvgs } from '../../mods/usage-band/hooks/svg'
import {
  GAP_BETWEEN_COLUMNS,
  GAP_WITHIN_COLUMNS,
  terminalPill,
  terminalWidth,
} from '../../mods/usage-band/hooks/terminal'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = resolve(import.meta.dir, '../../docs/images')

const MIN = 60_000
const H = 60 * MIN
// Sat 2026-10-03 07:00 at UTC+3, so the 7d reset (1d 7h on) reads Sun 14:00.
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

const band = (patch: Partial<UsageBandSnapshot> = {}): Pill[] => {
  const input: BandInput = { snapshot: { ...SAMPLE, ...patch }, now: NOW, plan: 'subscription', costMode: 'auto' }

  return buildPills(input) ?? []
}

const NORMAL = band()
const WARNING = band({ fiveHour: { percentUsed: 40, resetsAt: NOW + 4 * H + 30 * MIN } })
const CRITICAL = band({ fiveHour: { percentUsed: 95, resetsAt: NOW + 1 * H + 10 * MIN } })

// --- Markup ------------------------------------------------------------------

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

function terminalLine(pills: Pill[], columns: number): string {
  const { pills: shown, density } = fitPills(pills, columns, terminalWidth, GAP_WITHIN_COLUMNS, GAP_BETWEEN_COLUMNS)

  return shown
    .map((pill, i) => {
      const { status, segments } = terminalPill(pill, density)
      const gap = ' '.repeat(gapBefore(shown, i, GAP_WITHIN_COLUMNS, GAP_BETWEEN_COLUMNS))
      const body = segments
        .map(segment => {
          const tone =
            segment.tone === 'status' && status !== 'normal' ? status : segment.tone === 'plain' ? 'plain' : 'dim'

          return `<span class="${tone}${segment.isBold ? ' b' : ''}">${escapeHtml(segment.text)}</span>`
        })
        .join('')

      return gap + body
    })
    .join('')
}

function desktopBand(pills: Pill[], widthPx: number): string {
  return bandSvgs(pills, widthPx)
    .map(
      svg =>
        `<iframe sandbox title="${escapeAttr(svg.alt)}" width="${svg.width}" height="${svg.height}" srcdoc="${escapeAttr(
          `<!doctype html><meta name="color-scheme" content="light dark"><style>html,body{margin:0;background:transparent}</style>${svg.source}`,
        )}"></iframe>`,
    )
    .join('')
}

const BASE_STYLE = `
:root{--win:#FFFFFF;--bar:#F2F2F0;--edge:#D9D9D6;--ink:#2B2B2B;--dim:#7A7A7A;--you:#F0F0EE;--accent:#C15F3C;--warning:#966C1E;--critical:#AB2B3F;--sub:#6B6B6B;--shadow:rgba(0,0,0,.12)}
@media (prefers-color-scheme:dark){:root{--win:#1A1A1C;--bar:#26262A;--edge:#38383D;--ink:#E4E4E6;--dim:#8A8A90;--you:#26262A;--accent:#D97757;--warning:#FFC107;--critical:#FF6B80;--sub:#9A9AA0;--shadow:rgba(0,0,0,.45)}}
html,body{margin:0;background:transparent}
body{padding:24px;font:13px -apple-system,system-ui,sans-serif;color:var(--ink)}
.window{background:var(--win);border:1px solid var(--edge);border-radius:12px;overflow:hidden;box-shadow:0 10px 30px var(--shadow)}
.bar{height:34px;background:var(--bar);border-bottom:1px solid var(--edge);display:flex;align-items:center;gap:8px;padding:0 14px;position:relative}
.bar i{width:12px;height:12px;border-radius:50%;display:block}
.bar i:nth-child(1){background:#FF5F57}.bar i:nth-child(2){background:#FEBC2E}.bar i:nth-child(3){background:#28C840}
.bar span{position:absolute;left:0;right:0;text-align:center;color:var(--sub);font-size:12px}
`

function heroHtml(): string {
  const columns = 104
  const rule = '─'.repeat(columns)

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>${BASE_STYLE}
pre{margin:0;padding:16px 18px 18px;font:13px/1.55 "SF Mono",ui-monospace,Menlo,monospace;white-space:pre;width:${columns}ch}
.dim{color:var(--dim)} .plain{color:var(--ink)} .warning{color:var(--warning)} .critical{color:var(--critical)} .b{font-weight:700}
.you{background:var(--you);display:inline-block;width:100%} .dot{color:var(--accent)} .cursor{background:var(--ink)}
</style></head><body><div class="window"><div class="bar"><i></i><i></i><i></i><span>claude</span></div><pre>
<span class="you"><span class="dim">&gt;</span> Add rate limiting to the upload endpoint</span>

<span class="dot">⏺</span> I'll add a token-bucket limiter as middleware and wire it into the upload route.

<span class="dot">⏺</span> <span class="b">Update</span>(src/middleware/rate-limit.ts)
  <span class="dim">⎿  Added 38 lines</span>

<span class="dot">⏺</span> Done. Uploads are now limited to 10 requests per minute per user.

${terminalLine(WARNING, columns)}
<span class="dim">${rule}</span>
<span class="dim">&gt;</span> <span class="cursor"> </span>
<span class="dim">${rule}</span></pre></div></body></html>`
}

function statesHtml(): string {
  const rows: [string, string, Pill[]][] = [
    ['Normal', 'Plenty of room left', NORMAL],
    ['Warning', 'At this pace you hit the limit before it resets', WARNING],
    ['Critical', '90% used, or about to run out', CRITICAL],
  ]

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>${BASE_STYLE}
.card{padding:6px 20px}
.row{display:flex;align-items:center;gap:16px;padding:12px 0}
.row + .row{border-top:1px solid var(--edge)}
.label{width:250px;flex:none} .label b{display:block;font-size:13px} .label small{color:var(--sub);font-size:12px}
.band{display:flex;flex-wrap:nowrap}.band iframe{border:0;display:block;flex:none}
</style></head><body><div class="window"><div class="bar"><i></i><i></i><i></i><span>Claude desktop app</span></div><div class="card">
${rows
  .map(
    ([title, note, pills]) =>
      `<div class="row"><div class="label"><b>${title}</b><small>${note}</small></div><div class="band">${desktopBand(pills, 900)}</div></div>`,
  )
  .join('\n')}
</div></div></body></html>`
}

// --- Capture -------------------------------------------------------------------

const PAGES = [
  { name: 'hero', html: heroHtml(), width: 950, height: 384 },
  { name: 'states', html: statesHtml(), width: 1048, height: 266 },
]
const SCHEMES = [
  { name: 'dark', blink: 0 },
  { name: 'light', blink: 1 },
]

const work = mkdtempSync(join(tmpdir(), 'usage-band-shots-'))
for (const page of PAGES) {
  const file = join(work, `${page.name}.html`)
  writeFileSync(file, page.html)
  for (const scheme of SCHEMES) {
    const out = join(OUT, `${page.name}-${scheme.name}.png`)
    const run = Bun.spawnSync([
      CHROME,
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--default-background-color=00000000',
      `--blink-settings=preferredColorScheme=${scheme.blink}`,
      `--window-size=${page.width},${page.height}`,
      `--screenshot=${out}`,
      `file://${file}`,
    ])
    if (run.exitCode !== 0) throw new Error(`Chrome failed on ${out}: ${run.stderr.toString()}`)
    console.log(`wrote ${out}`)
  }
}
