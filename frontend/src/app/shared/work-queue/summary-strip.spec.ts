import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import { MattersClient, ProjectsClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { FakeMeApi, ok, provideFakeMe, settle, withPermissions } from '../testing/org-testing';
import { SummaryStrip } from './summary-strip';
import { provideClock } from './work-queue-testing';

const NUMBERS = { openTasks: 5, overdue: 2, dueSoon: 1, asap: 0, onHold: 3 };

describe('SummaryStrip', () => {
  let matters: { getMatterSummary: ReturnType<typeof vi.fn> };
  let projects: { getProjectSummary: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<SummaryStrip>;
  const el = (): HTMLElement => fixture.nativeElement;
  const text = (e: Element | null): string => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  async function create(
    permissions: Permission[],
    inputs: Record<string, unknown>,
    summary: unknown = { matterId: 7, ...NUMBERS },
  ): Promise<void> {
    matters = { getMatterSummary: vi.fn().mockReturnValue(ok(summary)) };
    projects = { getProjectSummary: vi.fn().mockReturnValue(ok({ projectId: 3, ...NUMBERS })) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: MattersClient, useValue: matters },
        { provide: ProjectsClient, useValue: projects },
        ...provideClock('2026-10-14T15:00:00Z', 'America/Chicago'),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(SummaryStrip);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await settle(fixture);
  }

  it('link mode: five items whose links stay on the record tab', async () => {
    await create(['Task.View'], { kind: 'matter', id: 7, path: '/matters/7' });
    const items = Array.from(el().querySelectorAll<HTMLAnchorElement>('a[data-strip-item]'));
    expect(items.map((a) => text(a))).toEqual([
      'Open 5',
      'Overdue 2',
      'Due soon 1',
      'ASAP 0',
      'On hold 3',
    ]);
    expect(items[0].getAttribute('href')).toBe('/matters/7?tab=tasks');
    expect(items[4].getAttribute('href')).toBe('/matters/7?tab=tasks&view=onHold');
    expect(items[3].classList.contains('zero')).toBe(true);
  });

  it('toggle mode: buttons, the active one pressed, a pick is reported', async () => {
    await create(['Task.View'], { kind: 'project', id: 3, interactive: true, active: 'asap' });
    expect(projects.getProjectSummary).toHaveBeenCalledWith(3);
    const buttons = Array.from(el().querySelectorAll<HTMLButtonElement>('button[data-strip-item]'));
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
      'true',
      'false',
    ]);
    const picked: string[] = [];
    fixture.componentInstance.pick.subscribe((k) => picked.push(k));
    buttons[1].click();
    expect(picked).toEqual(['overdue']);
  });

  it('reports the open count and asks again when reload changes', async () => {
    const opened: number[] = [];
    await create(['Task.View'], { kind: 'matter', id: 7, interactive: true });
    fixture.componentInstance.opened.subscribe((n) => opened.push(n));
    fixture.componentRef.setInput('reload', 1);
    await settle(fixture);
    expect(matters.getMatterSummary).toHaveBeenCalledTimes(2);
    expect(opened).toEqual([5]);
  });

  it('draws nothing and asks for nothing without Task.View', async () => {
    await create([], { kind: 'matter', id: 7, path: '/matters/7' });
    expect(matters.getMatterSummary).not.toHaveBeenCalled();
    expect(el().querySelector('[data-strip]')).toBeNull();
  });

  it('keeps the numbers it has when a later load fails', async () => {
    await create(['Task.View'], { kind: 'matter', id: 7, path: '/matters/7' });
    matters.getMatterSummary.mockReturnValue(throwError(() => new Error('boom')));
    fixture.componentRef.setInput('reload', 1);
    await settle(fixture);
    expect(text(el().querySelector('[data-strip-item="open"]'))).toBe('Open 5');
  });
});
