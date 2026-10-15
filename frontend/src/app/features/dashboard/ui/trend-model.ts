import { ParamMap } from '@angular/router';
import {
  DashboardTrend,
  DashboardTrendDay,
  DashboardTrendType,
} from '../../../api/generated/api-client';

/**
 * The pure model of the Trends tab: what can be drawn (measures), how each line looks (colour, dash, marker; never colour alone), which
 * lines the current choices make, and how the choices travel in the address (`types`, `metric`, `all`, `due`) and in the browser.
 */

/** What a line counts per day. `overdue` is a snapshot at the end of the day; the others are events of the day. */
export type Measure = 'created' | 'completed' | 'overdue' | 'onTime' | 'late';
export const MEASURES: readonly Measure[] = ['created', 'completed', 'overdue', 'onTime', 'late'];
export const MAX_TYPES = 8;
export const LIMIT_MESSAGE = 'Pick up to 8 task types to keep the chart readable';

export function isMeasure(value: unknown): value is Measure {
  return typeof value === 'string' && (MEASURES as readonly string[]).includes(value);
}

export interface MeasureInfo {
  /** Short name in the Show selector and the Due dates group. */
  label: string;
  /** Word after a number in a tooltip ("12 created"). */
  word: string;
  /** Wording of the chart heading. */
  heading: string;
  /** What the legend total of a task type means. */
  totalNote: string;
}

export const MEASURE_INFO: Record<Measure, MeasureInfo> = {
  created: {
    label: 'Created',
    word: 'created',
    heading: 'created',
    totalNote: 'Created in the period',
  },
  completed: {
    label: 'Completed',
    word: 'completed',
    heading: 'completed',
    totalNote: 'Completed in the period',
  },
  overdue: {
    label: 'Overdue',
    word: 'overdue',
    heading: 'overdue',
    totalNote: 'Overdue now',
  },
  onTime: {
    label: 'On time',
    word: 'completed on time',
    heading: 'on time',
    totalNote: 'Completed on time in the period',
  },
  late: {
    label: 'Completed late',
    word: 'completed late',
    heading: 'late',
    totalNote: 'Completed late in the period',
  },
};

/** The due-date measures that can be added to the default chart (the "Due dates" group). */
export const DUE_MEASURES = ['overdue', 'onTime', 'late'] as const;
export type DueMeasure = (typeof DUE_MEASURES)[number];
const DUE_URL: Record<DueMeasure, string> = { overdue: 'overdue', onTime: 'ontime', late: 'late' };

export type MarkerShape =
  | 'circle'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'triangleDown'
  | 'cross'
  | 'plus'
  | 'ring'
  | 'ringSquare';

export interface LineStyle {
  /** `#RRGGBB`, at least 3:1 against the card (trend-palette spec). */
  color: string;
  /** SVG stroke-dasharray; empty is a solid line. */
  dash: string;
  marker: MarkerShape;
}

/**
 * Line styles of the default chart (measures), in the dashboard's own tokens: Created is the brand blue, solid, round markers; Completed
 * teal, long dashes, square markers; Overdue red, dotted, up triangles; On time green, dash-dot, diamonds; Completed late amber, dash-dot-dot,
 * crosses. Keep in step with docs/ux/tokens.css (checked by trend-palette.spec.ts).
 */
export const MEASURE_STYLES: Record<Measure, LineStyle> = {
  created: { color: '#1F4E9C', dash: '', marker: 'circle' },
  completed: { color: '#0B5E55', dash: '7 4', marker: 'square' },
  overdue: { color: '#B42318', dash: '2 4', marker: 'triangle' },
  onTime: { color: '#146C2E', dash: '10 3 2 3', marker: 'diamond' },
  late: { color: '#8A4B00', dash: '9 3 2 3 2 3', marker: 'cross' },
};

/** "All task types" when task types are compared: the darkest ink, solid, round markers. */
export const ALL_STYLE: LineStyle = { color: '#1B1F27', dash: '', marker: 'circle' };

/**
 * One slot per task type line (a type keeps its slot while it stays checked). Colours follow Okabe-Ito / Tol hues darkened to at least 3:1
 * on white and on the weekend shade; each slot also has its own dash pattern and marker shape, so no line relies on colour alone.
 */
