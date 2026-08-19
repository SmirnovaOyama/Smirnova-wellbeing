export type Tier = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export const VALID_TIERS: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D', 'E', 'F'])

// Grades each metric accepts. Kept in step with src/data/metrics.ts — mood tops
// out at E, only suicidal ideation can reach F.
export const METRIC_TIERS: Record<string, ReadonlySet<string>> = {
  mood: new Set(['A', 'B', 'C', 'D', 'E']),
  'suicidal-ideation': new Set(['A', 'B', 'C', 'D', 'E', 'F']),
}

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export interface EntryRow {
  id: number
  metric_id: string
  date: string
  time: string
  /** null on a text-only entry, which carries a note instead of a grade. */
  tier: Tier | null
  note: string | null
  created_at: string
  updated_at: string
}
