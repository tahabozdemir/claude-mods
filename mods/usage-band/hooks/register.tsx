import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionUsage } from 'claude-code'

import type {
  UsageBandCostMode,
  UsageBandPlan,
  UsageBandSnapshot,
  UsageBandTokens,
  UsageBandWindow,
} from '../types'
import { buildPills, fitPills, gapBefore, summaryLine } from './band'
import { bandSvgs, DEFAULT_DESKTOP_CELL_PX } from './svg'
import { GAP_BETWEEN_COLUMNS, GAP_WITHIN_COLUMNS, terminalPill, terminalWidth } from './terminal'
import type { Tone } from './terminal'

const ZERO_TOKENS: UsageBandTokens = { input: 0, cacheCreation: 0, output: 0, cacheRead: 0, requests: 0 }

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const now = atom({ plugin: 'usage-band', key: 'now' } as const, 0)
const plan = atom({ plugin: 'usage-band', key: 'plan' } as const, 'unknown')
const isHidden = atom({ plugin: 'usage-band', key: 'isHidden' } as const, false)
const costMode = atom({ plugin: 'usage-band', key: 'costMode' } as const, 'auto')
const fallbackTokens = atom({ plugin: 'usage-band', key: 'fallbackTokens' } as const, ZERO_TOKENS)
const transcript = atom({ plugin: 'usage-band', key: 'transcript' } as const, null)
const scriptTokens = atom({ plugin: 'usage-band', key: 'scriptTokens' } as const, null)

const COMMAND = 'usage-pill'
const TICK_MS = 30_000
const NODE_CANDIDATES = ['node', '/usr/local/bin/node', '/opt/homebrew/bin/node'] as const

const HELP = [
  'Usage: /usage-pill [hide | show | cost on | cost off | cost auto]',
  '  /usage-pill            refresh now and print a summary',
  '  /usage-pill hide|show  hide or show the band',
  '  /usage-pill cost on    show the cost pill',
  '  /usage-pill cost off   hide the cost pill',
  '  /usage-pill cost auto  hide it on a subscription, show it otherwise (default)',
].join('\n')

type Engine = EngineInterface
type Measured = Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>

const STATUS_COLOR = { warning: 'warning', critical: 'error' } as const

// --- Data ------------------------------------------------------------------

function toWindow(limits: readonly SessionRateLimit[], kind: string): UsageBandWindow | null {
  const found = limits.find(limit => limit.kind === kind)
  if (found === undefined) return null
  const resetsAt = found.resetsAt === undefined ? Number.NaN : Date.parse(found.resetsAt)

  return { percentUsed: found.percentUsed, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null }
}

async function projectsDir($: Engine): Promise<string | null> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configDir) return `${configDir}/projects`
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))

  return home ? `${home}/.claude/projects` : null
}

/** The main transcript: the project folder named after the cwd first, then a scan. */
async function findTranscript($: Engine, id: string): Promise<string | null> {
  const projects = await projectsDir($)
  if (projects === null) return null

  for (const dir of [await $.session.cwd(), await $.session.root()]) {
    const guess = `${projects}/${dir.replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`
    if (await $.fs.exists(guess)) return guess
  }
  const entries = await $.fs.list(projects).catch(() => [])
  for (const entry of entries) {
    const path = `${projects}/${entry.name}/${id}.jsonl`
    if (entry.kind === 'dir' && (await $.fs.exists(path))) return path
  }

  return null
}

function parseTokens(stdout: string): UsageBandTokens | null {
  try {
    const value: unknown = JSON.parse(stdout.trim().split('\n').at(-1) ?? '')
    if (typeof value !== 'object' || value === null) return null
    const row = value as Record<string, unknown>
    const tokens = { ...ZERO_TOKENS }
    for (const key of Object.keys(ZERO_TOKENS) as (keyof UsageBandTokens)[]) {
      const field = row[key]
      if (typeof field !== 'number' || !Number.isFinite(field)) return null
      tokens[key] = field
    }

    return tokens
  } catch {
    return null
  }
}

