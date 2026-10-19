import { aProject } from '../../../shared/testing/org-testing';
import { groupProjects } from './matter-project-groups';

describe('groupProjects', () => {
  const rows = [
    aProject({ projectId: 1, name: 'Wave 15' }),
    aProject({ projectId: 2, name: 'Zulu', isActive: false }),
    aProject({ projectId: 3, name: 'Wave 7' }),
    aProject({ projectId: 4, name: 'etude 10' }),
    aProject({ projectId: 5, name: 'Étude 2' }),
    aProject({ projectId: 6, name: 'Alpha', isActive: false }),
  ];

  it('puts Active first and sorts each group in natural order, accents and case ignored', () => {
    const g = groupProjects(rows, true);
    expect(g.active.map((p) => p.name)).toEqual(['Étude 2', 'etude 10', 'Wave 7', 'Wave 15']);
    expect(g.archived.map((p) => p.name)).toEqual(['Alpha', 'Zulu']);
  });

  it('keeps the server order inside each group when the list is cut', () => {
    const g = groupProjects(rows, false);
    expect(g.active.map((p) => p.projectId)).toEqual([1, 3, 4, 5]);
    expect(g.archived.map((p) => p.projectId)).toEqual([2, 6]);
  });

  it('does not change the rows it was given', () => {
    const copy = [...rows];
    groupProjects(rows, true);
    expect(rows).toEqual(copy);
  });

  it('handles no projects and only archived projects', () => {
    expect(groupProjects([], true)).toEqual({ active: [], archived: [] });
    expect(groupProjects([rows[1]], true).active).toEqual([]);
  });
});
