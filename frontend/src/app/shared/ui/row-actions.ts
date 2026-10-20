import type { MenuAction } from './action-menu';

/**
 * One entry of a row's overflow menu, as data (#554, the admin list kit). Where it goes in the menu follows from its kind, not from the
 * order it is written in:
 *
 *   primary   what the row is for: Edit, Rename, Move up, Move down, Set as default, Open  (default)
 *   state     the state change: Deactivate or Activate (never both: the page offers the one that applies)
 *   danger    Delete and anything else destructive: always last, set apart, red on the item only (never a red text link in the row)
 *
 * `reason` makes the entry disabled and puts the reason on screen under its label ("Used by 31 open tasks. Deactivate it instead."), read
 * out with it: a `title` tooltip never reaches a keyboard user. `permission` is the permission (or any of several) the person needs; an
 * entry nobody in the person's position may use is not offered at all (a disabled entry is for a reason the person can fix or understand).
 */
export interface RowActionSpec {
  id: string;
  label: string;
  /** PrimeIcons class, for example `pi-pencil`. */
  icon?: string;
  /** Which group the entry belongs to; `danger: true` is the same as `kind: 'danger'`. */
  kind?: 'primary' | 'state' | 'danger';
  danger?: boolean;
  /** Why the entry cannot be used right now. It stays in the menu, disabled, with this text visible. */
  reason?: string;
  /** The person needs ANY of these permissions; omitted means everyone who can see the row. */
  permission?: string | readonly string[];
  run: () => void;
}

/** What `rowActions` needs to know about the person. */
export interface RowActionsContext {
  can: (permission: string) => boolean;
}

/** The inputs of `mf-action-menu` for one row. */
export interface RowActionsMenu {
  /** "Actions for <name>": the accessible name of the menu button and of the menu. */
  label: string;
  items: MenuAction[];
}

/** A name longer than this is cut in the accessible name (the row itself shows the whole name). */
const NAME_MAX = 80;

const GROUP = { primary: 0, state: 1, danger: 2 } as const;

/**
 * The overflow menu of one row of an admin list:
 *
 *   <mf-action-menu [floating]="true" [label]="menu.label" [items]="menu.items" />   // menu = rowActions(row.name, specs, { can })
 *
 * One Tab stop for the whole row; Arrow keys move, Esc closes and returns focus to the button (`mf-action-menu`). `floating` keeps the menu in
 * view at the last row. Entries are permission-filtered, ordered primary, state, danger (the order inside a group is the order given), and
 * the first danger entry gets the divider above it.
 */
export function rowActions(
  name: string,
  specs: readonly RowActionSpec[],
  ctx: RowActionsContext,
): RowActionsMenu {
  const shown = specs.filter((s) => {
    if (s.permission === undefined) return true;
    const needed = typeof s.permission === 'string' ? [s.permission] : s.permission;
    return needed.length === 0 || needed.some(ctx.can);
  });
  const kindOf = (s: RowActionSpec) => (s.danger ? 'danger' : (s.kind ?? 'primary'));
  const ordered = shown
    .map((s, at) => ({ s, at, g: GROUP[kindOf(s)] }))
    .sort((a, b) => a.g - b.g || a.at - b.at);
  const firstDanger = ordered.findIndex((o) => o.g === GROUP.danger);
  const items = ordered.map(({ s, g }, i): MenuAction => {
    const item: MenuAction = { id: s.id, label: s.label, run: s.run };
    if (s.icon) item.icon = s.icon;
    if (g === GROUP.danger) item.danger = true;
    if (i === firstDanger && i > 0) item.separated = true;
    if (s.reason) {
      item.disabled = true;
      item.reason = s.reason;
    }
    return item;
  });
  const shownName = name.length > NAME_MAX ? name.slice(0, NAME_MAX - 1).trimEnd() + '…' : name;
  return { label: `Actions for ${shownName}`, items };
}
