export type Tier = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export const ALL_TIERS: Tier[] = ['A', 'B', 'C', 'D', 'E', 'F']

export interface MetricConfig {
  id: string
  title: string
  /** Grades this metric accepts, best first. Mood stops at E; ideation adds F. */
  tiers: Tier[]
}

export const metrics: MetricConfig[] = [
  {
    id: 'mood',
    title: 'Mood',
    tiers: ['A', 'B', 'C', 'D', 'E'],
  },
  {
    id: 'suicidal-ideation',
    title: 'Suicidal ideation',
    tiers: ['A', 'B', 'C', 'D', 'E', 'F'],
  },
]

export function metricById(id: string): MetricConfig | undefined {
  return metrics.find((m) => m.id === id)
}

// Rows read back from the API carry whatever metric_id was stored, which may
// predate the current config. Fall back to a full A–F scale so an unknown
// metric still renders instead of silently disappearing from the log.
export function metricFor(id: string): MetricConfig {
  return metricById(id) ?? { id, title: id, tiers: ALL_TIERS }
}

export function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function dateForIndex(index: number, totalDays: number): Date {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - (totalDays - 1 - index))
  return date
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function todayKey(): string {
  return formatDateKey(new Date())
}

export function nowTimeKey(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** Steps between two grades on this metric's own scale. Positive = got worse. */
export function tierDelta(metric: MetricConfig, from: Tier, to: Tier): number {
  return metric.tiers.indexOf(to) - metric.tiers.indexOf(from)
}

// 1 for the best grade down to 0 for the worst, spread evenly over the metric's
// own depth so mood (A–E) and suicidal ideation (A–F) stay comparable.
export function tierScore(metric: MetricConfig, tier: Tier): number {
  const index = metric.tiers.indexOf(tier)
  if (index === -1) return 0
  return 1 - index / (metric.tiers.length - 1)
}

export function goodPercent(metric: MetricConfig, tiers: Tier[]): number | null {
  if (tiers.length === 0) return null
  const score = tiers.reduce((sum, tier) => sum + tierScore(metric, tier), 0)
  return (score / tiers.length) * 100
}

export function tierRange(metric: MetricConfig, tiers: Tier[]): { best: Tier; worst: Tier } | null {
  let bestIndex = metric.tiers.length
  let worstIndex = -1
  for (const tier of tiers) {
    const index = metric.tiers.indexOf(tier)
    if (index === -1) continue
    if (index < bestIndex) bestIndex = index
    if (index > worstIndex) worstIndex = index
  }
  if (worstIndex === -1) return null
  return { best: metric.tiers[bestIndex], worst: metric.tiers[worstIndex] }
}