export const TYPE_STYLES: readonly LineStyle[] = [
  { color: '#0072B2', dash: '8 4', marker: 'square' },
  { color: '#C2410C', dash: '2 3', marker: 'triangle' },
  { color: '#00795A', dash: '10 3 2 3', marker: 'diamond' },
  { color: '#B0306F', dash: '4 4', marker: 'triangleDown' },
  { color: '#8A6A00', dash: '14 5', marker: 'cross' },
  { color: '#6B3FA0', dash: '1 5', marker: 'plus' },
  { color: '#2F8FBF', dash: '9 3 2 3 2 3', marker: 'ring' },
  { color: '#6B7280', dash: '3 2 6 2', marker: 'ringSquare' },
];

/** The SVG path of a marker centred at (x, y) with half-size r. */
export function markerPath(shape: MarkerShape, x: number, y: number, r: number): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  switch (shape) {
    case 'circle':
    case 'ring':
      return `M${f(x - r)},${f(y)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0z`;
    case 'square':
    case 'ringSquare':
      return `M${f(x - r)},${f(y - r)}h${2 * r}v${2 * r}h${-2 * r}z`;
    case 'triangle':
      return `M${f(x)},${f(y - r - 0.5)}L${f(x + r + 0.5)},${f(y + r)}L${f(x - r - 0.5)},${f(y + r)}z`;
    case 'triangleDown':
      return `M${f(x)},${f(y + r + 0.5)}L${f(x + r + 0.5)},${f(y - r)}L${f(x - r - 0.5)},${f(y - r)}z`;
    case 'diamond':
      return `M${f(x)},${f(y - r - 1)}L${f(x + r + 1)},${f(y)}L${f(x)},${f(y + r + 1)}L${f(x - r - 1)},${f(y)}z`;
    case 'cross':
      return `M${f(x - r)},${f(y - r)}L${f(x + r)},${f(y + r)}M${f(x + r)},${f(y - r)}L${f(x - r)},${f(y + r)}`;
    case 'plus':
      return `M${f(x - r - 0.5)},${f(y)}h${2 * r + 1}M${f(x)},${f(y - r - 0.5)}v${2 * r + 1}`;
  }
}

/** True for markers drawn as an outline or strokes only (filled with the card colour, or no fill). */
export function isHollow(shape: MarkerShape): boolean {
  return shape === 'ring' || shape === 'ringSquare' || shape === 'cross' || shape === 'plus';
}

// ---- the choices

export interface TrendChoice {
  /** Checked task types in the order they were checked. */
  types: readonly number[];
  /** The "All task types" line is shown. */
  showAll: boolean;
  /** The measure of the All line and the type lines while task types are selected. */
  metric: Measure;
  /** Extra All-level lines of the default chart (no task type checked). */
  due: readonly DueMeasure[];
}

export const DEFAULT_CHOICE: TrendChoice = { types: [], showAll: true, metric: 'created', due: [] };

export function sameChoice(a: TrendChoice, b: TrendChoice): boolean {
  return (
    a.showAll === b.showAll &&
    a.metric === b.metric &&
    a.types.join() === b.types.join() &&
    a.due.join() === b.due.join()
  );
}

/** Whole positive ids, no repeats, at most the limit. */
export function cleanTypeIds(values: readonly unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    if (out.length === MAX_TYPES) break;
  }
  return out;
}

function cleanDue(values: readonly unknown[]): DueMeasure[] {
  return DUE_MEASURES.filter((m) => values.includes(m));
}

export const TREND_PARAMS = ['types', 'metric', 'all', 'due'] as const;

export function hasTrendParams(params: ParamMap): boolean {
  return TREND_PARAMS.some((k) => params.has(k));
}

/** The choices an address names (missing or invalid parts fall back to the defaults). */
export function choiceFromParams(params: ParamMap): TrendChoice {
  const metric = params.get('metric');
  const dueNames = (params.get('due') ?? '').split(',');
  return {
    types: cleanTypeIds((params.get('types') ?? '').split(',').filter(Boolean)),
    showAll: params.get('all') !== '0',
    metric: isMeasure(metric) ? metric : DEFAULT_CHOICE.metric,
    due: DUE_MEASURES.filter((m) => dueNames.includes(DUE_URL[m])),
  };
}

