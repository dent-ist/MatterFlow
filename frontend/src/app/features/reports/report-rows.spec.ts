import { aCategory, aListItem } from './reports-testing';
import { filterReports, flattenReports, parametersText } from './report-rows';

describe('report rows of the listing (#718)', () => {
  const categories = [
    aCategory({
      categoryId: 1,
      name: 'Task follow-up',
      reports: [
        aListItem({ reportId: 5, name: 'Overdue tasks', description: 'Past due' }),
        aListItem({ reportId: 6, name: 'Tasks per matter', description: undefined }),
      ],
    }),
    aCategory({
      categoryId: 2,
      name: 'Finance',
      sortOrder: 2,
      reports: [aListItem({ reportId: 7, name: 'Billing by client', description: 'Hours billed' })],
    }),
  ];
  const rows = flattenReports(categories);

  it('flattens the categories in the server order and puts the category on every row', () => {
    expect(rows.map((r) => [r.reportId, r.categoryId, r.categoryName])).toEqual([
      [5, 1, 'Task follow-up'],
      [6, 1, 'Task follow-up'],
      [7, 2, 'Finance'],
    ]);
  });

  it('searches the name, the description and the category, case-insensitively, every word must match', () => {
    const ids = (text: string, cats: string[] = []) =>
      filterReports(rows, text, cats).map((r) => r.reportId);
    expect(ids('')).toEqual([5, 6, 7]);
    expect(ids('OVERDUE')).toEqual([5]);
    expect(ids('hours')).toEqual([7]);
    expect(ids('finance')).toEqual([7]);
    expect(ids('tasks matter')).toEqual([6]);
    expect(ids('zzz')).toEqual([]);
  });

  it('combines the category filter with the search (AND) and keeps the order', () => {
    expect(filterReports(rows, '', ['1']).map((r) => r.reportId)).toEqual([5, 6]);
    expect(filterReports(rows, '', ['1', '2']).map((r) => r.reportId)).toEqual([5, 6, 7]);
    expect(filterReports(rows, 'tasks', ['2'])).toEqual([]);
  });

  it('words the Parameters column: No parameters, 1 parameter, n parameters', () => {
    expect(parametersText({ parameterCount: 0 })).toBe('No parameters');
    expect(parametersText({ parameterCount: 1 })).toBe('1 parameter');
    expect(parametersText({ parameterCount: 3 })).toBe('3 parameters');
  });
});
