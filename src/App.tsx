import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  metrics,
  metricFor,
  goodPercent,
  tierDelta,
  tierRange,
  dateForIndex,
  formatDateKey,
  parseDateKey,
  todayKey,
  nowTimeKey,
  type MetricConfig,
  type Tier,
} from './data/metrics'
import {
  getSession,
  getConfig,
  setConfig,
  getEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  logout,
  ApiError,
  type ApiEntry,
} from './api'
import { LoginScreen } from './LoginScreen'
import './App.css'

// Stands in while GET /api/config is in flight, and if it ever fails. Kept in
// step with DEFAULT_OWNER in functions/api/config.ts.
const DEFAULT_OWNER = 'Smirnova'

const MOBILE_BREAKPOINT = 640
const DESKTOP_MIN_WIDTH = 640
const DESKTOP_MAX_WIDTH = 1400
const MOBILE_DAYS = 30
const DESKTOP_MIN_DAYS = 60
const DESKTOP_MAX_DAYS = 90

function computeVisibleDays(width: number): number {
  if (width < MOBILE_BREAKPOINT) return MOBILE_DAYS
  const t = Math.min(1, Math.max(0, (width - DESKTOP_MIN_WIDTH) / (DESKTOP_MAX_WIDTH - DESKTOP_MIN_WIDTH)))
  return Math.round(DESKTOP_MIN_DAYS + t * (DESKTOP_MAX_DAYS - DESKTOP_MIN_DAYS))
}

/** The name in the title is stored in the database and edited from the
 *  dashboard (see functions/api/config.ts), so renaming needs neither a
 *  rebuild nor a config change. DEFAULT_OWNER renders while the request is in
 *  flight, and stands in if it fails. */
function useSiteOwner(): { owner: string; title: string; rename: (owner: string) => Promise<void> } {
  const [owner, setOwner] = useState(DEFAULT_OWNER)

  useEffect(() => {
    getConfig()
      .then((res) => setOwner(res.owner || DEFAULT_OWNER))
      .catch(() => {})
  }, [])

  const title = `${owner}'s Wellbeing`

  useEffect(() => {
    document.title = title
  }, [title])

  const rename = useCallback(async (next: string) => {
    const res = await setConfig(next)
    setOwner(res.owner)
  }, [])

  return { owner, title, rename }
}