/** Runs scripts/tokens.mjs with the first node that starts; null when it fails. */
async function runTokensScript($: Engine, id: string): Promise<UsageBandTokens | null> {
  const script = `${$.plugin.root}/scripts/tokens.mjs`
  for (const node of NODE_CANDIDATES) {
    let ran
    try {
      ran = await $.process.run([node, script, id], { timeoutMs: 60_000 })
    } catch {
      continue // this node could not start (or timed out): try the next
    }

    return ran.exitCode === 0 ? parseTokens(ran.stdout) : null
  }

  return null
}

/** Token totals from the transcripts, rerun only when the main one changed. */
async function readTokens($: Engine): Promise<{ tokens: UsageBandTokens; isEstimated: boolean }> {
  const id = await $.session.id()
  const cached = await read($, transcript)
  const path = cached?.path.endsWith(`/${id}.jsonl`) ? cached.path : await findTranscript($, id)
  const stat = path === null ? null : await $.fs.stat(path).catch(() => null)
  const lastTokens = await read($, scriptTokens)

  const isUnchanged =
    stat !== null && cached !== null && lastTokens !== null &&
    cached.path === path && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs
  if (isUnchanged) return { tokens: lastTokens, isEstimated: false }

  const tokens = await runTokensScript($, id)
  if (tokens !== null) {
    await update($, scriptTokens, () => tokens)
    if (path !== null && stat !== null) {
      await update($, transcript, () => ({ path, size: stat.size, mtimeMs: stat.mtimeMs }))
    }

    return { tokens, isEstimated: false }
  }

  return { tokens: await read($, fallbackTokens), isEstimated: true }
}

/** Subscriptions alone report rate-limit windows; a response without any means API billing. */
function inferPlan(current: UsageBandPlan, usage: Measured): UsageBandPlan {
  const hasWindows = usage.rateLimits.some(l => l.kind === 'five_hour' || l.kind === 'seven_day')
  if (hasWindows) return 'subscription'
  if (current === 'unknown' && usage.context.tokens !== undefined) return 'api'

  return current
}

async function refreshOnce($: Engine, measured?: Measured): Promise<void> {
  const usage = measured ?? (await $.session.usage())
  const at = await $.clock.now()
  const { tokens, isEstimated } = await readTokens($)
  const context = usage.context
  const percent =
    context.percent ??
    (context.tokens === undefined || context.window <= 0 ? null : Math.round((context.tokens / context.window) * 100))

  const next: UsageBandSnapshot = {
    fiveHour: toWindow(usage.rateLimits, 'five_hour'),
    sevenDay: toWindow(usage.rateLimits, 'seven_day'),
    context: { tokens: context.tokens ?? null, window: context.window, percent },
    costUsd: usage.cost?.usd ?? null,
    tokens,
    isTokensEstimated: isEstimated,
    utcOffsetMinutes: -new Date(at).getTimezoneOffset(),
  }
  await update($, snapshot, () => next)
  await update($, now, () => at)

  const currentPlan = await read($, plan)
  const nextPlan = inferPlan(currentPlan, usage)
  if (nextPlan !== currentPlan) {
    await update($, plan, () => nextPlan)
    await $.store.set('plan', nextPlan)
  }
}

// One refresh at a time; calls during one fold into a single rerun after it.
let running: Promise<void> | null = null
let isQueued = false
let queuedUsage: Measured | undefined

function refresh($: Engine, measured?: Measured): Promise<void> {
  if (running !== null) {
    isQueued = true
    queuedUsage = measured ?? queuedUsage

    return running
  }
  running = (async () => {
    try {
      await refreshOnce($, measured)
      while (isQueued) {
        isQueued = false
        const usage = queuedUsage
        queuedUsage = undefined
        await refreshOnce($, usage)
      }
    } finally {
      running = null
    }
  })()

  return running
}

async function loadPreferences($: Engine): Promise<void> {
  const [storedHidden, storedCost, storedPlan] = await Promise.all([
    $.store.get('isHidden'),
    $.store.get('costMode'),
    $.store.get('plan'),
  ])
  if (typeof storedHidden === 'boolean') await update($, isHidden, () => storedHidden)
  if (storedCost === 'auto' || storedCost === 'on' || storedCost === 'off') await update($, costMode, () => storedCost)
  if (storedPlan === 'subscription' || storedPlan === 'api') await update($, plan, () => storedPlan)
}

async function setHidden($: Engine, value: boolean): Promise<void> {
  await update($, isHidden, () => value)
  await $.store.set('isHidden', value)
}

