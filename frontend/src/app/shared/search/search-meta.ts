import { Permission } from '../../core/auth/permissions';

/** The searchable object types, as the API names them. */
export type SearchType = 'matter' | 'client' | 'task' | 'project' | 'asset';

export interface SearchTypeInfo {
  type: SearchType;
  /** Group heading ("Matters"). */
  label: string;
  /** One record ("Matter"). */
  singular: string;
  /** Searching the type needs this View permission (a caller may search only what they may view). */
  permission: Permission;
}

/** Types in the order the UX spec lists them (S11): Matters, Clients, Tasks, Projects, Assets. */
export const SEARCH_TYPES: readonly SearchTypeInfo[] = [
  { type: 'matter', label: 'Matters', singular: 'Matter', permission: 'Matter.View' },
  { type: 'client', label: 'Clients', singular: 'Client', permission: 'Client.View' },
  { type: 'task', label: 'Tasks', singular: 'Task', permission: 'Task.View' },
  { type: 'project', label: 'Projects', singular: 'Project', permission: 'Project.View' },
  { type: 'asset', label: 'Assets', singular: 'Asset', permission: 'Asset.View' },
];

/** "a", "a and b", "a, b and c" (no serial comma, like the rest of the app's lists). */
export function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/**
 * The words the header box names, in the order it has always used (clients, matters, tasks, assets): only the types the person may view.
 * Projects are searched as well but were never named in the box; they are named only when they are all the person can search.
 */
export function searchBoxWords(has: (code: Permission) => boolean): string[] {
  const named = (
    [
      ['client', 'clients'],
      ['matter', 'matters'],
      ['task', 'tasks'],
      ['asset', 'assets'],
    ] as const
  )
    .filter(([type]) => has(searchTypeInfo(type)!.permission))
    .map(([, word]) => word);
  if (named.length === 0 && has('Project.View')) return ['projects'];
  return named;
}

/** The accessible name of the header box: `Search clients, matters, tasks, assets` for everyone who may search all, shorter otherwise (#465). */
export function searchBoxName(has: (code: Permission) => boolean): string {
  const words = searchBoxWords(has);
  return words.length === 0 ? 'Search MatterFlow' : `Search ${words.join(', ')}`;
}

/** The placeholder: the name plus the shortcut hint, which stays exactly as it was. */
export function searchBoxPlaceholder(has: (code: Permission) => boolean): string {
  return `${searchBoxName(has)}... (Ctrl+K)`;
}

/**
 * The muted "Searched in: Clients and Matters" line (the panel footer and the results page). The panel leaves it out when all five types are
 * searched (it would be noise there); the results page always says it (`always`), so a person who may view fewer types sees what was searched.
 * It names only what was searched, never what was left out.
 */
export function searchedInLine(
  searched: readonly string[] | null | undefined,
  always = false,
): string | null {
  const labels = SEARCH_TYPES.filter((t) => searched?.includes(t.type)).map((t) => t.label);
  if (labels.length === 0 || (!always && labels.length === SEARCH_TYPES.length)) return null;
  return `Searched in: ${joinWords(labels)}`;
}

/** The copy deck of the search area's links: "See all" is the only verb for more results (never "Show more"). */
export const SEARCH_COPY = {
  /** The link of a group or section that holds more hits than are shown: `See all 24`. */
  seeAll: (count: string) => `See all ${count}`,
  /** The panel footer: `View all 140 results for "review"`. */
  viewAll: (count: string, total: number, capped: boolean, query: string) =>
    `View all ${count} ${total === 1 && !capped ? 'result' : 'results'} for "${query}"`,
  /** The panel after a settled query: `140 results in 5 groups`. */
  panelCount: (count: string, total: number, groups: number) =>
    `${count} ${total === 1 ? 'result' : 'results'} in ${groups} ${groups === 1 ? 'group' : 'groups'}`,
  /** A type tab or page change: `Tasks, 24 results, page 2 of 3`; with a filter: `Filters applied, 12 results`. */
  tabCount: (label: string, total: number, page: number, pages: number, filtered: boolean) =>
    (filtered
      ? `Filters applied, ${total.toLocaleString('en-US')} ${total === 1 ? 'result' : 'results'}`
      : `${label}, ${total.toLocaleString('en-US')} ${total === 1 ? 'result' : 'results'}`) +
    (pages > 1 ? `, page ${page} of ${pages}` : ''),
} as const;