function useVisibleDays(): number {
  const [visibleDays, setVisibleDays] = useState(() => computeVisibleDays(window.innerWidth))

  useEffect(() => {
    function handleResize() {
      setVisibleDays(computeVisibleDays(window.innerWidth))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return visibleDays
}

// Re-runs `refresh` whenever the user comes back to the page (switching back
// to the tab, unlocking the phone, restoring from the back/forward cache), so
// the data and the "today" labels never go stale on a long-lived tab.
function useRefreshOnReturn(enabled: boolean, refresh: () => void) {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    if (!enabled) return
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') refreshRef.current()
    }
    function onFocus() {
      refreshRef.current()
    }
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) refreshRef.current()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [enabled])
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// prettier-ignore
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatDayLabel(date: Date): string {
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`
}

function formatFullDate(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

function byTime(a: ApiEntry, b: ApiEntry): number {
  if (a.time === b.time) return a.id - b.id
  return a.time < b.time ? -1 : 1
}

/** Narrows to the entries that carry a grade. Text-only ones have nothing to
 *  plot, so the bars and the statistics skip straight past them. */
function isGraded(entry: ApiEntry): entry is ApiEntry & { tier: Tier } {
  return entry.tier !== null
}

/** Pairs each entry with the grade of the previous graded check-in of the same
 *  metric, so a diff compares against the last real grade — a text-only entry
 *  in between neither carries a badge nor breaks the chain. */
function withPrevTier(entries: ApiEntry[]): { entry: ApiEntry; prevTier: Tier | null }[] {
  const previous = new Map<string, Tier>()
  return entries.map((entry) => {
    const prevTier = entry.tier ? (previous.get(entry.metric_id) ?? null) : null
    if (entry.tier) previous.set(entry.metric_id, entry.tier)
    return { entry, prevTier }
  })
}

function TierChip({ tier }: { tier: Tier }) {
  return <span className={`tier-chip t-${tier}`}>{tier}</span>
}

/** The diff between two consecutive check-ins: how many grades it moved, and
 *  in which direction. A is best, so moving down the alphabet is a decline. */
function DiffBadge({ metric, from, to }: { metric: MetricConfig; from: Tier; to: Tier }) {
  const delta = tierDelta(metric, from, to)

  if (delta === 0) {
    return (
      <span className="diff-badge diff-badge--same" aria-label="Same as the previous check-in">
        =
      </span>
    )
  }

  const worse = delta > 0
  return (
    <span
      className={`diff-badge ${worse ? 'diff-badge--worse' : 'diff-badge--better'}`}
      aria-label={`${Math.abs(delta)} grade${Math.abs(delta) === 1 ? '' : 's'} ${worse ? 'worse' : 'better'} than the previous check-in`}
    >
      {worse ? '↓' : '↑'}
      {Math.abs(delta)}
    </span>
  )
}

const TOOLTIP_GAP = 10
const VIEWPORT_MARGIN = 8

// `viewport-fit=cover` lets the viewport run under the notch and the home
// indicator, so 0 and innerHeight are not safe edges to clamp against.
function safeInset(name: string): number {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))
  return Number.isFinite(value) ? value : 0
}

interface TooltipState {
  /** True, unclamped centre of the bar — the arrow tracks this. */
  x: number
  /** The bar's edges in viewport coordinates. */
  barTop: number
  barBottom: number
  date: Date
  metric: MetricConfig
  entries: ApiEntry[]
}

function BarTooltip({ tooltip }: { tooltip: TooltipState }) {
  const ref = useRef<HTMLDivElement>(null)
  // The box is clamped to stay fully on-screen. The arrow stays glued to the
  // bar's real centre, and is dropped entirely when clamping pulled the box
  // off the bar so it would otherwise point at nothing.
  const [box, setBox] = useState({
    left: tooltip.x,
    top: tooltip.barTop,
    arrowX: 0,
    flip: false,
    anchored: true,
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { offsetWidth: width, offsetHeight: height } = el

    const half = width / 2
    const left = Math.min(Math.max(tooltip.x, half + VIEWPORT_MARGIN), window.innerWidth - half - VIEWPORT_MARGIN)
    const arrowX = Math.min(Math.max(tooltip.x - (left - half), 14), width - 14)

    // Prefer sitting above the bar, drop below when it does not fit up there,
    // then clamp whichever side was chosen into the safe area. Measuring the
    // real height first is what keeps a tall tooltip from spilling off-screen.
    const limitTop = VIEWPORT_MARGIN + safeInset('--safe-top')
    const limitBottom = window.innerHeight - VIEWPORT_MARGIN - safeInset('--safe-bottom')
    const above = tooltip.barTop - TOOLTIP_GAP - height
    const below = tooltip.barBottom + TOOLTIP_GAP
    const flip = above < limitTop && below + height <= limitBottom
    const ideal = flip ? below : above
    const top = Math.min(Math.max(ideal, limitTop), Math.max(limitTop, limitBottom - height))

    setBox({ left, top, arrowX, flip, anchored: Math.abs(top - ideal) < 0.5 })
  }, [tooltip])

  return (
    <div
      ref={ref}
      className={`bar-tooltip${box.flip ? ' bar-tooltip--flip' : ''}${box.anchored ? '' : ' bar-tooltip--free'}`}
      style={{ left: box.left, top: box.top, '--arrow-x': `${box.arrowX}px` } as CSSProperties}
      role="tooltip"
    >
      <div className="bar-tooltip-body">
        <div className="bar-tooltip-date">{formatDayLabel(tooltip.date)}</div>
        {tooltip.entries.length === 0 ? (
          <div className="bar-tooltip-muted">Nothing recorded</div>
        ) : (
          <ul className="tooltip-entries">
            {withPrevTier(tooltip.entries).map(({ entry, prevTier }) => (
              <li className="tooltip-entry" key={entry.id}>
                <span className="tooltip-entry-head">
                  <span className="entry-time">{entry.time}</span>
                  {entry.tier && <TierChip tier={entry.tier} />}
                  {entry.tier && prevTier && <DiffBadge metric={tooltip.metric} from={prevTier} to={entry.tier} />}
                </span>
                {entry.note && <span className="tooltip-entry-note">{entry.note}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="bar-tooltip-metric">{tooltip.metric.title}</div>
      </div>
    </div>
  )
}

// One bar per day, sliced into equal segments — one per check-in, earliest at
// the top — so a day that swung around reads as a stack of different colours
// instead of a single flat value.
function Bar({
  date,
  entries,
  metric,
  onShow,
  onHide,
}: {
  date: Date
  entries: ApiEntry[]
  metric: MetricConfig
  onShow: (tooltip: TooltipState) => void
  onHide: () => void
}) {
  const ref = useRef<HTMLSpanElement>(null)

  function reveal() {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    // Hand over the bar's geometry and let the tooltip place itself — only it
    // knows how tall it ended up.
    onShow({
      x: rect.left + rect.width / 2,
      barTop: rect.top,
      barBottom: rect.bottom,
      date,
      metric,
      entries,
    })
  }

  const graded = entries.filter(isGraded)
  const noteOnly = entries.length - graded.length

  const label =
    entries.length === 0
      ? 'Nothing recorded'
      : [
          graded.length > 0
            ? `${graded.length} check-in${graded.length === 1 ? '' : 's'}: ${graded.map((e) => e.tier).join(', ')}`
            : null,
          noteOnly > 0 ? `${noteOnly} text-only note${noteOnly === 1 ? '' : 's'}` : null,
        ]
          .filter(Boolean)
          .join('; ')

  return (
    <span
      ref={ref}
      className="bar"
      tabIndex={0}
      role="button"
      aria-label={`${formatDayLabel(date)}:${label}`}
      onMouseEnter={reveal}
      onMouseLeave={onHide}
      onFocus={reveal}
      onBlur={onHide}
      onClick={(e) => {
        e.stopPropagation()
        reveal()
      }}
    >
      {graded.length === 0 ? (
        <span className={`bar-seg bar-seg--none${noteOnly > 0 ? ' bar-seg--note' : ''}`} />
      ) : (
        graded.map((entry) => <span key={entry.id} className={`bar-seg t-${entry.tier}`} />)
      )}
    </span>
  )
}

function TierPicker({
  metric,
  value,
  onChange,
}: {
  metric: MetricConfig
  value: Tier
  onChange: (tier: Tier) => void
}) {
  return (
    <div className="tier-picker" role="radiogroup" aria-label={`${metric.title} grade`}>
      {metric.tiers.map((tier) => (
        <button
          key={tier}
          type="button"
          role="radio"
          aria-checked={tier === value}
          className={`tier-picker-btn${tier === value ? ` is-selected t-${tier}` : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onChange(tier)
          }}
        >
          {tier}
        </button>
      ))}
    </div>
  )
}

