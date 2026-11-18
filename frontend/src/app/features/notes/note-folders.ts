import type { NoteFolderResponse } from '../../api/generated/api-client';

/**
 * Pure rules of the folder tree of a matter's notes (epic #1405, issue #1408; design `docs/ux/notes-round-2/README.md` section 3, rule D-46c). Kept apart from the
 * components so they can be unit tested: the tree from the flat list, the natural order, paths, the Move targets with their reasons, the name checks, the words of
 * the server's folder error codes and the remembered open or folded choice of the tree. The server repeats every rule; these only keep a person from an error
 * after the click.
 */

/** Top-level folders are level 1; at most this many levels (owner decision, 2026-11-18). */
export const MAX_DEPTH = 5;
/** At most this many folders in one matter. */
export const MAX_FOLDERS = 200;
export const NAME_MAX = 100;
/** The widths (px) of the open tree column and of the folded rail (`--mf-notes-tree-w`, `--mf-notes-rail-w`), and the card width below which the open tree shows as the rail: tree + list minimum 260 + note minimum 420. */
export const TREE_W = 232;
export const RAIL_W = 44;
export const TREE_MIN_CARD = TREE_W + 260 + 420;

/** The browser storage key of the open or folded choice of the tree (a preference like `mf.notes.height.v1`; no matter data in it). */
export const TREE_KEY = 'mf.notes.tree';

/** What the list shows: every note, the notes with no folder, or the direct notes of one folder. */
export type FolderScope = 'all' | 'none' | number;

export interface FolderNode {
  id: number;
  parentId: number | null;
  name: string;
  /** Direct notes (not those of the subfolders). */
  noteCount: number;
  subfolderCount: number;
  rowVersion: string;
  /** 1 for a top-level folder. */
  depth: number;
  children: FolderNode[];
}

export interface FolderTree {
  roots: FolderNode[];
  byId: Map<number, FolderNode>;
}

/** Natural, case-insensitive order: "Volume 2" before "Volume 10". */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** The tree of the flat list the API sends (each folder holds its parent's id). A folder whose parent is missing is treated as a top-level one. */
export function buildTree(folders: readonly NoteFolderResponse[]): FolderTree {
  const byId = new Map<number, FolderNode>();
  for (const f of folders) {
    byId.set(f.noteFolderId, {
      id: f.noteFolderId,
      parentId: f.parentFolderId ?? null,
      name: f.name,
      noteCount: f.noteCount,
      subfolderCount: f.subfolderCount,
      rowVersion: f.rowVersion,
      depth: 1,
      children: [],
    });
  }
  const roots: FolderNode[] = [];
  for (const n of byId.values()) {
    const parent = n.parentId === null ? undefined : byId.get(n.parentId);
    if (parent) parent.children.push(n);
    else {
      n.parentId = null;
      roots.push(n);
    }
  }
  const order = (list: FolderNode[], depth: number): void => {
    list.sort((a, b) => naturalCompare(a.name, b.name) || a.id - b.id);
    for (const n of list) {
      n.depth = depth;
      order(n.children, depth + 1);
    }
  };
  order(roots, 1);
  return { roots, byId };
}

/** The folders from the top level down to `id` (empty for an unknown id). */
export function pathOf(byId: ReadonlyMap<number, FolderNode>, id: number | null): FolderNode[] {
  const out: FolderNode[] = [];
  const seen = new Set<number>();
  let at = id === null ? undefined : byId.get(id);
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    out.unshift(at);
    at = at.parentId === null ? undefined : byId.get(at.parentId);
  }
  return out;
}

/** "Custodians > Executive Team"; "No Folder" for a note at the top level. */
export function pathText(byId: ReadonlyMap<number, FolderNode>, id: number | null): string {
  const p = pathOf(byId, id);
  return p.length === 0 ? 'No Folder' : p.map((f) => f.name).join(' > ');
}

/** Levels of the folder and everything below it: a leaf is 1. */
export function subtreeHeight(node: FolderNode): number {
  return 1 + node.children.reduce((m, c) => Math.max(m, subtreeHeight(c)), 0);
}

/** True when `id` is `ancestor` or lies below it. */
export function isInside(
  byId: ReadonlyMap<number, FolderNode>,
  id: number,
  ancestor: number,
): boolean {
  return pathOf(byId, id).some((f) => f.id === ancestor);
}

