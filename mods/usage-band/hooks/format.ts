// Number and time formatting: pure functions.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

const MINUTE = 60_000

/** Up to 999 as is, then `15.6k`, then `1.25M`. */
export function formatCount(n: number): string {
  const value = Math.max(0, Math.round(n))
  if (value < 1000) return String(value)
  if (value < 999_950) return `${(value / 1000).toFixed(1)}k`

  return `${(value / 1_000_000).toFixed(2)}M`
}

/** Exact count with thousands separators: `1,234,567`. */
export function formatExact(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** `<1m`, `45m`, `2h 40m`, `1d 7h`. */
export function formatDuration(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / MINUTE)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`

  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** `Sun 14:00` in the zone `utcOffsetMinutes` east of UTC. */
export function formatClock(epochMs: number, utcOffsetMinutes: number): string {
  const local = new Date(epochMs + utcOffsetMinutes * MINUTE)
  const hh = String(local.getUTCHours()).padStart(2, '0')
  const mm = String(local.getUTCMinutes()).padStart(2, '0')

  return `${WEEKDAYS[local.getUTCDay()]} ${hh}:${mm}`
}

/** `$4.32`; whole dollars from $1,000. */
export function formatUsd(usd: number): string {
  return usd >= 1000 ? `$${formatExact(usd)}` : `$${usd.toFixed(2)}`
}

export function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`
}
