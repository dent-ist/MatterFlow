import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ClientsClient, MattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  FakeMeApi,
  aMatter,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { MatterFormDialog } from './matter-form-dialog';

@Component({
  imports: [MatterFormDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-matter-form-dialog
    [matter]="matter()"
    [clientId]="clientId()"
    [(visible)]="open"
    (saved)="log.push($event.matterRef)"
  />`,
})
class Host {
  readonly matter = signal<ReturnType<typeof aMatter> | null>(null);
  readonly clientId = signal<number | null>(null);
  readonly open = signal(true);
  readonly log: string[] = [];
}

describe('MatterFormDialog: one form for New and Edit (MD-43, #1061)', () => {
  let matters: Record<string, ReturnType<typeof vi.fn>>;
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  const labels = (root: ParentNode) =>
    Array.from(root.querySelectorAll('.mf-label, .mf-field__label')).map((l) =>
      l
        .textContent!.replace(/\(required\)/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    );

  async function start(edit: boolean) {
    matters = {
      createMatter: vi.fn().mockReturnValue(ok(aMatter({ matterRef: '00343-00099' }))),
      getMatterCustomFieldForm: vi.fn().mockReturnValue(ok({})),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(
          new FakeMeApi(
            withPermissions('Matter.View', 'Matter.Create', 'Matter.Edit', 'Matter.EditNumber'),
          ),
        ),
        { provide: MattersClient, useValue: matters },
        {
          provide: ClientsClient,
          useValue: {
            getClient: vi
              .fn()
              .mockReturnValue(
                ok({ clientId: 1, clientNumber: '00343', name: 'Acme Corp', isActive: true }),
              ),
            listClients: vi.fn().mockReturnValue(ok({ items: [] })),
          },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const f = TestBed.createComponent(Host);
    if (edit) f.componentInstance.matter.set(aMatter());
    else f.componentInstance.clientId.set(1);
    await settle(f);
    return f;
  }

  it('New and Edit have the same fields in the same order, with the same help texts', async () => {
    await start(false);
    const created = labels(q('.mf-formdlg')!);
    const help = q('.mf-formdlg')!.textContent;
    TestBed.resetTestingModule();
    document.body.querySelectorAll('.p-dialog-mask').forEach((e) => e.remove());
    await start(true);
    const edited = labels(q('.mf-formdlg')!);
    expect(edited).toEqual(created);
    expect(created.slice(0, 5)).toEqual([
      'Client',
      'Matter number',
      'CM Number',
      'Matter name',
      'AI allowed',
    ]);
    const editHelp = q('.mf-formdlg')!.textContent!;
    for (const text of [
      "as issued by the firm's main system",
      'never typed',
      'Restricts this matter',
      'Which AI tools may be used',
    ]) {
      expect(help).toContain(text);
      expect(editHelp).toContain(text);
    }
  });

  it('shows the CM Number as a read-only preview that follows the client and the matter number', async () => {
    const f = await start(false);
    expect(q('#matter-number')).not.toBeNull();
    expect(q('[data-cm-value]')!.tagName).toBe('OUTPUT'); // not an input: it is never typed
    await settle(f);
    const input = q('#matter-number') as HTMLInputElement;
    input.value = '12';
    input.dispatchEvent(new Event('input'));
    await settle(f);
    expect(q('[data-cm-value]')!.textContent).toBe('00343-00012');
  });

  it('creates with the client and the number, and says what is missing with the same messages', async () => {
    const f = await start(false);
    (q('[data-panel-primary] button') as HTMLButtonElement).click();
    await settle(f);
    const summary = q('[data-summary]')!.textContent!;
    expect(summary).toContain('Enter a matter number.');
    expect(summary).toContain('Enter a matter name.');
    expect(matters['createMatter']).not.toHaveBeenCalled();

    const num = q('#matter-number') as HTMLInputElement;
    num.value = '99';
    num.dispatchEvent(new Event('input'));
    const name = q('#matter-name') as HTMLInputElement;
    name.value = 'Merger';
    name.dispatchEvent(new Event('input'));
    await settle(f);
    (q('[data-panel-primary] button') as HTMLButtonElement).click();
    await settle(f);
    expect(matters['createMatter']).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 1, matterNumber: '99', name: 'Merger', aiAllowed: 'No' }),
    );
    expect(f.componentInstance.log).toEqual(['00343-00099']);
  });
});
