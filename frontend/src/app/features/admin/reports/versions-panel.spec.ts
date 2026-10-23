import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ReportDefinitionsClient } from '../../../api/generated/api-client';
import { VersionsPanel } from './versions-panel';

const versions = [
  {
    versionId: 12,
    versionNo: 3,
    createdAtUtc: '2026-10-22T10:00:00Z',
    createdByUserId: 1,
    createdByName: 'Ann',
    changeNote: 'added pod filter',
    isCurrent: true,
    hash: 'AA',
  },
  {
    versionId: 11,
    versionNo: 2,
    createdAtUtc: '2026-10-12T10:00:00Z',
    createdByUserId: 2,
    createdByName: 'Bo',
    changeNote: undefined,
    isCurrent: false,
    hash: 'BB',
  },
  {
    versionId: 10,
    versionNo: 1,
    createdAtUtc: '2026-10-01T10:00:00Z',
    createdByUserId: 2,
    createdByName: undefined,
    changeNote: undefined,
    isCurrent: false,
    hash: 'CC',
  },
];

@Component({
  imports: [VersionsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-versions-panel
    [reportId]="5"
    [blockedReason]="blocked"
    (restoreRequested)="restored = $event"
  />`,
})
class Host {
  blocked = '';
  restored: number | null = null;
}

describe('VersionsPanel (#714)', () => {
  const api = { listReportVersions: vi.fn(), compareReportVersions: vi.fn() };

  async function create(blocked = '') {
    api.listReportVersions.mockReturnValue(of(versions));
    TestBed.configureTestingModule({
      providers: [{ provide: ReportDefinitionsClient, useValue: api }],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.blocked = blocked;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    api.listReportVersions.mockReset();
    api.compareReportVersions.mockReset();
  });

  it('lists every version with author and note and marks the current one in text', async () => {
    const { el } = await create();
    expect(api.listReportVersions).toHaveBeenCalledWith(5);
    expect(
      [...el.querySelectorAll('[data-version]')].map((v) => v.getAttribute('data-version')),
    ).toEqual(['3', '2', '1']);
    expect(el.querySelector('[data-version="3"] [data-current]')!.textContent).toBe('Current');
    expect(el.querySelector('[data-version="3"]')!.textContent).toContain('Ann');
    expect(el.querySelector('[data-version="3"]')!.textContent).toContain('added pod filter');
    expect(el.querySelector('[data-version="1"]')!.textContent).toContain('Unknown');
    // The first version has nothing to compare with; the current one cannot be restored.
    expect(el.querySelector('[data-version="1"] [data-compare]')).toBeNull();
    expect(el.querySelector('[data-version="3"] [data-restore]')).toBeNull();
  });

  it('compares a version with the one before it, with added and removed lines readable without colour', async () => {
    api.compareReportVersions.mockReturnValue(
      of({
        fromVersionNo: 2,
        toVersionNo: 3,
        sql: [
          { kind: 'same', text: 'SELECT a', oldLine: 1, newLine: 1 },
          { kind: 'removed', text: 'FROM t', oldLine: 2, newLine: undefined },
          { kind: 'added', text: 'FROM dbo.t', oldLine: undefined, newLine: 2 },
        ],
        parametersAdded: ['PODS'],
        parametersRemoved: [],
        parametersChanged: ['DATE'],
      }),
    );
    const { fixture, el } = await create();
    el.querySelector<HTMLButtonElement>('[data-version="3"] [data-compare]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.compareReportVersions).toHaveBeenCalledWith(5, 3, 2);
    const diff = el.querySelector('[data-diff]')!;
    expect(diff.textContent).toContain('added PODS');
    expect(diff.textContent).toContain('changed DATE');
    const lines = [...diff.querySelectorAll('.vp__line')].map((l) =>
      l.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(lines).toEqual(['SELECT a', '-Removed: FROM t', '+Added: FROM dbo.t']);
    // A second click closes it.
    el.querySelector<HTMLButtonElement>('[data-version="3"] [data-compare]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-diff]')).toBeNull();
  });

  it('asks before restoring and then reports the version to the page', async () => {
    const { fixture, el } = await create();
    el.querySelector<HTMLButtonElement>('[data-version="2"] [data-restore]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.restored).toBeNull();
    const confirm = Array.from(document.querySelectorAll('button')).find(
      (b) =>
        b.textContent?.trim() === 'Restore as a new version' && b.closest('p-dialog, .p-dialog'),
    );
    expect(confirm).toBeDefined();
    confirm!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.restored).toBe(2);
  });

  it('does not offer Restore while the editor holds unsaved changes, and says why', async () => {
    const { el } = await create('Save or discard your changes before restoring a version.');
    expect(el.querySelector('[data-restore-blocked]')!.textContent).toContain('Save or discard');
    expect(el.querySelector<HTMLButtonElement>('[data-version="2"] [data-restore]')!.disabled).toBe(
      true,
    );
  });
});
