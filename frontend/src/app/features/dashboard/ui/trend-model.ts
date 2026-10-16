import { ParamMap } from '@angular/router';
import {
  DashboardTrend,
  DashboardTrendDay,
  DashboardTrendType,
} from '../../../api/generated/api-client';

/**
 * The pure model of the Trends tab: what can be drawn (measures), how each line looks (colour, dash, marker; never colour alone), the two
 * panels (flows and backlog) the current choices make, the state machine of the measure controls and the "Compare task types" list, the
 * y axis scale, and how the choices travel in the address (`types`, `metric`, `bmetric`, `all`; legacy `due`) and in the browser.
 *
 * Extension points for the backlog series (WP8b, #120): add `'open'` to `BacklogMeasure` and `BACKLOG_MEASURES`, give it a `MEASURE_INFO` and
 * `MEASURE_STYLES` entry, a `DashboardTrendDay.open` column in `valuesOf`, and (if wanted) a `'both'` choice that draws Open and Overdue.
 * Everything else (panel title, segmented control, legend, table groups, tooltip groups) reads `BACKLOG_MEASURES` and `PanelView`.
 */

/** What a line counts per day. `overdue` is a snapshot at the end of the day; the others are events of the day. */
export type Measure = 'created' | 'completed' | 'overdue' | 'onTime' | 'late';
export const MEASURES: readonly Measure[] = ['created', 'completed', 'overdue', 'onTime', 'late'];
export const MAX_TYPES = 8;
/** Panel heights in px (T1 contract): the flows panel 320, the backlog panel 200. */
export const FLOWS_HEIGHT = 320;
export const BACKLOG_HEIGHT = 200;
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

/** Panel 1 (flows, events of a day) and Panel 2 (backlog, a level at the end of the day). */
export type FlowMeasure = 'created' | 'completed' | 'onTime' | 'late';
export const FLOW_MEASURES: readonly FlowMeasure[] = ['created', 'completed', 'onTime', 'late'];
/** What panel 1 shows: two lines of All task types (`both`) or one measure (for All and for each compared task type). */
export type FlowChoice = 'both' | FlowMeasure;
/** Stocks. WP8b adds `'open'` here (see the note above). */
export type BacklogMeasure = 'overdue';
export const BACKLOG_MEASURES: readonly BacklogMeasure[] = ['overdue'];
export type BacklogChoice = BacklogMeasure;
export const DEFAULT_BACKLOG: BacklogChoice = 'overdue';

/** Words of the address for the measures (`metric=ontime`); the legacy spelling `onTime` is read too. */
const FLOW_URL: Record<FlowMeasure, string> = {
  created: 'created',
  completed: 'completed',
  onTime: 'ontime',
  late: 'late',
};

export const FLOW_CHOICE_LABEL: Record<FlowChoice, string> = {
  both: 'Created and completed',
  created: 'Created',
  completed: 'Completed',
  onTime: 'On time',
  late: 'Completed late',
};
export const BACKLOG_CHOICE_LABEL: Record<BacklogChoice, string> = { overdue: 'Overdue' };

export const FLOWS_TITLE = 'Created and completed';
export const BACKLOG_TITLE = 'Backlog at end of day';

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

/** "All task types" line: `auto` hides it while task types are compared (a different magnitude), `on` / `off` is the user's own choice. */
export type AllMode = 'auto' | 'on' | 'off';

export interface TrendChoice {
  /** Checked task types in the order they were checked. */
  types: readonly number[];
  all: AllMode;
  /** Panel 1. With task types checked it is always a single measure (never `both`). */
  metric: FlowChoice;
  /** Panel 2. */
  bmetric: BacklogChoice;
}

export const DEFAULT_CHOICE: TrendChoice = {
  types: [],
  all: 'auto',
  metric: 'both',
  bmetric: DEFAULT_BACKLOG,
};

/** Whether the "All task types" line is drawn. */
export function allVisible(choice: TrendChoice): boolean {
  return choice.all === 'auto' ? choice.types.length === 0 : choice.all === 'on';
}