async function setCostMode($: Engine, value: UsageBandCostMode): Promise<void> {
  await update($, costMode, () => value)
  await $.store.set('costMode', value)
}

// --- Hooks -----------------------------------------------------------------

export const register: Register = (on, options) => {
  const configured = options.desktopCellPx
  const cellPx = typeof configured === 'number' && configured > 0 ? configured : DEFAULT_DESKTOP_CELL_PX

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Usage band: refresh and summarize rate limits, context, tokens and cost',
      argumentHint: '[hide | show | cost on | cost off | cost auto]',
    })
    await loadPreferences($)
    $.clock.every(TICK_MS, () => void refresh($))
    void refresh($)

    return next(e)
  })

  on('session.measure', ($, e, next) => {
    void refresh($, e)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const usage = e.usage
    if (usage !== undefined) {
      await update($, fallbackTokens, total => ({
        input: total.input + usage.input_tokens,
        cacheCreation: total.cacheCreation + usage.cache_creation_input_tokens,
        output: total.output + usage.output_tokens,
        cacheRead: total.cacheRead + usage.cache_read_input_tokens,
        requests: total.requests + 1,
      }))
    }

    return next(e)
  })

  // /clear starts a new session id: forget the old one's totals.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, fallbackTokens, () => ZERO_TOKENS)
      await update($, transcript, () => null)
      await update($, scriptTokens, () => null)
      await update($, snapshot, () => null)
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const args = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ')
    switch (args) {
      case '': {
        await refresh($)
        const [held, at, heldPlan, mode] = await Promise.all([
          read($, snapshot),
          read($, now),
          read($, plan),
          read($, costMode),
        ])

        return { text: summaryLine({ snapshot: held, now: at, plan: heldPlan, costMode: mode }) }
      }
      case 'hide':
        await setHidden($, true)

        return { text: 'Usage band hidden. /usage-pill show brings it back.' }
      case 'show':
        await setHidden($, false)

        return { text: 'Usage band shown.' }
      case 'cost on':
      case 'cost off':
      case 'cost auto': {
        const mode = args.slice('cost '.length) as UsageBandCostMode
        await setCostMode($, mode)
        const said = { on: 'shown', off: 'hidden', auto: 'hidden on a subscription, shown otherwise' }[mode]

        return { text: `Cost pill ${said}.` }
      }
      default:
        return { text: HELP }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const [held, at, heldPlan, mode] = await Promise.all([
      read($, snapshot),
      read($, now),
      read($, plan),
      read($, costMode),
    ])
    const pills = buildPills({ snapshot: held, now: at, plan: heldPlan, costMode: mode })
    if (pills === null) return next(e)

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      const { pills: shown, density } = fitPills(
        pills,
        e.props.bodyColumns,
        terminalWidth,
        GAP_WITHIN_COLUMNS,
        GAP_BETWEEN_COLUMNS,
      )

      return (
        <Box flexDirection="row" flexWrap="nowrap" overflow="hidden">
          {shown.map((pill, i) => {
            const { status, segments } = terminalPill(pill, density)
            const colorOf = (tone: Tone) =>
              tone === 'status' && status !== 'normal' ? STATUS_COLOR[status] : undefined

            return (
              <Box flexShrink={0} marginLeft={gapBefore(shown, i, GAP_WITHIN_COLUMNS, GAP_BETWEEN_COLUMNS)}>
                <Text wrap="truncate">
                  {segments.map(segment => (
                    <Text
                      color={colorOf(segment.tone)}
                      dimColor={segment.tone === 'dim' || (segment.tone === 'status' && status === 'normal')}
                      bold={segment.isBold === true}
                    >
                      {segment.text}
                    </Text>
                  ))}
                </Text>
              </Box>
            )
          })}
        </Box>
      )
    }

    const { Box, Svg } = $.ui.resolve(e)
    const svgs = bandSvgs(pills, e.props.bodyColumns * cellPx)

    return (
      <Box flexDirection="row" flexWrap="nowrap" overflow="hidden">
        {svgs.map(svg => (
          <Svg source={svg.source} alt={svg.alt} width={svg.width} height={svg.height} isInteractive />
        ))}
      </Box>
    )
  })
}
