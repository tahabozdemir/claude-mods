import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

const MIN = 60_000
const H = 60 * MIN
const NOW = Date.UTC(2026, 9, 3, 4)

const USAGE: SessionUsage = {
  startedAt: NOW - H,
  context: { tokens: 124_000, window: 200_000, percent: 62 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 20, resetsAt: new Date(NOW + 2 * H + 40 * MIN).toISOString() },
    { kind: 'seven_day', percentUsed: 58, resetsAt: new Date(NOW + 31 * H).toISOString() },
  ],
  cost: { usd: 4.32 },
}
const TOKENS = { input: 2_100, cacheCreation: 13_500, output: 3_000, cacheRead: 954_200, requests: 42 }

const RUN = {
  command: 'usage-pill',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 160,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

/** The world beneath the plugin: clock, store, session, files, the script. */
function world(on: On, script: { exitCode: number; stdout: string }) {
  mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME: '/home/test' })
  on('session.id', () => ({ value: 'test-session' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.root', () => ({ value: '/work' }))
  on('session.usage', () => ({ value: USAGE }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('process.run', () => ({
    value: { ...script, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  // The engine's own answers where the plugin passes on.
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })
}

test('/usage-pill refreshes and prints the summary', async ($, on) => {
  world(on, { exitCode: 0, stdout: `${JSON.stringify(TOKENS)}\n` })
  const { text } = await $.command.run({ ...RUN, args: '' })
  // The sandbox clock is the host's zone; only the 7d clock time depends on it.
  expect(text ?? '').toMatch(
    /^5h 20% \(2h 40m\) · 7d 58% \([A-Z][a-z]{2} \d\d:\d\d\) · ctx 62% · ↑15\.6k ↓3\.0k ⧉954\.2k · ≈\$4\.32$/,
  )
})

test('a failing script falls back to turn.complete sums, marked ~', async ($, on) => {
  world(on, { exitCode: 1, stdout: '' })
  await $.turn.complete({
    answer: '',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: {
      input_tokens: 600,
      cache_creation_input_tokens: 1_000,
      output_tokens: 250,
      cache_read_input_tokens: 9_000,
      model: 'test',
    },
  })
  const { text } = await $.command.run({ ...RUN, args: '' })
  expect(text ?? '').toContain('↑~1.6k ↓~250 ⧉~9.0k')
})

test('the band draws on the terminal and the desktop', async ($, on) => {
  world(on, { exitCode: 0, stdout: `${JSON.stringify(TOKENS)}\n` })
  await $.command.run({ ...RUN, args: 'cost on' })
  await $.command.run({ ...RUN, args: '' })

  const terminal = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })
  expect(await terminal.find({ type: 'Text', text: '██░░░│░░░░░' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: '≈$4.32' })).toBeDefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })
  const svgs = await desktop.findAll({ type: 'Svg' })
  expect(svgs.length).toBe(5)
  // Each pill is interactive, so its <title> shows as the tooltip.
  for (const svg of svgs) expect(svg.props.isInteractive).toBe(true)
  expect(String(svgs[0]?.props.source)).toContain(
    '<title>5-hour limit: 20% used\n47% of the window elapsed\nResets in 2h 40m · ',
  )
  expect(String(svgs[0]?.props.source)).toContain('On pace to stay under the limit</title>')
  await desktop.unmount()
})

test('hide steps aside; a survey steps aside', async ($, on) => {
  world(on, { exitCode: 0, stdout: `${JSON.stringify(TOKENS)}\n` })
  await $.command.run({ ...RUN, args: '' })

  const withSurvey = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...BAND_PROPS, hasSurvey: true },
  })
  expect(await withSurvey.find({ type: 'Text', text: /5h/ })).toBe(undefined)
  expect(await withSurvey.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  await withSurvey.unmount()

  await $.command.run({ ...RUN, args: 'hide' })
  const hidden = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })
  expect(await hidden.find({ type: 'Text', text: /5h/ })).toBe(undefined)
  expect(await hidden.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  await hidden.unmount()
})

test('unknown arguments print usage help', async ($, on) => {
  world(on, { exitCode: 0, stdout: '' })
  const { text } = await $.command.run({ ...RUN, args: 'frobnicate' })
  expect(text ?? '').toContain('Usage: /usage-pill')
})

test('narrow bands compact the pills that stay instead of clipping', async ($, on) => {
  world(on, { exitCode: 0, stdout: `${JSON.stringify(TOKENS)}\n` })
  await $.command.run({ ...RUN, args: '' })

  // 30 columns: only 5h and context fit, as label and percentage.
  const terminal = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...BAND_PROPS, bodyColumns: 30 },
  })
  expect(await terminal.find({ type: 'Text', text: '  5h  20%' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /█/ })).toBe(undefined)
  await terminal.unmount()

  // 30 cells × 7.2px = 216px: minimal desktop pills (169px), two of them.
  const desktop = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { ...BAND_PROPS, bodyColumns: 30 },
  })
  const widths = (await desktop.findAll({ type: 'Svg' })).map(svg => svg.props.width)
  expect(widths).toEqual([83, 86])
  await desktop.unmount()
})

test('desktopCellPx widens what the desktop band fits', { options: { desktopCellPx: 10 } }, async ($, on) => {
  world(on, { exitCode: 0, stdout: `${JSON.stringify(TOKENS)}\n` })
  await $.command.run({ ...RUN, args: '' })

  // 30 cells × 10px = 300px: compact 5h (121px + 4px gap) and context (128px).
  const desktop = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { ...BAND_PROPS, bodyColumns: 30 },
  })
  const widths = (await desktop.findAll({ type: 'Svg' })).map(svg => svg.props.width)
  expect(widths).toEqual([125, 128])
  await desktop.unmount()
})
