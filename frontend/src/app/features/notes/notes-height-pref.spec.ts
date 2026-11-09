import { TestBed } from '@angular/core/testing';
import { AuthStore } from '../../core/auth/auth.store';
import { NOTES_HEIGHT_KEY, NotesHeightPref } from './notes-height-pref';

describe('NotesHeightPref (#1342)', () => {
  let userId: number | null;

  function create(): NotesHeightPref {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthStore,
          useValue: { profile: () => (userId === null ? null : { userId }) },
        },
      ],
    });
    return TestBed.inject(NotesHeightPref);
  }

  beforeEach(() => {
    localStorage.clear();
    userId = 42;
  });
  afterEach(() => vi.restoreAllMocks());

  it('is off by default and remembers a click per person: 1 when folded, removed when off', () => {
    const pref = create();
    expect(pref.folded()).toBe(false);
    pref.toggle();
    expect(pref.folded()).toBe(true);
    expect(localStorage.getItem(NOTES_HEIGHT_KEY + '42')).toBe('1');
    pref.toggle();
    expect(pref.folded()).toBe(false);
    expect(localStorage.getItem(NOTES_HEIGHT_KEY + '42')).toBeNull();
  });

  it('reads the entry of this person only and uses "anon" without an id', () => {
    localStorage.setItem(NOTES_HEIGHT_KEY + '7', '1');
    expect(create().folded()).toBe(false);
    TestBed.resetTestingModule();
    userId = 7;
    expect(create().folded()).toBe(true);
    TestBed.resetTestingModule();
    userId = null;
    const anon = create();
    expect(anon.key()).toBe(NOTES_HEIGHT_KEY + 'anon');
    anon.toggle();
    expect(localStorage.getItem(NOTES_HEIGHT_KEY + 'anon')).toBe('1');
  });

  it('treats anything but 1 as off', () => {
    for (const v of ['0', 'true', '', '{"a":1}']) {
      localStorage.setItem(NOTES_HEIGHT_KEY + '42', v);
      TestBed.resetTestingModule();
      expect(create().folded()).toBe(false);
    }
  });

  it('works for the visit when storage throws, and starts off after a reload', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const pref = create();
    expect(pref.folded()).toBe(false);
    pref.toggle();
    expect(pref.folded()).toBe(true);
    pref.refresh();
    expect(pref.folded()).toBe(true);
    pref.toggle();
    expect(pref.folded()).toBe(false);
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
    expect(create().folded()).toBe(false);
  });

  it('refresh() picks up a changed entry when storage works', () => {
    const pref = create();
    pref.toggle();
    localStorage.removeItem(NOTES_HEIGHT_KEY + '42');
    pref.refresh();
    expect(pref.folded()).toBe(false);
  });
});
