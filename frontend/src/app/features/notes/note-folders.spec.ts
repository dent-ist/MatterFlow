import type { NoteFolderResponse } from '../../api/generated/api-client';
import {
  MAX_DEPTH,
  MAX_FOLDERS,
  TREE_KEY,
  buildTree,
  canCreateIn,
  clashMessage,
  folderErrorText,
  folderParam,
  isInside,
  moveTarget,
  nameError,
  naturalCompare,
  parseFolderParam,
  pathOf,
  pathText,
  readTreeOpen,
  scopeFilter,
  subtreeHeight,
  visibleFolders,
  writeTreeOpen,
} from './note-folders';

let seq = 0;
const f = (id: number, parent: number | null, name: string, noteCount = 0): NoteFolderResponse => ({
  noteFolderId: id,
  matterId: 1,
  parentFolderId: parent ?? undefined,
  name,
  noteCount,
  subfolderCount: 0,
  rowVersion: `rv${id}-${seq++}`,
});

/** Custodians(4) > Executive Team(5), Finance(6), IT and Records(7); Productions(13) > Volume 2(15), Volume 10(14). */
const FOLDERS = [
  f(4, null, 'Custodians', 2),
  f(7, 4, 'IT and Records'),
  f(5, 4, 'Executive Team', 3),
  f(6, 4, 'Finance'),
  f(13, null, 'Productions'),
  f(14, 13, 'Volume 10'),
  f(15, 13, 'Volume 2'),
];

