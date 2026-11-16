import { ApiError } from '../../core/http/api-error';

/**
 * The DMS Path and DFS Path rule of the Matter form (epic #1298, UI spec section 3.3). The API enforces the same rule (400 `INVALID_PATH`, field codes below), so the
 * dialog and the server say the same sentence. Whitespace at both ends is trimmed first; an empty value is valid (the fields are optional).
 */
export const PATH_MAX_LENGTH = 1000;

export const PATH_DRIVE_LETTER_MESSAGE =
  'Drive-letter paths such as C:\\ are not accepted. Use a network path (\\\\server\\share\\...) or a web address (https://...).';
export const PATH_CREDENTIALS_MESSAGE = 'Remove the user name and password from the web address.';
export const PATH_FORMAT_MESSAGE =
  'Enter a network path (\\\\server\\share\\...) or a web address starting with http:// or https://.';
export const PATH_TOO_LONG_MESSAGE = `Use at most ${PATH_MAX_LENGTH} characters.`;

/** The message of each field code the API answers with (`PATH_DRIVE_LETTER`, `PATH_CREDENTIALS`, `PATH_FORMAT`, `PATH_TOO_LONG`). */
const MESSAGE_OF_CODE: Readonly<Record<string, string>> = {
  PATH_DRIVE_LETTER: PATH_DRIVE_LETTER_MESSAGE,
  PATH_CREDENTIALS: PATH_CREDENTIALS_MESSAGE,
  PATH_FORMAT: PATH_FORMAT_MESSAGE,
  PATH_TOO_LONG: PATH_TOO_LONG_MESSAGE,
};

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const SERVER_NAME = /^[A-Za-z0-9._-]+$/;
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/;
const WEB = /^https?:\/\//i;

/** True for a stored `http://` or `https://` address: the only value that is shown as a link. */
export function isWebAddress(value: string | null | undefined): boolean {
  return !!value && WEB.test(value) && !/\s/.test(value);
}

function isUnc(text: string): boolean {
  const parts = text.slice(2).split('\\');
  if (parts.length < 2) return false;
  if (!SERVER_NAME.test(parts[0])) return false;
  const names = parts.slice(1);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name.length === 0) {
      // A single trailing backslash after the share or a folder.
      if (i === names.length - 1 && i > 0) continue;
      return false;
    }
    if (ILLEGAL_NAME_CHARS.test(name) || name.trim().length === 0) return false;
  }
  return true;
}