function TimeField({ value, onChange }: { value: string; onChange: (time: string) => void }) {
  return (
    <label className="time-field">
      <span className="time-field-label">Time</span>
      <input type="time" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

type EntryMode = 'tier' | 'note'

/** Whether a check-in records a grade or is text only. */
function ModeToggle({ mode, onChange }: { mode: EntryMode; onChange: (mode: EntryMode) => void }) {
  return (
    <div className="mode-toggle" role="tablist" aria-label="Entry type">
      {(['tier', 'note'] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          className={`mode-toggle-btn${mode === value ? ' is-selected' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onChange(value)
          }}
        >
          {value === 'tier' ? 'Grade' : 'Text only'}
        </button>
      ))}
    </div>
  )
}

function CheckInForm({
  metric,
  todayCount,
  onSave,
}: {
  metric: MetricConfig
  todayCount: number
  onSave: (tier: Tier | null, time: string, note: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState<EntryMode>('tier')
  const [tier, setTier] = useState<Tier>(metric.tiers[0])
  const [time, setTime] = useState(nowTimeKey)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function open() {
    setMode('tier')
    setTier(metric.tiers[0])
    setTime(nowTimeKey())
    setNote('')
    setError(null)
    setEditing(true)
  }

  if (!editing) {
    return (
      <div className="checkin-row">
        <button
          type="button"
          className="checkin-toggle"
          onClick={(e) => {
            e.stopPropagation()
            open()
          }}
        >
          {todayCount > 0 ? 'Add another' : 'Check in now'}
        </button>
      </div>
    )
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await onSave(mode === 'tier' ? tier : null, time, note)
      setEditing(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="checkin-form" onClick={(e) => e.stopPropagation()}>
      <ModeToggle mode={mode} onChange={setMode} />
      {mode === 'tier' && (
        <>
          <p className="checkin-label">Which grade right now?</p>
          <TierPicker metric={metric} value={tier} onChange={setTier} />
        </>
      )}
      <TimeField value={time} onChange={setTime} />
      <textarea
        className="checkin-note"
        placeholder={mode === 'tier' ? 'Add a note (optional)' : 'Write something'}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={mode === 'tier' ? 2 : 3}
      />
      {error && <p className="checkin-error">{error}</p>}
      <div className="checkin-actions">
        <button type="button" className="checkin-cancel" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="button-primary"
          onClick={handleSave}
          disabled={saving || (mode === 'note' && !note.trim())}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function MetricRow({
  metric,
  visibleDays,
  entriesByDay,
  canManage,
  onShowTooltip,
  onHideTooltip,
  onCreateEntry,
}: {
  metric: MetricConfig
  visibleDays: number
  entriesByDay: Map<string, ApiEntry[]>
  canManage: boolean
  onShowTooltip: (tooltip: TooltipState) => void
  onHideTooltip: () => void
  onCreateEntry: (tier: Tier | null, time: string, note: string) => Promise<void>
}) {
  const days = useMemo(() => {
    const list: { date: Date; entries: ApiEntry[] }[] = []
    for (let i = 0; i < visibleDays; i++) {
      const date = dateForIndex(i, visibleDays)
      list.push({ date, entries: entriesByDay.get(`${metric.id}|${formatDateKey(date)}`) ?? [] })
    }
    return list
  }, [metric.id, visibleDays, entriesByDay])

  const todayEntries = entriesByDay.get(`${metric.id}|${todayKey()}`) ?? []
  // Text-only entries carry no grade, so everything below that summarises the
  // scale — the chip, the percentage, the swing, the chain — works off these.
  const todayGraded = todayEntries.filter(isGraded)
  const latest = todayGraded.at(-1)
  // Averaged over every check-in in the window, not one value per day, so a day
  // logged five times counts five times.
  const percent = goodPercent(
    metric,
    days.flatMap((d) => d.entries.filter(isGraded).map((e) => e.tier)),
  )
  const swing = tierRange(
    metric,
    todayGraded.map((e) => e.tier),
  )

  return (
    <article className="metric-row">
      <div className="metric-head">
        <h2 className="metric-title">{metric.title}</h2>
        <span className="metric-state">
          {latest ? <TierChip tier={latest.tier} /> : <span className="metric-state-none">Not recorded</span>}
          {todayGraded.length > 1 && swing && (
            <span className="metric-swing">
              {todayGraded.length} today · {swing.best}–{swing.worst}
            </span>
          )}
        </span>
      </div>

      <div className="day-bars" role="img" aria-label={`${metric.title}: self-reported over the last ${days.length} days`}>
        {days.map(({ date, entries }, i) => (
          <Bar
            key={i}
            date={date}
            entries={entries}
            metric={metric}
            onShow={onShowTooltip}
            onHide={onHideTooltip}
          />
        ))}
      </div>

      <div className="metric-foot">
        <span className="foot-label">{visibleDays} days ago</span>
        <span className="foot-line" aria-hidden="true" />
        <span className="foot-stat">{percent === null ? 'Nothing recorded yet' : `${percent.toFixed(1)}% doing well`}</span>
        <span className="foot-line" aria-hidden="true" />
        <span className="foot-label">Today</span>
      </div>

      {todayGraded.length > 1 && (
        <div className="today-chain">
          <span className="today-chain-label">How today moved</span>
          {todayGraded.map((entry, i) => (
            <span className="today-chain-step" key={entry.id}>
              {i > 0 && <DiffBadge metric={metric} from={todayGraded[i - 1].tier} to={entry.tier} />}
              <span className="entry-time">{entry.time}</span>
              <TierChip tier={entry.tier} />
            </span>
          ))}
        </div>
      )}

      {canManage && <CheckInForm metric={metric} todayCount={todayEntries.length} onSave={onCreateEntry} />}
    </article>
  )
}

function LogEntryRow({
  entry,
  metric,
  prevTier,
  canManage,
  onSave,
  onDelete,
}: {
  entry: ApiEntry
  metric: MetricConfig
  prevTier: Tier | null
  canManage: boolean
  onSave?: (id: number, patch: { tier: Tier | null; time: string; note: string | null }) => Promise<void>
  onDelete?: (id: number) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState<EntryMode>(entry.tier ? 'tier' : 'note')
  const [tier, setTier] = useState<Tier>(entry.tier ?? metric.tiers[0])
  const [time, setTime] = useState(entry.time)
  const [note, setNote] = useState(entry.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function open() {
    setMode(entry.tier ? 'tier' : 'note')
    setTier(entry.tier ?? metric.tiers[0])
    setTime(entry.time)
    setNote(entry.note ?? '')
    setError(null)
    setConfirmingDelete(false)
    setEditing(true)
  }

  async function handleSave() {
    if (!onSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave(entry.id, { tier: mode === 'tier' ? tier : null, time, note: note.trim() || null })
      setEditing(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!onDelete) return
    setDeleting(true)
    setError(null)
    try {
      await onDelete(entry.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete. Please try again.')
      setDeleting(false)
    }
  }

  return (
    <div className="log-entry">
      <div className="log-entry-head">
        <span className="entry-time">{entry.time}</span>
        {entry.tier && <TierChip tier={entry.tier} />}
        {entry.tier && prevTier && <DiffBadge metric={metric} from={prevTier} to={entry.tier} />}
        <span className="log-entry-metric">{metric.title}</span>
        {canManage && !editing && (
          <button
            type="button"
            className="log-entry-edit"
            onClick={(e) => {
              e.stopPropagation()
              open()
            }}
          >
            Edit
          </button>
        )}
      </div>

      {!editing && entry.note && <p className="log-entry-note">{entry.note}</p>}

      {editing && (
        <div className="log-entry-form" onClick={(e) => e.stopPropagation()}>
          <ModeToggle mode={mode} onChange={setMode} />
          {mode === 'tier' && <TierPicker metric={metric} value={tier} onChange={setTier} />}
          <TimeField value={time} onChange={setTime} />
          <textarea
            className="checkin-note"
            placeholder={mode === 'tier' ? 'Add a note (optional)' : 'Write something'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={mode === 'tier' ? 2 : 3}
          />
          {error && <p className="checkin-error">{error}</p>}
          <div className="log-entry-actions">
            {confirmingDelete ? (
              <span className="log-entry-confirm">
                Delete this?
                <button type="button" className="log-entry-confirm-yes" onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
                <button
                  type="button"
                  className="log-entry-confirm-no"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" className="log-entry-delete" onClick={() => setConfirmingDelete(true)}>
                Delete
              </button>
            )}
            <span className="log-entry-actions-right">
              <button type="button" className="checkin-cancel" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={handleSave}
                disabled={saving || (mode === 'note' && !note.trim())}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function BrandEditor({
  owner,
  onSave,
  onCancel,
}: {
  owner: string
  onSave: (owner: string) => Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(owner)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!value.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSave(value.trim())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="brand-edit" onClick={(e) => e.stopPropagation()}>
      <input
        className="brand-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') onCancel()
        }}
        maxLength={40}
        autoFocus
        aria-label="Name shown in the title"
      />
      {error && <p className="brand-error">{error}</p>}
      <div className="brand-edit-actions">
        <button type="button" className="checkin-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button-primary" onClick={handleSave} disabled={saving || !value.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function Dashboard({
  owner,
  title,
  entries,
  entriesError,
  visibleDays,
  canManage,
  onLogout,
  onRenameOwner,
  onCreateEntry,
  onSaveEntry,
  onDeleteEntry,
}: {
  owner: string
  title: string
  entries: ApiEntry[]
  entriesError: string | null
  visibleDays: number
  canManage: boolean
  onLogout?: () => void
  onRenameOwner?: (owner: string) => Promise<void>
  onCreateEntry?: (metricId: string, tier: Tier | null, time: string, note: string) => Promise<void>
  onSaveEntry?: (id: number, patch: { tier: Tier | null; time: string; note: string | null }) => Promise<void>
  onDeleteEntry?: (id: number) => Promise<void>
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [renaming, setRenaming] = useState(false)
  const todayLabel = formatDayLabel(new Date())

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setTooltip(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const entriesByDay = useMemo(() => {
    const map = new Map<string, ApiEntry[]>()
    for (const entry of entries) {
      const key = `${entry.metric_id}|${entry.date}`
      const group = map.get(key)
      if (group) group.push(entry)
      else map.set(key, [entry])
    }
    for (const group of map.values()) group.sort(byTime)
    return map
  }, [entries])

  // Newest day first, but chronological inside a day so each entry can be
  // diffed against the previous check-in of the same metric.
  const logGroups = useMemo(() => {
    const byDate = new Map<string, ApiEntry[]>()
    for (const entry of entries) {
      const group = byDate.get(entry.date)
      if (group) group.push(entry)
      else byDate.set(entry.date, [entry])
    }
    return Array.from(byDate.keys())
      .sort((a, b) => (a < b ? 1 : -1))
      .map((date) => ({
        date,
        label: formatFullDate(parseDateKey(date)),
        rows: withPrevTier([...byDate.get(date)!].sort(byTime)),
      }))
  }, [entries])

  return (
    <div className="page" onClick={() => setTooltip(null)}>
      <header className="topbar">
        {renaming ? (
          <BrandEditor
            owner={owner}
            onSave={async (next) => {
              await onRenameOwner!(next)
              setRenaming(false)
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <div className="brand">{title}</div>
        )}
        <div className="topbar-meta">
          <span className="today-date">{todayLabel}</span>
          {canManage && !renaming && (
            <>
              <span className="topbar-divider" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                className="kicker-action"
                onClick={(e) => {
                  e.stopPropagation()
                  setRenaming(true)
                }}
              >
                Rename
              </button>
              <span className="topbar-divider" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                className="kicker-action"
                onClick={(e) => {
                  e.stopPropagation()
                  onLogout?.()
                }}
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      <main>
        {entriesError && <p className="entries-error">{entriesError}</p>}

        <section className="metric-list">
          {metrics.map((metric) => (
            <MetricRow
              key={metric.id}
              metric={metric}
              visibleDays={visibleDays}
              entriesByDay={entriesByDay}
              canManage={canManage}
              onShowTooltip={setTooltip}
              onHideTooltip={() => setTooltip(null)}
              onCreateEntry={(tier, time, note) => onCreateEntry!(metric.id, tier, time, note)}
            />
          ))}
        </section>

        <section className="logs">
          <h2 className="logs-title">Log</h2>
          {logGroups.length === 0 ? (
            <p className="logs-empty">Nothing recorded yet.</p>
          ) : (
            <div className="log-vine">
              {logGroups.map((group) => (
                <div className="log-group" key={group.date}>
                  <h3 className="log-date">{group.label}</h3>
                  <div className="log-entries">
                    {group.rows.map(({ entry, prevTier }) => (
                      <LogEntryRow
                        key={entry.id}
                        entry={entry}
                        metric={metricFor(entry.metric_id)}
                        prevTier={prevTier}
                        canManage={canManage}
                        onSave={onSaveEntry}
                        onDelete={onDeleteEntry}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {tooltip && <BarTooltip tooltip={tooltip} />}
    </div>
  )
}

type AuthState = 'loading' | 'signed-out' | 'signed-in'

export function AdminApp() {
  const visibleDays = useVisibleDays()
  const { owner, title, rename } = useSiteOwner()
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [entries, setEntries] = useState<ApiEntry[]>([])
  const [entriesError, setEntriesError] = useState<string | null>(null)

  const loadEntries = useCallback(() => {
    getEntries()
      .then((res) => {
        setEntries(res.entries)
        setEntriesError(null)
      })
      .catch((err) => setEntriesError(err instanceof ApiError ? err.message : 'Could not load the log'))
  }, [])

  useEffect(() => {
    getSession()
      .then((res) => setAuthState(res.authenticated ? 'signed-in' : 'signed-out'))
      .catch(() => setAuthState('signed-out'))
  }, [])

  useEffect(() => {
    if (authState === 'signed-in') loadEntries()
  }, [authState, loadEntries])

  useRefreshOnReturn(authState === 'signed-in', loadEntries)

  async function handleCreateEntry(metricId: string, tier: Tier | null, time: string, note: string) {
    const { entry } = await createEntry({ metricId, date: todayKey(), time, tier, note: note.trim() || null })
    setEntries((prev) => [...prev, entry])
  }

  async function handleSaveEntry(id: number, patch: { tier: Tier | null; time: string; note: string | null }) {
    const { entry } = await updateEntry(id, patch)
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? entry : e)))
  }

  async function handleDeleteEntry(id: number) {
    await deleteEntry(id)
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  async function handleLogout() {
    await logout().catch(() => {})
    setEntries([])
    setAuthState('signed-out')
  }

  if (authState === 'loading') {
    return <div className="page login-page" aria-busy="true" />
  }

  if (authState === 'signed-out') {
    return <LoginScreen title={title} onSuccess={() => setAuthState('signed-in')} />
  }

  return (
    <Dashboard
      owner={owner}
      title={title}
      entries={entries}
      entriesError={entriesError}
      visibleDays={visibleDays}
      canManage
      onLogout={handleLogout}
      onRenameOwner={rename}
      onCreateEntry={handleCreateEntry}
      onSaveEntry={handleSaveEntry}
      onDeleteEntry={handleDeleteEntry}
    />
  )
}

export function PublicApp() {
  const visibleDays = useVisibleDays()
  const { owner, title } = useSiteOwner()
  const [loaded, setLoaded] = useState(false)
  const [entries, setEntries] = useState<ApiEntry[]>([])
  const [entriesError, setEntriesError] = useState<string | null>(null)

  const loadEntries = useCallback(() => {
    getEntries()
      .then((res) => {
        setEntries(res.entries)
        setEntriesError(null)
      })
      .catch((err) => setEntriesError(err instanceof ApiError ? err.message : 'Could not load the log'))
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  useRefreshOnReturn(true, loadEntries)

  if (!loaded) {
    return <div className="page login-page" aria-busy="true" />
  }

  return (
    <Dashboard
      owner={owner}
      title={title}
      entries={entries}
      entriesError={entriesError}
      visibleDays={visibleDays}
      canManage={false}
    />
  )
}
