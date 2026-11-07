import { aCategory, aListItem } from './reports-testing';
import { starAnnouncement, starLabel, starTip, withFavourite } from './report-favourites';
import { flattenReports } from './report-rows';

describe('favourite wording and row updates (#723)', () => {
  it('words the tooltip in Title Case and the accessible name with the report', () => {
    expect(starTip(false)).toBe('Add to Favourites');
    expect(starTip(true)).toBe('Remove from Favourites');
    expect(starLabel('Overdue tasks', false)).toBe('Add Overdue tasks to favourites');
    expect(starLabel('Overdue tasks', true)).toBe('Remove Overdue tasks from favourites');
    expect(starAnnouncement('Overdue tasks', true)).toBe('Overdue tasks added to favourites.');
    expect(starAnnouncement('Overdue tasks', false)).toBe('Overdue tasks removed from favourites.');
  });

  it('changes the mark of one report and leaves the rows and their order alone', () => {
    const rows = flattenReports([
      aCategory({
        reports: [aListItem({ reportId: 5 }), aListItem({ reportId: 6, isFavourite: true })],
      }),
    ]);
    const next = withFavourite(rows, 5, true);
    expect(next.map((r) => [r.reportId, r.isFavourite])).toEqual([
      [5, true],
      [6, true],
    ]);
    expect(rows[0].isFavourite).toBeFalsy();
    expect(withFavourite(next, 6, false).map((r) => r.isFavourite)).toEqual([true, false]);
  });
});
