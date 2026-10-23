import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ReportSchemaClient, SchemaTableResponse } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { HttpErrorResponse } from '@angular/common/http';
import { SchemaBrowserPanel, bracketed, tableText } from './schema-browser-panel';

const table = (name: string, columns: string[]): SchemaTableResponse =>
  ({
    schema: 'dbo',
    name,
    fullName: `dbo.${name}`,
    isView: false,
    columns: columns.map((c, i) => ({
      name: c,
      type: i === 0 ? 'int' : 'nvarchar(200)',
      isNullable: i > 1,
      isPrimaryKey: i === 0,
    })),
  }) as SchemaTableResponse;

describe('bracketed names', () => {
  it('brackets a name and doubles a closing bracket', () => {
    expect(bracketed('Task')).toBe('[Task]');
    expect(bracketed('We]ird')).toBe('[We]]ird]');
    expect(tableText({ schema: 'dbo', name: 'Task' })).toBe('[dbo].[Task]');
  });
});

describe('SchemaBrowserPanel (#715)', () => {
  const api = { searchReportSchema: vi.fn() };

  function create() {
    TestBed.configureTestingModule({ providers: [{ provide: ReportSchemaClient, useValue: api }] });
    const fixture = TestBed.createComponent(SchemaBrowserPanel);
    const inserted: string[] = [];
    fixture.componentInstance.insert.subscribe((t) => inserted.push(t));
    return { fixture, el: fixture.nativeElement as HTMLElement, inserted };
  }

  const settle = async (fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => api.searchReportSchema.mockReset());

  it('lists the tables the server returns, opens one to show its columns and inserts bracketed names', async () => {
    api.searchReportSchema.mockReturnValue(
      of({
        tables: [table('Task', ['TaskId', 'Title', 'DueDate']), table('Pod', ['PodId', 'Name'])],
        total: 2,
        page: 1,
        pageSize: 40,
      }),
    );
    const { fixture, el, inserted } = create();
    await settle(fixture);
    expect(api.searchReportSchema).toHaveBeenCalledWith(undefined, 1, 40);
    expect([...el.querySelectorAll('[data-table] .sb__name')].map((n) => n.textContent)).toEqual([
      'dbo.Task',
      'dbo.Pod',
    ]);
    expect(el.querySelector('[data-schema-status]')!.textContent).toContain('2 tables match');

    const toggle = el.querySelector<HTMLButtonElement>('[data-table="dbo.Task"] .sb__toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const columns = [...el.querySelectorAll('[data-table="dbo.Task"] .sb__col')].map((c) =>
      c.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(columns).toEqual([
      'TaskId int, key',
      'Title nvarchar(200)',
      'DueDate nvarchar(200), null',
    ]);

    el.querySelector<HTMLButtonElement>('[data-table="dbo.Task"] .sb__insert')!.click();
    el.querySelector<HTMLButtonElement>('[aria-label="Insert DueDate"]')!.click();
    expect(inserted).toEqual(['[dbo].[Task]', '[DueDate]']);
  });

  it('searches after a pause, opens the few tables that match and says when nothing does', async () => {
    api.searchReportSchema.mockReturnValueOnce(
      of({ tables: [table('Task', ['TaskId'])], total: 1, page: 1, pageSize: 40 }),
    );
    const { fixture, el } = create();
    await settle(fixture);

    api.searchReportSchema.mockReturnValueOnce(
      of({ tables: [table('Pod', ['PodId', 'Name'])], total: 1, page: 1, pageSize: 40 }),
    );
    const search = el.querySelector<HTMLInputElement>('[data-schema-search]')!;
    search.value = 'name';
    search.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 400));
    await settle(fixture);
    expect(api.searchReportSchema).toHaveBeenLastCalledWith('name', 1, 40);
    expect(el.querySelector('[data-table="dbo.Pod"] .sb__cols')).not.toBeNull();

    api.searchReportSchema.mockReturnValueOnce(of({ tables: [], total: 0, page: 1, pageSize: 40 }));
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 400));
    await settle(fixture);
    expect(el.querySelector('[data-schema-empty]')!.textContent).toContain(
      'No table or column matches',
    );
  });

  it('shows more tables when there are more than one page', async () => {
    api.searchReportSchema.mockReturnValueOnce(
      of({ tables: [table('A', ['Id'])], total: 2, page: 1, pageSize: 40 }),
    );
    const { fixture, el } = create();
    await settle(fixture);
    api.searchReportSchema.mockReturnValueOnce(
      of({ tables: [table('B', ['Id'])], total: 2, page: 2, pageSize: 40 }),
    );
    el.querySelector<HTMLButtonElement>('[data-schema-more]')!.click();
    await settle(fixture);
    expect(api.searchReportSchema).toHaveBeenLastCalledWith(undefined, 2, 40);
    expect(el.querySelectorAll('[data-table]')).toHaveLength(2);
    expect(el.querySelector('[data-schema-more]')).toBeNull();
  });

  it('says reports are unavailable on a 503 and can try again', async () => {
    api.searchReportSchema.mockReturnValueOnce(
      throwError(() =>
        ApiError.from(
          new HttpErrorResponse({ status: 503, error: { code: 'REPORTS_UNAVAILABLE' } }),
        ),
      ),
    );
    const { fixture, el } = create();
    await settle(fixture);
    expect(el.querySelector('[data-schema-failure]')!.textContent).toContain(
      'Reports are not available right now.',
    );
    api.searchReportSchema.mockReturnValueOnce(
      of({ tables: [table('A', ['Id'])], total: 1, page: 1, pageSize: 40 }),
    );
    el.querySelector<HTMLButtonElement>('[data-schema-failure] button')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-schema-failure]')).toBeNull();
    expect(el.querySelectorAll('[data-table]')).toHaveLength(1);
  });
});