/** The message under the field for a value, or null when it is acceptable (empty included). */
export function pathProblem(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (text === '') return null;
  // The drive-letter check comes first: it is the mistake people actually make.
  if (/^[A-Za-z]:/.test(text)) return PATH_DRIVE_LETTER_MESSAGE;
  if (text.length > PATH_MAX_LENGTH) return PATH_TOO_LONG_MESSAGE;
  if (CONTROL.test(text)) return PATH_FORMAT_MESSAGE;
  if (text.startsWith('\\\\')) return isUnc(text) ? null : PATH_FORMAT_MESSAGE;
  if (WEB.test(text)) {
    if (/\s/.test(text)) return PATH_FORMAT_MESSAGE;
    let host = '';
    try {
      host = new URL(text).hostname;
    } catch {
      return PATH_FORMAT_MESSAGE;
    }
    if (host === '') return PATH_FORMAT_MESSAGE;
    // A '@' before the first '/', '?' or '#' of the address is a user name and password, however the parser reads it.
    const rest = text.slice(text.indexOf('://') + 3);
    const end = rest.search(/[/?#]/);
    const authority = end >= 0 ? rest.slice(0, end) : rest;
    return authority.includes('@') ? PATH_CREDENTIALS_MESSAGE : null;
  }
  return PATH_FORMAT_MESSAGE;
}

/** The help line under a list of paths on the Matter form. */
export const PATHS_HELP =
  'A network path (\\\\server\\share\\...) or a web address (https://...). Optional. Up to 10.';

/** The most paths one matter may carry of one kind (the API answers `TOO_MANY_PATHS` over it). */
export const PATHS_MAX = 10;
export const PATH_DUPLICATE_MESSAGE = 'This path is already in the list.';
export const PATHS_TOO_MANY_MESSAGE = `Use at most ${PATHS_MAX} paths of one kind.`;

/** The message of the codes of a list entry. */
const LIST_MESSAGE_OF_CODE: Readonly<Record<string, string>> = {
  ...MESSAGE_OF_CODE,
  PATH_DUPLICATE: PATH_DUPLICATE_MESSAGE,
  TOO_MANY_PATHS: PATHS_TOO_MANY_MESSAGE,
};

/** One line of a path list on the form: the key stays while the line is on screen (so a removal does not move the typing into the next line). */
export interface PathRow {
  key: number;
  text: string;
}

let rowCounter = 0;

export function newPathRow(text = ''): PathRow {
  rowCounter += 1;
  return { key: rowCounter, text };
}

/** The lines for a stored list: one per path, or one empty line when there is none (the field is always there to type in). */
export function pathRowsOf(values: readonly string[] | null | undefined): PathRow[] {
  return values && values.length > 0 ? values.map((v) => newPathRow(v)) : [newPathRow()];
}

/** The paths typed so far, trimmed, without the empty lines. */
export function typedPaths(rows: readonly PathRow[]): string[] {
  return rows.map((r) => r.text.trim()).filter((t) => t !== '');
}

/**
 * The message under each line, in the order of the lines (null: fine). A line is wrong by the rule of one path, or because the same path (ignoring letter case) is typed
 * higher up in the list; an empty line is fine.
 */
export function pathRowProblems(rows: readonly PathRow[]): (string | null)[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    const text = r.text.trim();
    if (text === '') return null;
    const own = pathProblem(text);
    if (own) return own;
    const key = text.toLowerCase();
    if (seen.has(key)) return PATH_DUPLICATE_MESSAGE;
    seen.add(key);
    return null;
  });
}

/** The message for the whole list (more lines with text than the limit), or null. */
export function pathListProblem(rows: readonly PathRow[]): string | null {
  return typedPaths(rows).length > PATHS_MAX ? PATHS_TOO_MANY_MESSAGE : null;
}

/** What the request carries: the non-empty paths, trimmed, in order, and for each one the index of its line (to put a server message under the right line). */
export function pathsToSend(rows: readonly PathRow[]): { values: string[]; lineOf: number[] } {
  const values: string[] = [];
  const lineOf: number[] = [];
  rows.forEach((r, i) => {
    const text = r.text.trim();
    if (text !== '') {
      values.push(text);
      lineOf.push(i);
    }
  });
  return { values, lineOf };
}

/**
 * The messages the API gave a path list (400 `INVALID_PATH`, keys `dmsPaths[n]` with n the place in the request): one per line (by the line's index, through `lineOf`) and
 * one for the list itself. The words are chosen by the field codes, so they read as the UI spec words them.
 */
export function serverPathMessages(
  err: unknown,
  field: 'dmsPaths' | 'dfsPaths',
  lineOf: readonly number[],
): { lines: Record<number, string>; list: string | null } {
  const result: { lines: Record<number, string>; list: string | null } = { lines: {}, list: null };
  if (!(err instanceof ApiError)) return result;
  const errors = err.problem?.errors ?? {};
  for (const [key, entries] of Object.entries(errors)) {
    const entry = entries?.[0];
    if (!entry) continue;
    const message = LIST_MESSAGE_OF_CODE[entry.code] ?? entry.message;
    if (key === field) {
      result.list = message;
      continue;
    }
    const match = new RegExp(`^${field}\\[(\\d+)\\]$`).exec(key);
    if (match) {
      const line = lineOf[Number(match[1])];
      if (line !== undefined) result.lines[line] = message;
    }
  }
  return result;
}
