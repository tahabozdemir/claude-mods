/** One rate-limit window as the band keeps it. */
export type UsageBandWindow = {
  /** 0 to 100, as the API reports it. */
  percentUsed: number
  /** When the window resets, in epoch milliseconds; null when unreported. */
  resetsAt: number | null
}

/** The live context window. */
export type UsageBandContext = {
  /** Tokens the last response was answered over; null before the first one. */
  tokens: number | null
  /** The model's context window, in tokens. */
  window: number
  /** `tokens` over `window`, 0 to 100; null before the first response. */
  percent: number | null
}

/** Token totals of the session, main thread and subagents together. */
export type UsageBandTokens = {
  /** Uncached input tokens. */
  input: number
  /** Input tokens written to the prompt cache. */
  cacheCreation: number
  output: number
  /** Input tokens the prompt cache served. */
  cacheRead: number
  /** API requests counted (turns, on the fallback path). */
  requests: number
}

/** Everything the band draws from, as of one refresh. */
export type UsageBandSnapshot = {
  fiveHour: UsageBandWindow | null
  sevenDay: UsageBandWindow | null
  context: UsageBandContext | null
  /** Session cost in US dollars at API list prices; null when not reported. */
  costUsd: number | null
  tokens: UsageBandTokens | null
  /** True when `tokens` came from turn.complete sums, not the transcripts. */
  isTokensEstimated: boolean
  /** The host's local time zone, minutes east of UTC, for absolute reset times. */
  utcOffsetMinutes: number
}

/** Size and modification time of the main transcript at the last script run. */
export type UsageBandTranscript = {
  path: string
  size: number
  mtimeMs: number
}

/** `auto` hides the cost pill on a subscription and shows it otherwise. */
export type UsageBandCostMode = 'auto' | 'on' | 'off'

/** Inferred from the rate-limit windows: only subscriptions report them. */
export type UsageBandPlan = 'subscription' | 'api' | 'unknown'

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      snapshot: UsageBandSnapshot | null
      /** The clock at the last refresh; countdowns and pace are drawn against it. */
      now: number
      plan: UsageBandPlan
      isHidden: boolean
      costMode: UsageBandCostMode
      /** Running sum of turn.complete usage, used when the script fails. */
      fallbackTokens: UsageBandTokens
      /** Cache key of `scriptTokens`. */
      transcript: UsageBandTranscript | null
      scriptTokens: UsageBandTokens | null
    }
  }
}