describe('note folder rules (#1408)', () => {
  it('builds the tree in natural, case-insensitive order with levels', () => {
    const t = buildTree(FOLDERS);
    expect(t.roots.map((n) => n.name)).toEqual(['Custodians', 'Productions']);
    expect(t.byId.get(4)!.children.map((n) => n.name)).toEqual([
      'Executive Team',
      'Finance',
      'IT and Records',
    ]);
    expect(t.byId.get(13)!.children.map((n) => n.name)).toEqual(['Volume 2', 'Volume 10']);
    expect(t.byId.get(5)!.depth).toBe(2);
    expect(naturalCompare('volume 2', 'Volume 10')).toBeLessThan(0);
  });

  it('treats a folder whose parent is missing as a top-level one', () => {
    const t = buildTree([f(1, 99, 'Orphan')]);
    expect(t.roots.map((n) => n.id)).toEqual([1]);
    expect(t.byId.get(1)!.parentId).toBeNull();
  });

  it('names the path and the place of a note', () => {
    const t = buildTree(FOLDERS);
    expect(pathText(t.byId, 5)).toBe('Custodians > Executive Team');
    expect(pathText(t.byId, null)).toBe('No Folder');
    expect(pathOf(t.byId, 999)).toEqual([]);
    expect(isInside(t.byId, 5, 4)).toBe(true);
    expect(isInside(t.byId, 4, 5)).toBe(false);
  });

  it('shows the children of the open folders only', () => {
    const t = buildTree(FOLDERS);
    expect(visibleFolders(t.roots, new Set()).map((n) => n.id)).toEqual([4, 13]);
    expect(visibleFolders(t.roots, new Set([4])).map((n) => n.id)).toEqual([4, 5, 6, 7, 13]);
  });

  it('measures the height of a subtree', () => {
    const t = buildTree(FOLDERS);
    expect(subtreeHeight(t.byId.get(4)!)).toBe(2);
    expect(subtreeHeight(t.byId.get(5)!)).toBe(1);
  });

  describe('Move targets of a folder', () => {
    const t = buildTree(FOLDERS);
    const mv = { kind: 'folder', id: 4 } as const;

    it('greys itself, its own subfolders, and where it already is, with a reason', () => {
      expect(moveTarget(t, mv, 4)).toMatchObject({ ok: false, reason: 'This folder' });
      expect(moveTarget(t, mv, 5)).toMatchObject({ ok: false, reason: 'Inside it' });
      expect(moveTarget(t, mv, null)).toMatchObject({ ok: false, reason: 'Already here' });
      expect(moveTarget(t, mv, 13)).toMatchObject({ ok: true });
    });

    it('counts the height of the moved subtree against the 5 levels', () => {
      // A chain of 5: a > b > c > d > e. Moving a two-level folder under d (level 4) would reach 6.
      const chain = buildTree([
        f(1, null, 'a'),
        f(2, 1, 'b'),
        f(3, 2, 'c'),
        f(4, 3, 'd'),
        f(5, 4, 'e'),
        f(6, null, 'm'),
        f(7, 6, 'n'),
      ]);
      expect(moveTarget(chain, { kind: 'folder', id: 6 }, 4)).toMatchObject({
        ok: false,
        reason: 'Too deep',
      });
      expect(moveTarget(chain, { kind: 'folder', id: 7 }, 4)).toMatchObject({ ok: true });
      expect(MAX_DEPTH).toBe(5);
    });

    it('greys a target where a sibling already has the name', () => {
      const tree = buildTree([f(1, null, 'Finance'), f(2, null, 'Custodians'), f(3, 2, 'finance')]);
      expect(moveTarget(tree, { kind: 'folder', id: 1 }, 2)).toMatchObject({
        ok: false,
        reason: 'Name in use',
      });
    });
  });

  it('lets a note go anywhere except the folder it is in', () => {
    const t = buildTree(FOLDERS);
    expect(moveTarget(t, { kind: 'note', folderId: 5 }, 5).ok).toBe(false);
    expect(moveTarget(t, { kind: 'note', folderId: 5 }, null).ok).toBe(true);
    expect(moveTarget(t, { kind: 'note', folderId: null }, 5).ok).toBe(true);
  });

  it('limits where a folder can be created', () => {
    const chain = buildTree([
      f(1, null, 'a'),
      f(2, 1, 'b'),
      f(3, 2, 'c'),
      f(4, 3, 'd'),
      f(5, 4, 'e'),
    ]);
    expect(canCreateIn(chain, 4).ok).toBe(true);
    expect(canCreateIn(chain, 5)).toMatchObject({ ok: false, reason: 'Too deep' });
    const many = buildTree(Array.from({ length: MAX_FOLDERS }, (_, i) => f(i + 1, null, `F${i}`)));
    expect(canCreateIn(many, null)).toMatchObject({ ok: false, reason: 'Limit reached' });
  });

  it('checks names', () => {
    expect(nameError('')).toBe('Enter a folder name.');
    expect(nameError('   ')).toBe('Enter a folder name.');
    expect(nameError('x'.repeat(101))).toBe('Use 100 characters or fewer.');
    expect(nameError('a/b')).toContain('cannot contain');
    expect(nameError('a\\b')).toContain('cannot contain');
    expect(nameError('a\u0007b')).toContain('control');
    expect(nameError(' Finance ')).toBe('');
    expect(clashMessage('Finance', 'Custodians')).toBe(
      'A folder named "Finance" already exists in Custodians.',
    );
  });

  it('words the folder error codes', () => {
    expect(folderErrorText('FOLDER_TOO_DEEP')?.detail).toContain('5 levels');
    expect(folderErrorText('FOLDER_LIMIT')?.detail).toContain('200');
    expect(folderErrorText('FOLDER_NOT_EMPTY', { noteCount: 3, subfolderCount: 1 })?.detail).toBe(
      'It holds 3 notes and 1 subfolder.',
    );
    expect(folderErrorText('FOLDER_CYCLE')).toBeDefined();
    expect(folderErrorText('FOLDER_NAME_TAKEN')).toBeDefined();
    expect(folderErrorText('CONCURRENCY_CONFLICT')?.title).toBe(
      'This folder was changed by someone else.',
    );
    expect(folderErrorText('SOMETHING_ELSE')).toBeUndefined();
  });

  it('turns a scope into the address parameter and the list filters', () => {
    expect(parseFolderParam('12')).toBe(12);
    expect(parseFolderParam('none')).toBe('none');
    expect(parseFolderParam('x')).toBe('all');
    expect(parseFolderParam(null)).toBe('all');
    expect(folderParam('all')).toBeNull();
    expect(folderParam(7)).toBe('7');
    expect(scopeFilter('all')).toEqual({});
    expect(scopeFilter('none')).toEqual({ noFolder: true });
    expect(scopeFilter(9)).toEqual({ folderId: 9 });
  });

  describe('the remembered tree choice (mf.notes.tree)', () => {
    afterEach(() => {
      localStorage.clear();
      vi.restoreAllMocks();
    });

    it('is open by default and remembers "folded"', () => {
      expect(readTreeOpen()).toBe(true);
      writeTreeOpen(false);
      expect(localStorage.getItem(TREE_KEY)).toBe('folded');
      expect(readTreeOpen()).toBe(false);
      writeTreeOpen(true);
      expect(localStorage.getItem(TREE_KEY)).toBeNull();
    });

    it('survives blocked storage', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(readTreeOpen()).toBe(true);
      expect(() => writeTreeOpen(false)).not.toThrow();
    });
  });
});