/** A total as headings and the footer show it: `24`, `1,000+` when the API stopped counting at its cap. */
export function formatTotal(total: number, capped: boolean): string {
  return total.toLocaleString('en-US') + (capped ? '+' : '');
}

export function searchTypeInfo(type: string): SearchTypeInfo | undefined {
  return SEARCH_TYPES.find((t) => t.type === type);
}

/** The types the user may search, in display order. */
export function searchableTypes(has: (code: Permission) => boolean): SearchTypeInfo[] {
  return SEARCH_TYPES.filter((t) => has(t.permission));
}

/** Two characters are needed, except for a single digit (Client and Matter numbers can be one digit). */
export function isSearchable(query: string | null | undefined): boolean {
  const q = (query ?? '').trim();
  return q.length >= 2 || /^\d$/.test(q);
}

export interface TextPart {
  text: string;
  match: boolean;
}

/** Splits `text` around the first case-insensitive occurrence of `query`, so the match can be wrapped in `<mark>`. */
export function highlightParts(text: string | null | undefined, query: string): TextPart[] {
  const value = text ?? '';
  const q = query.trim();
  if (value === '' || q === '') return [{ text: value, match: false }];
  const at = value.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return [{ text: value, match: false }];
  return [
    { text: value.slice(0, at), match: false },
    { text: value.slice(at, at + q.length), match: true },
    { text: value.slice(at + q.length), match: false },
  ].filter((p) => p.text !== '');
}

/** The message for a search with no hits (UX S11). */
export function noResultsMessage(query: string): string {
  return `No results for '${query}'. Try a client or matter number, a task title, or an asset name.`;
}

export const SEARCH_ERROR_MESSAGE = 'Search is unavailable. Try again.';

/** What a suggestion option shows besides its (highlighted) name; the panel and any later hit list read the same rules. */
export interface SuggestionLines {
  /** The reference on the first line (monospace): matter, client, project and task numbers. An asset never has one (a URL can be 1,000 characters). */
  reference: string | null;
  /** Hover text of the option: for an asset its external reference, which stays out of the lines. */
  tooltip: string | null;
  /** The muted second line, in order, each part present only when there is a value. */
  context: string[];
  /** A lock with the name "Sensitive matter" before the second line; a matter carries the Sensitive badge on its first line instead. */
  lock: boolean;
}

interface HitFields {
  type: string;
  reference?: string | null;
  secondary?: string | null;
  matterRef?: string | null;
  matterName?: string | null;
  isSensitive: boolean;
  status?: string | null;
}

/**
 * The lines of a suggestion option (Search review BUG-2, BUG-6, S4):
 * - Matter: reference and name, the client on the second line.
 * - Client: reference and name only.
 * - Project: the name, then the matter number and name.
 * - Task: reference and title, then matter number, matter name and status (never the requestor).
 * - Asset: the name only, then type, matter number and matter name (never the URL reference).
 * Matter number and name are empty for a caller who may not view Matters (the API leaves them out).
 */
export function suggestionLines(
  hit: HitFields,
  statusLabel: (code: string) => string = (c) => c,
): SuggestionLines {
  const matter = [hit.matterRef, hit.matterName].filter((p): p is string => !!p);
  const context: string[] = [];
  let reference: string | null = hit.reference || null;
  let tooltip: string | null = null;
  switch (hit.type) {
    case 'matter':
    case 'client':
      if (hit.secondary) context.push(hit.secondary);
      break;
    case 'task':
      context.push(...matter);
      if (hit.status) context.push(statusLabel(hit.status));
      break;
    case 'project':
      context.push(...matter);
      break;
    case 'asset':
      tooltip = reference;
      reference = null;
      if (hit.secondary) context.push(hit.secondary);
      context.push(...matter);
      break;
  }
  return { reference, tooltip, context, lock: hit.isSensitive && hit.type !== 'matter' };
}
