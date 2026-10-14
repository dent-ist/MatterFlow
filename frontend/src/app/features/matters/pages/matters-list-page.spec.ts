import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { MattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  FakeMeApi,
  aMatter,
  buttonByLabel,
  ok,
  pageOfMatters,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { MattersListPage } from './matters-list-page';

describe('MattersListPage', () => {
  let api: { listMatters: ReturnType<typeof vi.fn> };
  let writeText: ReturnType<typeof vi.fn>;

  async function create(permissions: Permission[] = ['Matter.View', 'Matter.Create']) {
    api = {
      listMatters: vi.fn().mockReturnValue(
        ok(
          pageOfMatters(
            aMatter(),
            aMatter({
              matterId: 8,
              matterRef: '00001-00012',
              clientNumber: '00001',
              clientName: 'Beta LLC',
              clientId: 2,
              isSensitive: true,
              isActive: false,
            }),
          ),
        ),
      ),
    };
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: MattersClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(MattersListPage);
    await settle(fixture);
    return fixture;
  }

  it('shows the combined reference in monospace with a copy button, the client and the status', async () => {
    const fixture = await create();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');

    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.mf-ref')?.textContent).toBe('00343-00012');
    expect(rows[0].querySelector('.mf-ref')?.getAttribute('href')).toBe('/matters/7');
    expect(rows[1].querySelector('.mf-ref')?.textContent).toBe('00001-00012');
    expect(rows[0].textContent).toContain('00343 Acme Corp');
    expect(rows[1].textContent).toContain('Inactive');

    rows[0].querySelector('button')!.click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith('00343-00012');
  });

  it('flags sensitive matters in the list', async () => {
    const fixture = await create();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');

    expect(rows[0].textContent).not.toContain('Sensitive');
    expect(rows[1].textContent).toContain('Sensitive');
  });

  it('passes search text, client, status, page and sort from the URL to the API', async () => {
    const fixture = await create();
    fixture.componentRef.setInput('q', '343-12');
    fixture.componentRef.setInput('clientId', '1');
    fixture.componentRef.setInput('status', 'inactive');
    fixture.componentRef.setInput('page', '3');
    fixture.componentRef.setInput('sort', '-name');
    await settle(fixture);

    expect(api.listMatters).toHaveBeenLastCalledWith('343-12', 1, false, undefined, 3, 25, '-name');
    expect(fixture.nativeElement.querySelector('[data-client-chip]')?.textContent).toContain(
      '00343 Acme Corp',
    );
  });

  it('removes the client filter chip through the URL', async () => {
    const fixture = await create();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.componentRef.setInput('clientId', '1');
    await settle(fixture);

    fixture.nativeElement.querySelector('[data-client-chip] button').click();

    expect(navigate).toHaveBeenCalledWith([], {
      queryParams: { clientId: null, page: null },
      queryParamsHandling: 'merge',
    });
  });

  it('hides New Matter without Matter.Create', async () => {
    const fixture = await create(['Matter.View']);

    expect(buttonByLabel(fixture.nativeElement, 'New Matter')).toBeUndefined();
  });
});