export function sameChoice(a: TrendChoice, b: TrendChoice): boolean {
  return (
    a.all === b.all &&
    a.metric === b.metric &&
    a.bmetric === b.bmetric &&
    a.types.join() === b.types.join()
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

/** The first single measure a two-line measure turns into when a task type is picked. */
export const FIRST_SINGLE: FlowMeasure = 'created';

export interface ChoiceChange {
  choice: TrendChoice;
  /** Said politely (live region) when the control the user did not touch changed; null otherwise. */
  announcement: string | null;
}

/**
 * The one place that keeps the choices consistent: task types need a single measure in panel 1 (`both` becomes the first single measure,
 * announced), and when the last type is removed the "All task types" choice goes back to automatic and Created back to the two-line view.
 */
export function normalizeChoice(choice: TrendChoice, previous: TrendChoice | null): ChoiceChange {
  let next = choice;
  let announcement: string | null = null;
  if (next.types.length > 0 && next.metric === 'both') {
    next = { ...next, metric: FIRST_SINGLE };
    announcement = `Showing ${FLOW_CHOICE_LABEL[FIRST_SINGLE]} to compare task types.`;
  }
  if (next.types.length === 0 && previous && previous.types.length > 0) {
    // The last type is gone: undo what picking types did (All is automatic again, Created goes back to the two-line view).
    next = {
      ...next,
      all: 'auto',
      metric: next.metric === FIRST_SINGLE ? 'both' : next.metric,
    };
  }
  return { choice: next, announcement };
}

/** Ticks or unticks the All line; a choice equal to what automatic would do is stored as automatic. */
export function toggleAllMode(choice: TrendChoice): TrendChoice {
  const nowVisible = !allVisible(choice);
  const auto = choice.types.length === 0;
  return { ...choice, all: nowVisible === auto ? 'auto' : nowVisible ? 'on' : 'off' };
}

/** Measures offered by the panel 1 control: "Created and completed" is a two-line view of All task types only. */
export function flowOptions(choice: TrendChoice): FlowChoice[] {
  return choice.types.length > 0 ? [...FLOW_MEASURES] : ['both', ...FLOW_MEASURES];
}

export function backlogOptions(): BacklogChoice[] {
  return [...BACKLOG_MEASURES];
}

export function isFlowChoice(value: unknown): value is FlowChoice {
  return value === 'both' || (FLOW_MEASURES as readonly unknown[]).includes(value);
}

export const TREND_PARAMS = ['types', 'metric', 'bmetric', 'all', 'due'] as const;

export function hasTrendParams(params: ParamMap): boolean {
  return TREND_PARAMS.some((k) => params.has(k));
}

function flowFromWord(word: string | null): FlowMeasure | null {
  if (word === null) return null;
  const w = word.toLowerCase();
  return FLOW_MEASURES.find((m) => FLOW_URL[m] === w) ?? null;
}

/**
 * True when an address (a legacy one: `due=overdue`, `metric=overdue`, or `bmetric=`) asks for the backlog panel; the tab then shows the
 * panel even if the user hid it.
 */
export function namesBacklog(params: ParamMap): boolean {
  const due = (params.get('due') ?? '').split(',');
  return params.has('bmetric') || params.get('metric') === 'overdue' || due.includes('overdue');
}

/**
 * The choices an address names (missing or invalid parts fall back to the defaults). Legacy parameters keep working: `metric=overdue` is the
 * backlog panel (Overdue), `due=ontime` / `due=late` are the flow measures On time / Completed late (the first one named wins), `due=overdue`
 * is the backlog panel, and `all=1` keeps All task types when types are compared.
 */
export function choiceFromParams(params: ParamMap): TrendChoice {
  const dueNames = (params.get('due') ?? '').split(',');
  const legacyDue = flowFromWord(dueNames.find((n) => flowFromWord(n) && n !== 'created') ?? null);
  const metric = flowFromWord(params.get('metric')) ?? legacyDue ?? DEFAULT_CHOICE.metric;
  const all = params.get('all');
  return normalizeChoice(
    {
      types: cleanTypeIds((params.get('types') ?? '').split(',').filter(Boolean)),
      all: all === '0' ? 'off' : all === '1' ? 'on' : 'auto',
      metric,
      bmetric: DEFAULT_BACKLOG,
    },
    null,
  ).choice;
}

/** The query parameters that carry the choices (null removes a parameter that is at its default, and the legacy `due`). */
export function choiceToParams(choice: TrendChoice): Record<string, string | null> {
  return {
    types: choice.types.length > 0 ? choice.types.join(',') : null,
    metric: choice.metric !== DEFAULT_CHOICE.metric ? FLOW_URL[choice.metric as FlowMeasure] : null,
    bmetric: choice.bmetric !== DEFAULT_CHOICE.bmetric ? choice.bmetric : null,
    all: choice.all === 'off' ? '0' : choice.all === 'on' ? '1' : null,
    due: null,
  };
}

export function clearedTrendParams(): Record<string, null> {
  return Object.fromEntries(TREND_PARAMS.map((k) => [k, null]));
}

/** Choices read back from storage (anything unexpected falls back to the defaults; the first version of the storage is understood too). */
export function choiceFromStored(raw: unknown): TrendChoice {
  if (!raw || typeof raw !== 'object') return DEFAULT_CHOICE;
  const r = raw as Record<string, unknown>;
  const types = Array.isArray(r['types']) ? cleanTypeIds(r['types']) : [];
  const legacy = !('all' in r);
  const all: AllMode =
    r['all'] === 'on' || r['all'] === 'off'
      ? r['all']
      : legacy && r['showAll'] === false
        ? 'off'
        : 'auto';
  const storedMetric = typeof r['metric'] === 'string' ? flowFromWord(r['metric']) : null;
  // The first version's default metric was `created` next to "both lines": without types that meant the two-line chart.
  const metric: FlowChoice =
    r['metric'] === 'both' || (legacy && types.length === 0) ? 'both' : (storedMetric ?? 'both');
  return normalizeChoice({ types, all, metric, bmetric: DEFAULT_BACKLOG }, null).choice;
}

// ---- the lines

export type PanelKey = 'flows' | 'backlog';

export interface ChartLine {
  key: string;
  panel: PanelKey;
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

export interface PanelView {
  key: PanelKey;
  title: string;
  lines: ChartLine[];
  /** Height of the panel's drawing in px. */
  height: number;
  /** Said in the tooltip under the day when the lines of the panel show the same measure ("Created"); null for the two-line chart. */
  measureNote: string | null;
}

export interface TrendView {
  /** No task type is checked: the default chart. */
  defaultMode: boolean;
  flows: PanelView;
  backlog: PanelView;
}

function valuesOf(days: readonly DashboardTrendDay[], measure: Measure): number[] {
  return days.map((d) => d[measure]);
}

/**
 * The lines the choices make. Panel 1 (flows): without task types the chosen measure of All task types (`both`: Created and Completed);
 * with task types "All task types" (unless hidden, see `allVisible`) and one line per checked type, all showing the chosen measure.
 * Panel 2 (backlog): the same rule for its measure. A line keeps its colour, dash and marker in both panels.
 */
export function buildView(
  choice: TrendChoice,
  data: DashboardTrend | null,
  slots: ReadonlyMap<number, number>,
  types: readonly DashboardTrendType[],
): TrendView {
  const defaultMode = choice.types.length === 0;
  const flowTitle = flowsHeading(choice.metric);
  const empty = (key: PanelKey, title: string, height: number): PanelView => ({
    key,
    title,
    lines: [],
    height,
    measureNote: null,
  });
  if (!data) {
    return {
      defaultMode,
      flows: empty('flows', flowTitle, FLOWS_HEIGHT),
      backlog: empty('backlog', BACKLOG_TITLE, BACKLOG_HEIGHT),
    };
  }
  const all = data.all;
  const line = (
    panel: PanelKey,
    measure: Measure,
    key: string,
    name: string,
    style: LineStyle,
    days: readonly DashboardTrendDay[],
    typeId: number | null,
    tip: string | null,
    iconKey: string | null = null,
  ): ChartLine => ({
    key: `${panel}-${key}`,
    panel,
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

  /** One measure for All task types and for each checked type. */
  const single = (panel: PanelKey, measure: Measure): ChartLine[] => {
    const lines: ChartLine[] = [];
    if (defaultMode) {
      if (allVisible(choice)) {
        lines.push(
          line(
            panel,
            measure,
            `all-${measure}`,
            MEASURE_INFO[measure].label,
            MEASURE_STYLES[measure],
            all,
            null,
            null,
          ),
        );
      }
      return lines;
    }
    if (allVisible(choice)) {
      lines.push(
        line(panel, measure, 'all', 'All task types', ALL_STYLE, all, null, 'All task types'),
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
          panel,
          measure,
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
    return lines;
  };

  let flowLines: ChartLine[];
  if (choice.metric === 'both') {
    flowLines = allVisible(choice)
      ? [
          line(
            'flows',
            'created',
            'all-created',
            'Created',
            MEASURE_STYLES.created,
            all,
            null,
            null,
          ),
          line(
            'flows',
            'completed',
            'all-completed',
            'Completed',
            MEASURE_STYLES.completed,
            all,
            null,
            null,
          ),
        ]
      : [];
  } else {
    flowLines = single('flows', choice.metric);
  }
  const backlogLines = single('backlog', choice.bmetric);
  return {
    defaultMode,
    flows: {
      key: 'flows',
      title: flowTitle,
      lines: flowLines,
      height: FLOWS_HEIGHT,
      measureNote:
        !defaultMode && choice.metric !== 'both' ? FLOW_CHOICE_LABEL[choice.metric] : null,
    },
    backlog: {
      key: 'backlog',
      title: BACKLOG_TITLE,
      lines: backlogLines,
      height: BACKLOG_HEIGHT,
      measureNote: !defaultMode ? BACKLOG_CHOICE_LABEL[choice.bmetric] : null,
    },
  };
}

/** "Tasks created and completed per day" and friends (panel 1). */
export function flowsHeading(metric: FlowChoice): string {
  switch (metric) {
    case 'both':
      return 'Tasks created and completed per day';
    case 'onTime':
      return 'Tasks completed on time per day';
    case 'late':
      return 'Tasks completed late per day';
    default:
      return `Tasks ${MEASURE_INFO[metric].heading} per day`;
  }
}

// ---- the axis

export interface Scale {
  max: number;
  ticks: number[];
}

const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
/** Round tick steps (times a power of ten) that read well on an axis. */
const TICK_STEPS = [1, 2, 2.5, 5];
export const MIN_AXIS_MAX = 4;

/**
 * The top of a count axis: the smallest of 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 times a power of ten that holds the peak plus 5 percent
 * headroom for the label; never below 4 (a flat zero line stays readable).
 */
export function niceMax(peak: number): number {
  const target = Math.max(0, peak) * 1.05;
  if (target <= MIN_AXIS_MAX) return MIN_AXIS_MAX;
  const power = 10 ** Math.floor(Math.log10(target));
  for (const step of NICE_STEPS) {
    if (target <= step * power + 1e-9) return step * power;
  }
  return 10 * power;
}

/** The axis of a panel: its top and integer ticks from 0 (about four intervals, on round steps that divide the top). */
export function niceScale(peak: number): Scale {
  const max = niceMax(peak);
  let best = 1;
  let bestScore = Infinity;
  const exp = Math.floor(Math.log10(max));
  for (let p = Math.max(0, exp - 2); p <= exp; p++) {
    for (const base of TICK_STEPS) {
      const step = base * 10 ** p;
      if (!Number.isInteger(step)) continue;
      const count = max / step;
      if (!Number.isInteger(count) || count < 2 || count > 6) continue;
      const score = Math.abs(count - 4) + (count > 4 ? 0.1 : 0);
      if (score < bestScore) {
        best = step;
        bestScore = score;
      }
    }
  }
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += best) ticks.push(v);
  return { max, ticks };
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

/** The measure behind the numbers of the compare list: the single measure of panel 1 (Created while two lines are shown). */
export function totalMeasure(choice: TrendChoice): FlowMeasure {
  return choice.metric === 'both' ? FIRST_SINGLE : choice.metric;
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