/** The rows the tree shows, in order, for the folders that are open (`open` holds the ids; the path to the selected folder is added by the caller). */
export function visibleFolders(
  roots: readonly FolderNode[],
  open: ReadonlySet<number>,
): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (list: readonly FolderNode[]): void => {
    for (const n of list) {
      out.push(n);
      if (n.children.length > 0 && open.has(n.id)) walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/** What is being moved: a folder, or a note that sits in `folderId` (null = No Folder). */
export type Moving = { kind: 'folder'; id: number } | { kind: 'note'; folderId: number | null };

export interface TargetState {
  ok: boolean;
  /** The short word shown at the right of a greyed target: "This folder", "Inside it", "Too deep", "Name in use", "Already here". */
  reason: string;
  /** The sentence for the tooltip. */
  tip: string;
}

const OK: TargetState = { ok: true, reason: '', tip: '' };

/**
 * Can `target` (a folder id, or null for the top level) take what is moved? A folder cannot go into itself or its own subfolders, not where the 5 levels would break
 * (the height of the moved subtree counts), not where a sibling already has its name, and not where it already is. A note can go to any folder or to No Folder except
 * the one it is in.
 */
export function moveTarget(tree: FolderTree, moving: Moving, target: number | null): TargetState {
  if (moving.kind === 'note') {
    return moving.folderId === target
      ? { ok: false, reason: 'Already here', tip: 'The note is already in this folder.' }
      : OK;
  }
  const node = tree.byId.get(moving.id);
  if (!node) return { ok: false, reason: 'Unknown', tip: 'This folder is no longer there.' };
  if (target === moving.id)
    return { ok: false, reason: 'This folder', tip: 'A folder cannot move into itself.' };
  if (target !== null && isInside(tree.byId, target, moving.id))
    return {
      ok: false,
      reason: 'Inside it',
      tip: 'A folder cannot move into one of its own subfolders.',
    };
  if (node.parentId === target)
    return { ok: false, reason: 'Already here', tip: 'The folder is already here.' };
  const depth = target === null ? 0 : (tree.byId.get(target)?.depth ?? 0);
  if (depth + subtreeHeight(node) > MAX_DEPTH)
    return {
      ok: false,
      reason: 'Too deep',
      tip: `It would be more than ${MAX_DEPTH} levels deep.`,
    };
  const siblings = target === null ? tree.roots : (tree.byId.get(target)?.children ?? []);
  if (siblings.some((s) => s.id !== node.id && sameName(s.name, node.name)))
    return {
      ok: false,
      reason: 'Name in use',
      tip: `A folder named "${node.name}" already exists there.`,
    };
  return OK;
}

/** Can a new folder be created below `parentId` (null = top level)? */
export function canCreateIn(tree: FolderTree, parentId: number | null): TargetState {
  if (tree.byId.size >= MAX_FOLDERS)
    return {
      ok: false,
      reason: 'Limit reached',
      tip: `A matter can have up to ${MAX_FOLDERS} folders.`,
    };
  const depth = parentId === null ? 0 : (tree.byId.get(parentId)?.depth ?? 0);
  return depth + 1 > MAX_DEPTH
    ? { ok: false, reason: 'Too deep', tip: `Folders can be nested up to ${MAX_DEPTH} levels.` }
    : OK;
}

export function sameName(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: 'base' }) === 0;
}

/** The error under the name field ("" = fine). */
export function nameError(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) return 'Enter a folder name.';
  if (name.length > NAME_MAX) return `Use ${NAME_MAX} characters or fewer.`;
  if (/[/\\]/.test(name)) return 'A folder name cannot contain / or \\.';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'A folder name cannot contain control characters.';
  return '';
}

/** The sentence for a clash, from the tree: shown before the server is asked. */
export function clashMessage(name: string, parentName: string | null): string {
  return `A folder named "${name.trim()}" already exists in ${parentName ?? 'the top level'}.`;
}

/** The words of the server's folder error codes (409), for a toast or a dialog; `undefined` for a code that is not a folder one. */
export function folderErrorText(
  code: string | undefined,
  meta?: Record<string, unknown>,
): { title: string; detail?: string } | undefined {
  switch (code) {
    case 'FOLDER_NAME_TAKEN':
      return { title: 'That name is taken.', detail: 'A folder with this name is already there.' };
    case 'FOLDER_TOO_DEEP':
      return {
        title: 'That is too deep.',
        detail: `Folders can be nested up to ${MAX_DEPTH} levels.`,
      };
    case 'FOLDER_LIMIT':
      return {
        title: 'No more folders.',
        detail: `A matter can have up to ${MAX_FOLDERS} folders.`,
      };
    case 'FOLDER_CYCLE':
      return {
        title: 'A folder cannot move there.',
        detail: 'A folder cannot move into itself or its own subfolders.',
      };
    case 'FOLDER_NOT_EMPTY': {
      const notes = Number(meta?.['noteCount'] ?? 0);
      const subs = Number(meta?.['subfolderCount'] ?? 0);
      return {
        title: 'The folder is not empty.',
        detail: `It holds ${countText(notes, 'note')} and ${countText(subs, 'subfolder')}.`,
      };
    }
    case 'MATTER_INACTIVE':
      return {
        title: 'The matter is not active.',
        detail: 'Folders cannot change on an inactive matter.',
      };
    case 'CONCURRENCY_CONFLICT':
      return {
        title: 'This folder was changed by someone else.',
        detail: 'Reload Latest to see it.',
      };
    default:
      return undefined;
  }
}

export function countText(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The address parameter of a folder: a number, or `none` for No Folder; anything else is All Notes. */
export function parseFolderParam(value: string | null | undefined): FolderScope {
  if (value === 'none') return 'none';
  const n = Number(value);
  return value && Number.isInteger(n) && n > 0 ? n : 'all';
}

export function folderParam(scope: FolderScope): string | null {
  return scope === 'all' ? null : String(scope);
}

/** The folder filters of the notes list for a scope. */
export function scopeFilter(scope: FolderScope): { folderId?: number; noFolder?: boolean } {
  return scope === 'all' ? {} : scope === 'none' ? { noFolder: true } : { folderId: scope };
}

/** Open (default) or folded; storage that cannot be read means open. */
export function readTreeOpen(): boolean {
  try {
    return localStorage.getItem(TREE_KEY) !== 'folded';
  } catch {
    return true;
  }
}

export function writeTreeOpen(open: boolean): void {
  try {
    if (open) localStorage.removeItem(TREE_KEY);
    else localStorage.setItem(TREE_KEY, 'folded');
  } catch {
    // Remembering the choice is a convenience.
  }
}

/** What is dragged onto the tree: a note (from the list) or a folder (from the tree). */
export type DragItem =
  | { kind: 'note'; id: number; title: string; folderId: number | null }
  | { kind: 'folder'; id: number; title: string };

export function dragMoving(item: DragItem): Moving {
  return item.kind === 'note'
    ? { kind: 'note', folderId: item.folderId }
    : { kind: 'folder', id: item.id };
}
