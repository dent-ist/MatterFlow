import { describe, expect, it } from 'vitest';
import {
  SPLIT_DEFAULT,
  avatarKey,
  clampSplit,
  groupByTag,
  initialsOf,
  sortNotes,
  splitLimit,
  withoutTitleBlock,
  dayHeading,
  lockUi,
  noteHistoryText,
  openPlaceholders,
  placeholderValues,
  resolvePlaceholders,
  titleOfHtml,
} from './note-ui';

const values = {
  date: '11/01/2026',
  time: '03:05 PM',
  matter: '00107-00003 Supply dispute',
  author: 'Dana <W>',
};

describe('note placeholders', () => {
  it('fills the four known placeholders and leaves the others for the person', () => {
    const out = resolvePlaceholders(
      '<p>{{date}} {{ time }} {{Matter}} {{author}} {{custodian}}</p>',
      values,
    );
    expect(out).toBe(
      '<p>11/01/2026 03:05 PM 00107-00003 Supply dispute Dana &lt;W&gt; {{custodian}}</p>',
    );
  });

  it('lists the placeholders still open', () => {
    expect(
      openPlaceholders('{{custodian}} and {{date}} and {{custodian}} and {{ case no }}'),
    ).toEqual(['custodian', 'date', 'case no']);
  });

  it('formats the values like the app', () => {
    const v = placeholderValues(new Date(2026, 10, 1, 15, 5), 'M', 'A');
    expect(v.date).toBe('11/01/2026');
    expect(v.time).toBe('03:05 PM');
    expect(placeholderValues(new Date(2026, 10, 1, 0, 0), 'M', 'A').time).toBe('12:00 AM');
  });
});

describe('lock rules', () => {
  const locked = { isLocked: true, lockedByUserId: 7, lockedByName: 'Marcus Lee' };

  it('lets an editor edit an unlocked note', () => {
    expect(lockUi({ isLocked: false }, 1, false, true)).toMatchObject({
      canEdit: true,
      canUnlock: false,
    });
  });

  it('turns Edit off for everybody while locked, with the reason', () => {
    const ui = lockUi(locked, 7, false, true);
    expect(ui.canEdit).toBe(false);
    expect(ui.editReason).toContain('Marcus Lee');
  });

  it('lets only the locker or an administrator unlock', () => {
    expect(lockUi(locked, 7, false, true).canUnlock).toBe(true);
    expect(lockUi(locked, 1, true, true).canUnlock).toBe(true);
    const other = lockUi(locked, 1, false, true);
    expect(other.canUnlock).toBe(false);
    expect(other.unlockReason).toContain('Marcus Lee or an administrator');
  });

  it('gives a reader no actions', () => {
    expect(lockUi({ isLocked: false }, 1, false, false)).toMatchObject({
      canEdit: false,
      canUnlock: false,
    });
  });
});

describe('history wording and dates', () => {
  it('writes the lines', () => {
    expect(noteHistoryText({ eventType: 'NOTE_LOCKED' })).toBe('locked this note');
    expect(
      noteHistoryText({ eventType: 'NOTE_TAGS_CHANGED', newValue: 'Privilege, Hosting' }),
    ).toBe('changed the tags to Privilege, Hosting');
    expect(noteHistoryText({ eventType: 'NOTE_TAGS_CHANGED' })).toBe('changed the tags: none');
    expect(
      noteHistoryText({ eventType: 'NOTE_SAVED_AFTER_AI_WARNING', summary: 'Policy 7.1' }),
    ).toBe('saved after an AI warning: Policy 7.1');
  });

  it('groups by day', () => {
    const now = new Date(2026, 10, 1, 12, 0);
    expect(dayHeading(new Date(2026, 10, 1, 8, 0).toISOString(), now)).toBe('Today');
    expect(dayHeading(new Date(2026, 9, 31, 23, 0).toISOString(), now)).toBe('Yesterday');
    expect(dayHeading(new Date(2026, 9, 20, 9, 0).toISOString(), now)).toBe('10/20/2026');
  });
});

describe('splitter and title', () => {
  it('keeps the list between 220 and 520 px', () => {
    expect(clampSplit(100)).toBe(260);
    expect(clampSplit(900)).toBe(640);
    expect(clampSplit(900, 500)).toBe(500);
    expect(clampSplit(333.4)).toBe(333);
    expect(clampSplit(Number.NaN)).toBe(SPLIT_DEFAULT);
  });

  it('takes the first non-empty line as the title', () => {
    expect(titleOfHtml('<p></p><h1> Privilege &amp; log </h1><p>x</p>')).toBe('Privilege & log');
    expect(titleOfHtml('')).toBe('');
  });
});

describe('note list helpers', () => {
  const tags = [
    { noteTagId: 2, name: 'Custodians', isActive: true },
    { noteTagId: 1, name: 'Anything', isActive: false },
  ];
  const n = (id: number, tagIds: number[], title = `T${id}`, at = `2026-10-0${id}T10:00:00Z`) => ({
    id,
    title,
    updatedAtUtc: at,
    isPinned: false,
    tags: tagIds.map((noteTagId) => ({ noteTagId })),
  });

  it('groups by tag name, repeats a note in each of its groups and ends with Untagged', () => {
    const g = groupByTag([n(1, [2, 1]), n(2, []), n(3, [2])], tags);
    expect(g.map((x) => x.id)).toEqual(['1', '2', '_none']);
    expect(g[1].notes.map((x) => x.id)).toEqual([1, 3]);
    expect(g[0].tag?.isActive).toBe(false);
  });

  it('keeps only the chosen groups', () => {
    expect(groupByTag([n(1, [2]), n(2, [])], tags, ['_none']).map((x) => x.id)).toEqual(['_none']);
    expect(groupByTag([n(1, [2]), n(2, [])], tags, ['2']).map((x) => x.id)).toEqual(['2']);
  });

  it('sorts newest, oldest and A to Z with pinned notes on top', () => {
    const list = [
      n(1, []),
      { ...n(2, []), isPinned: true, updatedAtUtc: '2026-01-01T00:00:00Z' },
      n(3, []),
    ];
    expect(sortNotes(list, 'updated').map((x) => x.id)).toEqual([2, 3, 1]);
    expect(sortNotes(list, 'oldest').map((x) => x.id)).toEqual([2, 1, 3]);
    expect(sortNotes([n(1, [], 'b'), n(2, [], 'a')], 'title').map((x) => x.id)).toEqual([2, 1]);
  });

  it('gives the list what the card leaves while the note keeps 420 px', () => {
    expect(splitLimit(1000)).toBe(580);
    expect(splitLimit(2000)).toBe(640);
    expect(splitLimit(500)).toBe(276);
  });

  it('takes the first line out of the text only when it is the title', () => {
    expect(withoutTitleBlock('<h1>Plan</h1><p>Body</p>', 'Plan')).toEqual({
      rest: '<p>Body</p>',
      split: true,
    });
    expect(withoutTitleBlock('<ul><li>Plan</li></ul>', 'Plan').split).toBe(false);
    expect(withoutTitleBlock('<p>Other</p>', 'Plan').split).toBe(false);
  });

  it('makes initials and a stable avatar colour', () => {
    expect(initialsOf('Dana Whitfield')).toBe('DW');
    expect(initialsOf('ke\\kekim')).toBe('KE');
    expect(avatarKey('Dana Whitfield')).toBe(avatarKey('Dana Whitfield'));
  });
});
