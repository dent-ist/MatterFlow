import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ReportAssignmentClient } from '../../../api/generated/api-client';
import { ASSIGNMENT_WARNING, ReportAssignmentWarning } from './assignment-warning';
import { ReportMatrixTab } from './report-matrix-tab';
import { ReportRolesTab } from './report-roles-tab';
import { RoleReportsTab } from './role-reports-tab';

const SENTENCE =
  'Reports show all matters, including sensitive ones. Assign a report only to roles you trust with every matter.';

async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('the assignment warning (#808, option A)', () => {
  it('is one information banner of the shared pattern with its icon, the exact sentence, no button', async () => {
    const fixture = TestBed.createComponent(ReportAssignmentWarning);
    await settle(fixture);
    const banner = (fixture.nativeElement as HTMLElement).querySelector('.pg-banner')!;
    expect(ASSIGNMENT_WARNING).toBe(SENTENCE);
    expect(banner.classList.contains('pg-banner--info')).toBe(true);
    expect(banner.getAttribute('role')).toBe('note');
    expect(banner.querySelector('i.pi-info-circle')).not.toBeNull();
    expect(banner.textContent!.trim()).toBe(SENTENCE);
    expect(banner.querySelector('button')).toBeNull();
  });

  const api = {
    getRolesOfReport: vi.fn().mockReturnValue(of([])),
    getReportsOfRole: vi.fn().mockReturnValue(of([])),
    getReportAssignmentMatrix: vi.fn().mockReturnValue(of({ roles: [], reports: [], cells: [] })),
  };
  const warnings = (el: HTMLElement) => el.querySelectorAll('[data-assignment-warning]');

  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [{ provide: ReportAssignmentClient, useValue: api }],
    }),
  );

  it("shows once on a report's Roles tab", async () => {
    const fixture = TestBed.createComponent(ReportRolesTab);
    fixture.componentRef.setInput('reportId', 5);
    await settle(fixture);
    const found = warnings(fixture.nativeElement);
    expect(found).toHaveLength(1);
    expect(found[0].textContent).toContain(SENTENCE);
  });

  it("shows once on a role's Reports tab", async () => {
    const fixture = TestBed.createComponent(RoleReportsTab);
    fixture.componentRef.setInput('roleId', 3);
    fixture.componentRef.setInput('roleName', 'Pod Lead');
    await settle(fixture);
    const found = warnings(fixture.nativeElement);
    expect(found).toHaveLength(1);
    expect(found[0].textContent).toContain(SENTENCE);
  });

  it('shows once on the Assignments matrix, also when there is nothing to show', async () => {
    const fixture = TestBed.createComponent(ReportMatrixTab);
    await settle(fixture);
    const found = warnings(fixture.nativeElement);
    expect(found).toHaveLength(1);
    expect(found[0].textContent).toContain(SENTENCE);
  });
});
