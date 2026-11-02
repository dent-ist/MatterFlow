/** Pure helpers of the Notes tab (placeholders, lock rules, history wording, the splitter), kept apart so they can be unit tested. */

/** The placeholders a template can use; they are filled in when the template is used. Any other `{{name}}` is left for the person. */
export const KNOWN_PLACEHOLDERS = ['date', 'time', 'matter', 'author'] as const;

export interface PlaceholderValues {
  date: string;
  time: string;
  matter: string;
  author: string;
}

/** Fills `{{date}}`, `{{time}}`, `{{matter}}` and `{{author}}` (case-insensitive, spaces allowed inside); every other `{{name}}` stays. */
export function resolvePlaceholders(text: string, values: PlaceholderValues): string {
  return text.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_ -]*?)\s*\}\}/g, (whole, name: string) => {
    const key = name.toLowerCase() as keyof PlaceholderValues;
    return (KNOWN_PLACEHOLDERS as readonly string[]).includes(key)
      ? escapeHtml(values[key])
      : whole;
  });
}

/** The `{{names}}` still in the text, once each, in order (the ones the person has to fill in). */
export function openPlaceholders(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_ -]*?)\s*\}\}/g)) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** MM/DD/YYYY and hh:mm AM/PM for the placeholders (the app's date format). */
export function placeholderValues(now: Date, matter: string, author: string): PlaceholderValues {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hours = now.getHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return {
    date: `${mm}/${dd}/${now.getFullYear()}`,
    time: `${String(h12).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`,
    matter,
    author,
  };
}

export interface LockFacts {
  isLocked: boolean;
  lockedByUserId?: number | null;
  lockedByName?: string | null;
}

export interface LockUi {
  /** Edit and Delete are off for everybody while a note is locked. */
  canEdit: boolean;
  /** The Unlock button is on for the person who locked the note and for an administrator. */
  canUnlock: boolean;
  /** Why a button is off (shown as its reason), or an empty string. */
  editReason: string;
  unlockReason: string;
}

/** What the lock lets a person do (the server enforces the same rules: a locked note is read only for everybody, only the locker or an administrator unlocks). */
export function lockUi(
  note: LockFacts,
  me: number | null,
  isAdmin: boolean,
  mayEdit: boolean,
): LockUi {
  if (!mayEdit) {
    return {
      canEdit: false,
      canUnlock: false,
      editReason: 'You can read notes but not change them.',
      unlockReason: 'You can read notes but not change them.',
    };
  }
  if (!note.isLocked) return { canEdit: true, canUnlock: false, editReason: '', unlockReason: '' };
  const who = note.lockedByName ?? 'the person who locked it';
  const canUnlock = isAdmin || (me !== null && note.lockedByUserId === me);
  return {
    canEdit: false,
    canUnlock,
    editReason: `This note is locked by ${who}. Unlock it to edit.`,
    unlockReason: canUnlock ? '' : `Only ${who} or an administrator can unlock this note.`,
  };
}

/** One history line of a note in words. */
export function noteHistoryText(e: {
  eventType: string;
  oldValue?: string | null;
  newValue?: string | null;
  summary?: string | null;
}): string {
  switch (e.eventType) {
    case 'NOTE_CREATED':
      return 'created this note';
    case 'NOTE_EDITED':
      return 'edited this note';
    case 'NOTE_TAGS_CHANGED':
      return `changed the tags${e.newValue ? ` to ${e.newValue}` : ': none'}`;
    case 'NOTE_LOCKED':
      return 'locked this note';
    case 'NOTE_UNLOCKED':
      return 'unlocked this note';
    case 'NOTE_PINNED':
      return 'pinned this note';
    case 'NOTE_UNPINNED':
      return 'unpinned this note';
    case 'NOTE_SAVED_AFTER_AI_WARNING':
      return `saved after an AI warning${e.summary ? `: ${e.summary}` : ''}`;
    default:
      return e.eventType.toLowerCase().replaceAll('_', ' ');
  }
}

/** The day heading a history entry sits under ("Today", "Yesterday" or the date). */
export function dayHeading(iso: string, now: Date): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

/** The splitter between the list and the note (mockup: 380 px by default, 260 px at least; the note keeps 420 px at least). Keys move it by 16 px. */
export const SPLIT_MIN = 260;
export const SPLIT_MAX = 640;
export const SPLIT_DEFAULT = 380;
export const SPLIT_STEP = 16;
export const NOTE_MIN_WIDTH = 420;

/** `max` is what the card leaves for the list while the note keeps its 420 px (SPLIT_MAX when the card width is not known). */
export function clampSplit(width: number, max: number = SPLIT_MAX): number {
  if (!Number.isFinite(width)) return SPLIT_DEFAULT;
  return Math.min(Math.max(SPLIT_MIN, max), Math.max(SPLIT_MIN, Math.round(width)));
}

/** The list width the card allows: its width minus the note's minimum, never above SPLIT_MAX. */
export function splitLimit(cardWidth: number): number {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN + SPLIT_STEP, cardWidth - NOTE_MIN_WIDTH));
}

