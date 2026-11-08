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

/** The path value to send: trimmed, undefined (cleared) when empty. */
export function pathToSend(value: string | null | undefined): string | undefined {
  const text = (value ?? '').trim();
  return text === '' ? undefined : text;
}

/**
 * The message the API gave a path field (400 `INVALID_PATH`) keyed by the field's code, so the screen words match the spec whatever the server wrote; null when
 * the error is not about this field.
 */
export function serverPathMessage(err: unknown, field: 'dmsPath' | 'dfsPath'): string | null {
  if (!(err instanceof ApiError)) return null;
  const entry = err.problem?.errors?.[field]?.[0];
  if (!entry) return null;
  return MESSAGE_OF_CODE[entry.code] ?? entry.message;
}