/** The query parameters that carry the choices (null removes a parameter that is at its default). */
export function choiceToParams(choice: TrendChoice): Record<string, string | null> {
  return {
    types: choice.types.length > 0 ? choice.types.join(',') : null,
    metric: choice.metric !== DEFAULT_CHOICE.metric ? choice.metric : null,
    all: choice.showAll ? null : '0',
    due: choice.due.length > 0 ? choice.due.map((m) => DUE_URL[m]).join(',') : null,
  };
}

export function clearedTrendParams(): Record<string, null> {
  return Object.fromEntries(TREND_PARAMS.map((k) => [k, null]));
}

/** Choices read back from storage (anything unexpected falls back to the defaults). */
export function choiceFromStored(raw: unknown): TrendChoice {
  if (!raw || typeof raw !== 'object') return DEFAULT_CHOICE;
  const r = raw as Record<string, unknown>;
  return {
    types: Array.isArray(r['types']) ? cleanTypeIds(r['types']) : [],
    showAll: r['showAll'] !== false,
    metric: isMeasure(r['metric']) ? r['metric'] : DEFAULT_CHOICE.metric,
    due: Array.isArray(r['due']) ? cleanDue(r['due']) : [],
  };
}

// ---- the lines

export interface ChartLine {
  key: string;
  /** Name in the table header and the tooltip. */
  name: string;
  /** Shown before the value in the tooltip and read-out; null in the default chart ("2 created"). */
  tipName: string | null;
  /** Word after the value ("created"); empty when the heading says it. */
  valueWord: string;
  values: readonly number[];
  style: LineStyle;
  iconKey: string | null;
  measure: Measure;
  /** Task type of the line; null for the All line. */
  typeId: number | null;
  /** True for a line whose day link lists a superset of what is counted (explained under the chart). */
  approximate: boolean;
}

export interface TrendView {
  /** No task type is checked: the default chart (Created and Completed, plus the Due dates lines). */
  defaultMode: boolean;
  lines: ChartLine[];
  /** Measures drawn, in order (for the heading). */
  measures: Measure[];
}

function valuesOf(days: readonly DashboardTrendDay[], measure: Measure): number[] {
  return days.map((d) => d[measure]);
}

/**
 * The lines the choices make. Default chart (no task type checked): with "All task types" on, Created and Completed as today; the Due
 * dates ticked add Overdue / On time / Completed late. With task types checked: "All task types" (if on) and one line per checked type,
 * all showing the chosen metric; the Due dates lines are not drawn then.
 */
export function buildView(
  choice: TrendChoice,
  data: DashboardTrend | null,
  slots: ReadonlyMap<number, number>,
  types: readonly DashboardTrendType[],
): TrendView {
  if (!data) return { defaultMode: choice.types.length === 0, lines: [], measures: [] };
  const all = data.all;
  const line = (
    measure: Measure,
    key: string,
    name: string,
    style: LineStyle,
    days: readonly DashboardTrendDay[],
    typeId: number | null,
    tip: string | null,
    iconKey: string | null = null,
  ): ChartLine => ({
    key,
    name,
    tipName: tip,
    valueWord: tip === null ? MEASURE_INFO[measure].word : '',
    values: valuesOf(days, measure),
    style,
    iconKey,
    measure,
    typeId,
    approximate: measure === 'onTime' || measure === 'late' || measure === 'overdue',
  });

  if (choice.types.length === 0) {
    const lines: ChartLine[] = [];
    if (choice.showAll) {
      lines.push(
        line('created', 'all-created', 'Created', MEASURE_STYLES.created, all, null, null),
      );
      lines.push(
        line('completed', 'all-completed', 'Completed', MEASURE_STYLES.completed, all, null, null),
      );
    }
    for (const m of choice.due) {
      lines.push(line(m, `all-${m}`, MEASURE_INFO[m].label, MEASURE_STYLES[m], all, null, null));
    }
    return { defaultMode: true, lines, measures: lines.map((l) => l.measure) };
  }

  const lines: ChartLine[] = [];
  if (choice.showAll) {
    lines.push(
      line(choice.metric, 'all', 'All task types', ALL_STYLE, all, null, 'All task types'),
    );
  }
  for (const id of choice.types) {
    const series = data.byTaskType.find((s) => s.taskTypeId === id);
    const meta = types.find((t) => t.id === id);
    const slot = slots.get(id);
    if (!series || slot === undefined) continue;
    const name = meta?.name ?? `Task type ${id}`;
    lines.push(
      line(
        choice.metric,
        `type-${id}`,
        name,
        TYPE_STYLES[slot % TYPE_STYLES.length],
        series.points,
        id,
        name,
        meta?.iconKey ?? null,
      ),
    );
  }
  return { defaultMode: false, lines, measures: lines.length > 0 ? [choice.metric] : [] };
}