/** The text of the first line of an html body, for the unsaved title shown while typing (the server derives the real one). */
export function titleOfHtml(html: string): string {
  const withBreaks = html.replace(/<\/(p|h[1-6]|li|blockquote|tr)>|<br\s*\/?>/gi, '\n');
  const text = withBreaks.replace(/<[^>]*>/g, '');
  const doc = typeof document === 'undefined' ? null : document.createElement('textarea');
  for (const line of text.split('\n')) {
    let t = line;
    if (doc) {
      doc.innerHTML = t;
      t = doc.value;
    }
    t = t.replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 300);
  }
  return '';
}

/**
 * The title of a note is the first line of its text. In read mode the page shows that line as the heading (with the byline and the tags under it), so the text
 * under it starts after it. Returns the html without the first block when that block is a paragraph or a heading whose text is the title, otherwise the html
 * unchanged (a note that starts with a list or a table keeps all its text; the heading is then drawn above it as well).
 */
export function withoutTitleBlock(html: string, title: string): { rest: string; split: boolean } {
  if (typeof document === 'undefined' || !html) return { rest: html, split: false };
  const box = document.createElement('div');
  box.innerHTML = html;
  const first = box.firstElementChild;
  if (!first || !/^(P|H1|H2|H3)$/.test(first.tagName)) return { rest: html, split: false };
  const text = (first.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!text || text.slice(0, 300) !== title.replace(/\s+/g, ' ').trim().slice(0, 300))
    return { rest: html, split: false };
  first.remove();
  return { rest: box.innerHTML, split: true };
}

/** The colour keys a person's avatar can take (the task type palette), chosen from the name so a person keeps the same colour. */
const AVATAR_KEYS = [
  'blue',
  'violet',
  'teal',
  'rose',
  'amber',
  'green',
  'orange',
  'indigo',
] as const;

export function avatarKey(name: string | null | undefined): string {
  let h = 0;
  for (const c of name ?? '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_KEYS[h % AVATAR_KEYS.length];
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').split(/[\s\\]+/).filter(Boolean);
  return (
    parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2)
  ).toUpperCase();
}

export type NoteSort = 'updated' | 'oldest' | 'title' | 'created';

export interface SortableNote {
  isPinned: boolean;
  title: string;
  updatedAtUtc: string;
}

/** Pinned notes first, then the chosen order (newest update, oldest update, A to Z; "created" is the list as the server sends it for that sort). */
export function sortNotes<T extends SortableNote>(notes: readonly T[], sort: NoteSort): T[] {
  const order = (a: T, b: T): number =>
    sort === 'created'
      ? 0
      : sort === 'title'
        ? a.title.localeCompare(b.title)
        : sort === 'oldest'
          ? a.updatedAtUtc.localeCompare(b.updatedAtUtc)
          : b.updatedAtUtc.localeCompare(a.updatedAtUtc);
  return [...notes].sort((a, b) => (a.isPinned === b.isPinned ? order(a, b) : a.isPinned ? -1 : 1));
}

export interface NoteTagLike {
  noteTagId: number;
  name: string;
  isActive: boolean;
}

export interface NoteGroup<N, T> {
  /** The tag id as text, or `_none` for the notes without a tag. */
  id: string;
  tag: T | null;
  notes: N[];
}

/** One group per tag that has notes (alphabetical by tag name), then "Untagged". A note with several tags is in each of its groups. */
export function groupByTag<
  N extends { tags: readonly { noteTagId: number }[] },
  T extends NoteTagLike,
>(notes: readonly N[], tags: readonly T[], only: readonly string[] = []): NoteGroup<N, T>[] {
  const out: NoteGroup<N, T>[] = [];
  const byName = [...tags].sort((a, b) => a.name.localeCompare(b.name));
  for (const t of byName) {
    if (only.length && !only.includes(String(t.noteTagId))) continue;
    const list = notes.filter((n) => n.tags.some((x) => x.noteTagId === t.noteTagId));
    if (list.length) out.push({ id: String(t.noteTagId), tag: t, notes: list });
  }
  if (!only.length || only.includes('_none')) {
    const list = notes.filter((n) => n.tags.length === 0);
    if (list.length) out.push({ id: '_none', tag: null, notes: list });
  }
  return out;
}
