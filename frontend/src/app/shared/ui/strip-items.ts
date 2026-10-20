import type { WorkStripItem } from '../work-queue/work-strip';

/**
 * How an admin list's health strip behaves (#581):
 *
 *  - `chips`     counts that are toggles, as the Task Types strip (#367): a pressed chip filters the list; the pressed chip pressed again
 *                goes back to the first item (the default view). Several chips can describe overlapping records (Active 12, Not usable 2).
 *  - `segments`  one choice of the list's status, always exactly one pressed (Pending / Active / Inactive / All): the group a person
 *                switches between. The pressed segment pressed again stays pressed.
 */
export type StripMode = 'chips' | 'segments';

/** One item of the strip: what it is called, which records it counts and which address parameters it stands for. */
export interface StripDef<T> {
  key: string;
  label: string;
  /** Tooltip: what the number counts. */
  hint?: string;
  /** Red text and an icon while the count is above zero (never colour alone: the label stays). */
  alert?: boolean;
  /** The records this item counts, over the WHOLE loaded list (no filter applies); default: every record. */
  matches?: (item: T) => boolean;
  /**
   * The address parameters this item sets when it is picked, in the form the address holds them (`null` = the parameter is absent or has
   * its default value). Every parameter any item uses is cleared by the items that do not name it, so a pick replaces the earlier one.
   */
  params?: Readonly<Record<string, string | null>>;
  /** A plain count with no filter behind it (never a toggle). */
  inert?: boolean;
}

/** Reads one address parameter of the list in the form `StripDef.params` writes it (`null` when absent or at its default). */
export type StripReader = (param: string) => string | null;

/**
 * The items of `mf-work-strip` for an admin list, counted over the loaded list in the browser (the admin lists load whole). While the list is not
 * loaded (`null`) every count is `null`, which the strip draws as `--` with its width reserved; a zero stays in place, muted.
 *
 *   readonly defs: StripDef<AssetType>[] = [
 *     { key: 'active', label: 'Active', matches: (t) => t.isActive, params: { status: null } },
 *     { key: 'noFields', label: 'No published fields', matches: (t) => t.isActive && !t.fieldCount, params: { status: null, fields: 'none' } },
 *     { key: 'inactive', label: 'Inactive', matches: (t) => !t.isActive, params: { status: 'inactive' } },
 *   ];
 *   protected readonly strip = computed(() => stripItems(this.state() === 'ready' ? this.all() : null, this.defs));
 *
 *   <mf-work-strip label="Asset types summary" [items]="strip()" [interactive]="true" [active]="stripActive()" (pick)="pickStrip($event)" />
 */
export function stripItems<T>(
  list: readonly T[] | null | undefined,
  defs: readonly StripDef<T>[],
  options: { mode?: StripMode } = {},
): WorkStripItem[] {
  const segments = options.mode === 'segments';
  return defs.map((d) => {
    const item: WorkStripItem = {
      key: d.key,
      label: d.label,
      count: list ? list.filter(d.matches ?? (() => true)).length : null,
    };
    if (d.hint) item.hint = d.hint;
    // A segment is a status choice, never an alarm; an inert item is a count beside the segments.
    if (d.alert && !segments) item.alert = true;
    if (d.inert) item.inert = true;
    return item;
  });
}

/** Every parameter any item of the strip uses. */
function stripParams<T>(defs: readonly StripDef<T>[]): string[] {
  return [...new Set(defs.flatMap((d) => Object.keys(d.params ?? {})))];
}

/**
 * The key of the item the address stands for exactly (the one the list shows), or `null` when the filters are something else (a typed name
 * filter does not change the item; a status or form the strip has no item for does).
 */
export function stripActiveKey<T>(defs: readonly StripDef<T>[], read: StripReader): string | null {
  const names = stripParams(defs);
  const found = defs.find(
    (d) => !d.inert && names.every((p) => (d.params?.[p] ?? null) === (read(p) ?? null)),
  );
  return found?.key ?? null;
}

/** What a pick does. */
export interface StripPick {
  /** The item that is pressed after the pick. */
  key: string;
  /** Every parameter of the strip with its new address value (`null` removes it): hand it to the page's navigate together with `page: null`. */
  params: Record<string, string | null>;
}

/**
 * The address change for picking item `key` while `active` is pressed (see `StripMode`). Chips: the pressed chip again returns to
 * `home` (the first item unless given); segments: the pressed segment stays. Unknown or inert keys change nothing (`null`).
 */
export function stripPick<T>(
  defs: readonly StripDef<T>[],
  key: string,
  active: string | null,
  options: { mode?: StripMode; home?: string } = {},
): StripPick | null {
  const picked = defs.find((d) => d.key === key);
  if (!picked || picked.inert) return null;
  const home = options.home ?? defs.find((d) => !d.inert)?.key;
  const target = options.mode !== 'segments' && key === active && home ? home : key;
  const def = defs.find((d) => d.key === target)!;
  return {
    key: target,
    params: Object.fromEntries(stripParams(defs).map((p) => [p, def.params?.[p] ?? null])),
  };
}
