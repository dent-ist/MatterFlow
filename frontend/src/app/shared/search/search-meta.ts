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