/** "Tasks created and completed per day" and friends. */
export function chartHeading(measures: readonly Measure[]): string {
  const unique = MEASURES.filter((m) => measures.includes(m));
  if (unique.length === 0) return 'Tasks per day';
  if (unique.length === 1) {
    switch (unique[0]) {
      case 'overdue':
        return 'Overdue tasks at the end of each day';
      case 'onTime':
        return 'Tasks completed on time per day';
      case 'late':
        return 'Tasks completed late per day';
      default:
        return `Tasks ${MEASURE_INFO[unique[0]].heading} per day`;
    }
  }
  const words = unique.map((m) => MEASURE_INFO[m].heading);
  return `Tasks ${words.slice(0, -1).join(', ')} and ${words[words.length - 1]} per day`;
}

// ---- the legend

export interface TypeRow {
  id: number;
  name: string;
  iconKey: string;
  isActive: boolean;
  total: number;
  /** Task Queue query behind the total. */
  query: string;
}

export function totalOf(type: DashboardTrendType, metric: Measure): number {
  return type[metric];
}

export function queryOf(type: DashboardTrendType, metric: Measure): string {
  return metric === 'overdue'
    ? type.overdueQuery
    : metric === 'created'
      ? type.createdQuery
      : type.completedQuery;
}

/** The legend rows: the metric's period total, largest first, then by name; types without tasks last (muted by the legend). */
export function typeRows(types: readonly DashboardTrendType[], metric: Measure): TypeRow[] {
  return types
    .map((t) => ({
      id: t.id,
      name: t.name,
      iconKey: t.iconKey,
      isActive: t.isActive,
      total: totalOf(t, metric),
      query: queryOf(t, metric),
    }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
        a.id - b.id,
    );
}

/** The lowest free slot (0 to 7). */
export function freeSlot(slots: ReadonlyMap<number, number>): number {
  const used = new Set(slots.values());
  for (let i = 0; i < MAX_TYPES; i++) if (!used.has(i)) return i;
  return 0;
}

// ---- Task Queue links

const OPEN_STATUSES = 'status=NEW&status=IN_PROGRESS&status=ON_HOLD';

/**
 * The Task Queue query behind one day's value. Created and completed are exact. Overdue is a past snapshot the queue cannot reproduce: today it
 * is the queue's own overdue filter; for an earlier day it lists the tasks that are still open now and were due by then (tasks closed since are
 * not listed). On time and late list every task completed that day (the queue cannot split by due date).
 */
export function dayQuery(
  measure: Measure,
  date: string,
  typeId: number | null,
  isToday: boolean,
): string {
  const type = typeId === null ? '' : `&type=${typeId}`;
  switch (measure) {
    case 'created':
      return `createdFrom=${date}&createdTo=${date}${type}`;
    case 'overdue':
      return isToday
        ? `${OPEN_STATUSES}&overdue=true${type}`
        : `${OPEN_STATUSES}&dueTo=${date}${type}`;
    default:
      return `status=COMPLETED&completedFrom=${date}&completedTo=${date}${type}`;
  }
}

/** What a day link lists when that is not exactly the counted tasks; null when it is exact. */
export function linkNote(measure: Measure): string | null {
  switch (measure) {
    case 'overdue':
      return 'Overdue links list the tasks that are still open and were due by that day (today: all overdue tasks).';
    case 'onTime':
    case 'late':
      return 'On time and late links list every task completed that day.';
    default:
      return null;
  }
}
