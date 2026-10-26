import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AssetsClient } from '../../../api/generated/api-client';
import { anAsset } from '../../../shared/testing/asset-testing';
import { apiError, ok } from '../../../shared/testing/org-testing';
import {
  AssetDispositionDialog,
  DispositionOutcome,
  DispositionTarget,
} from './asset-disposition-dialog';

type Mock = ReturnType<typeof vi.fn>;

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }
  await fixture.whenStable();
}

const target = (over: Partial<DispositionTarget> = {}): DispositionTarget => ({
  assetId: 9,
  name: 'Relativity WS 14',
  code: 'ACTIVE',
  openLinkedTaskCount: 3,
  rowVersion: 'AAAA',
  ...over,
});

describe('AssetDispositionDialog', () => {
  let fixture: ComponentFixture<AssetDispositionDialog>;
  let api: Record<'changeAssetDisposition' | 'bulkChangeAssetDisposition', Mock>;
  let outcomes: DispositionOutcome[];
  const body = (): HTMLElement => document.body;
  const q = <T extends HTMLElement>(sel: string): T => body().querySelector<T>(sel)!;
  const all = (sel: string): HTMLElement[] => Array.from(body().querySelectorAll<HTMLElement>(sel));

  async function open(
    targets: DispositionTarget[],
    canEdit = true,
    canDispose = true,
  ): Promise<void> {
    api = {
      changeAssetDisposition: vi
        .fn()
        .mockReturnValue(ok(anAsset({ dispositionCode: 'PENDING_DISPOSITION', isActive: false }))),
      bulkChangeAssetDisposition: vi.fn().mockReturnValue(
        ok({
          correlationId: 'c',
          changed: 1,
          unchanged: 0,
          failed: 1,
          results: [
            { assetId: 9, ok: true, changed: true },
            { assetId: 10, ok: false, changed: false, code: 'DISPOSED_IS_FINAL' },
          ],
        }),
      ),
    };
    TestBed.configureTestingModule({ providers: [{ provide: AssetsClient, useValue: api }] });
    fixture = TestBed.createComponent(AssetDispositionDialog);
    outcomes = [];
    fixture.componentInstance.finished.subscribe((o) => outcomes.push(o));
    fixture.componentRef.setInput('targets', targets);
    fixture.componentRef.setInput('canEdit', canEdit);
    fixture.componentRef.setInput('canDispose', canDispose);
    fixture.componentInstance.visible.set(true);
    await settle(fixture);
  }

  async function pick(code: string): Promise<void> {
    q<HTMLInputElement>(`[data-option="${code}"] input`).click();
    await settle(fixture);
  }

  async function note(text: string): Promise<void> {
    const field = q<HTMLTextAreaElement>('#disposition-note');
    field.value = text;
    field.dispatchEvent(new Event('input'));
    await settle(fixture);
  }

  async function save(): Promise<void> {
    const buttons = all('.p-dialog-footer button');
    buttons[buttons.length - 1].click(); // Cancel first, the confirm button last
    await settle(fixture);
  }

  afterEach(() => {
    fixture.destroy();
    body()
      .querySelectorAll('.p-dialog-mask')
      .forEach((m) => m.remove());
  });

  it('names the asset, offers the four states, marks the current one and disables it', async () => {
    await open([target({ code: 'INACTIVE' })]);
    expect(q('[data-disposition-subject]').textContent).toContain('Relativity WS 14');
    expect(all('[data-option]').map((o) => o.getAttribute('data-option'))).toEqual([
      'ACTIVE',
      'INACTIVE',
      'PENDING_DISPOSITION',
      'DISPOSED',
    ]);
    const current = q<HTMLInputElement>('[data-option="INACTIVE"] input');
    expect(current.disabled).toBe(true);
    expect(q('[data-option="INACTIVE"]').textContent).toContain('(current)');
  });

  it('states the impact of open linked tasks without blocking, and asks for a note only to dispose', async () => {
    await open([target({ code: 'INACTIVE' })]);
    await pick('PENDING_DISPOSITION');
    expect(q('[data-disposition-impact]').textContent).toContain('3 open tasks keep this link.');
    expect(body().querySelector('[data-note-required]')).toBeNull();
    await pick('DISPOSED');
    expect(q('[data-note-required]').textContent).toContain('required');
    await pick('ACTIVE');
    expect(body().querySelector('[data-disposition-impact]')).toBeNull();
  });

  it('refuses a disposal without a note, then sends the change with the row version and the note', async () => {
    await open([target()]);
    await pick('DISPOSED');
    await save();
    expect(api.changeAssetDisposition).not.toHaveBeenCalled();
    expect(q('[data-confirm-error]').textContent).toContain('note is required');
    await note('Destroyed on 12 Oct');
    await save();
    expect(api.changeAssetDisposition).toHaveBeenCalledWith(9, {
      dispositionCode: 'DISPOSED',
      note: 'Destroyed on 12 Oct',
      rowVersion: 'AAAA',
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].asset?.dispositionCode).toBe('PENDING_DISPOSITION');
    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('disables what the person may not choose and says why; a disposed asset can only go back to Inactive', async () => {
    await open([target()], true, false);
    expect(q<HTMLInputElement>('[data-option="PENDING_DISPOSITION"] input').disabled).toBe(true);
    expect(q('[data-option="DISPOSED"] [data-option-why]').textContent).toContain('permission');
    expect(q<HTMLInputElement>('[data-option="INACTIVE"] input').disabled).toBe(false);
    fixture.destroy();
    TestBed.resetTestingModule();

    await open([target({ code: 'DISPOSED' })], true, true);
    expect(q<HTMLInputElement>('[data-option="ACTIVE"] input').disabled).toBe(true);
    expect(q<HTMLInputElement>('[data-option="PENDING_DISPOSITION"] input').disabled).toBe(true);
    expect(q<HTMLInputElement>('[data-option="INACTIVE"] input').disabled).toBe(false);
    await pick('INACTIVE');
    expect(q('[data-note-required]')).not.toBeNull();
  });

  it('changes a selection in one call and lists the assets that could not be changed with the reason', async () => {
    await open([
      target(),
      target({ assetId: 10, name: 'Harvey Vault 2', code: 'DISPOSED', rowVersion: 'BBBB' }),
    ]);
    expect(q('[data-disposition-subject]').textContent).toContain('2 selected assets');
    await pick('PENDING_DISPOSITION');
    expect(q('[data-disposition-impact]').textContent).toContain('2 of the 2 selected assets');
    await save();
    expect(api.bulkChangeAssetDisposition).toHaveBeenCalledWith({
      assetIds: [9, 10],
      dispositionCode: 'PENDING_DISPOSITION',
      note: undefined,
    });
    expect(q('[data-disposition-summary]').textContent).toContain(
      '1 changed, 1 could not be changed.',
    );
    expect(q('[data-disposition-failed-row]').textContent).toContain('Harvey Vault 2');
    expect(q('[data-disposition-failed-row]').textContent).toContain(
      'only be moved back to Inactive',
    );
    expect(outcomes[0].bulk?.failed).toBe(1);
    expect(fixture.componentInstance.visible()).toBe(true); // the result stays until it is closed
  });

  it('keeps the dialog open with the message when the request fails', async () => {
    await open([target()]);
    api.changeAssetDisposition.mockReturnValue(
      apiError(409, {
        title: 'Conflict',
        status: 409,
        code: 'CONCURRENCY_CONFLICT',
        detail: 'The record was changed by someone else.',
      }),
    );
    await pick('INACTIVE');
    await save();
    expect(q('[data-confirm-error]').textContent).toContain('changed by someone else');
    expect(fixture.componentInstance.visible()).toBe(true);
  });
});
