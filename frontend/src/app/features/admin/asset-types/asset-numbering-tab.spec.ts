import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AssetTypeResponse, AssetTypesClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { anAssetType } from '../../../shared/testing/asset-testing';
import { apiError, ok, settle } from '../../../shared/testing/org-testing';
import { AssetNumberingTab } from './asset-numbering-tab';

type Mock = ReturnType<typeof vi.fn>;

const counter = (over = {}) => ({
  assetTypeId: 4,
  matterId: 7,
  matterRef: '90003-80008',
  matterName: 'Merger Review',
  highestAssigned: 7,
  nextNumber: 8,
  nextAssetNumber: '90003-80008_008',
  hasCounter: true,
  modifiedAtUtc: undefined,
  ...over,
});

const numbered = (over: Partial<AssetTypeResponse> = {}): AssetTypeResponse =>
  anAssetType({
    numbering: {
      enabled: true,
      pattern: '_{###}',
      scope: 'MATTER',
      example: {
        cmNumber: '90003-80008',
        nextCounter: 8,
        isSample: false,
        text: '90003-80008_008',
      },
    },
    ...over,
  });

const unnumbered = (): AssetTypeResponse =>
  anAssetType({
    numbering: {
      enabled: false,
      pattern: '_{###}',
      scope: 'MATTER',
      example: { cmNumber: '90003-80008', nextCounter: 1, isSample: true, text: '90003-80008_001' },
    },
  });

describe('AssetNumberingTab (#1297)', () => {
  let fixture: ComponentFixture<AssetNumberingTab>;
  let api: Record<
    'updateAssetType' | 'listAssetNumberCounters' | 'getAssetNumberCounter' | 'setAssetNextNumber',
    Mock
  >;
  let updates: AssetTypeResponse[];
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const all = (sel: string): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>(sel));
  const text = (sel: string): string => q(sel).textContent!.replace(/\s+/g, ' ').trim();

  async function open(type: AssetTypeResponse, rows = [counter()], total = rows.length) {
    api = {
      updateAssetType: vi.fn().mockReturnValue(ok(numbered())),
      listAssetNumberCounters: vi
        .fn()
        .mockReturnValue(ok({ items: rows, total, page: 1, pageSize: 25 })),
      getAssetNumberCounter: vi.fn().mockReturnValue(ok(counter({ nextNumber: 9 }))),
      setAssetNextNumber: vi.fn().mockReturnValue(ok(counter({ nextNumber: 120 }))),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AssetTypesClient, useValue: api },
        provideFakeMe(new FakeMeApi(withPermissions('AssetType.Manage', 'Matter.View'))),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(AssetNumberingTab);
    fixture.componentRef.setInput('assetType', type);
    updates = [];
    fixture.componentInstance.updated.subscribe((t) => updates.push(t));
    await settle(fixture);
  }

  async function typeTail(value: string, blur = true): Promise<void> {
    const input = q<HTMLInputElement>('[data-tail-input]');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    if (blur) input.dispatchEvent(new Event('blur'));
    await settle(fixture);
  }

  describe('Automatic Numbering', () => {
    it('shows the switch off with no tail group for a type that is not numbered, and no Next Numbers card', async () => {
      await open(unnumbered(), [], 0);
      expect(q<HTMLInputElement>('[data-numbering-switch]').checked).toBe(false);
      expect(el().querySelector('[data-tail-row]')).toBeNull();
      expect(el().querySelector('[data-next-numbers-card]')).toBeNull();
      expect(q<HTMLButtonElement>('[data-save-numbering]').disabled).toBe(true);
    });

    it('shows the grey CM Number prefix, the default tail, the counter text and the whole example with its caption', async () => {
      await open(numbered());
      expect(text('[data-tail-prefix]')).toBe('90003-80008');
      expect(q<HTMLInputElement>('[data-tail-input]').value).toBe('_{###}');
      expect(q('[data-tail-input]').getAttribute('maxlength')).toBe('50');
      expect(text('[data-counter-text]')).toBe(
        'Restarts at 1 for each matter. {###} gives 001, {####} gives 0001.',
      );
      expect(text('[data-numbering-example]')).toBe('90003-80008_008');
      expect(text('[data-example-caption]')).toBe('Based on matter 90003-80008 (its next number).');
    });

    it('names the sample matter while no asset of the type is numbered', async () => {
      const type = numbered();
      type.numbering!.example = {
        cmNumber: '90003-80008',
        nextCounter: 1,
        isSample: true,
        text: '90003-80008_001',
      };
      await open(type, [], 0);
      expect(text('[data-numbering-example]')).toBe('90003-80008_001');
      expect(text('[data-example-caption]')).toBe('Sample matter 90003-80008.');
    });

    it('shows the first broken rule after the first blur, one message, and disables Save Numbering', async () => {
      await open(numbered());
      await typeTail('_{###}.', false);
      // Not yet blurred: no message, but Save is already off.
      expect(el().querySelector('[data-tail-error]')).toBeNull();
      expect(q<HTMLButtonElement>('[data-save-numbering]').disabled).toBe(true);
      await typeTail('_{###}.');
      expect(text('[data-tail-error]')).toBe('The name can’t end with a dot.');
      expect(q('[data-tail-input]').getAttribute('aria-invalid')).toBe('true');
      expect(text('[data-numbering-example]')).toBe('Fix the tail to see an example.');
    });

    it.each([
      ['_a:b_{###}', 'The tail can’t contain \\ / : * ? " < > | or control characters.'],
      ['_{x}_{###}', '"{x}" isn’t a token. The only token is the counter {###}.'],
      [' _{###}', 'The tail can’t start or end with a space.'],
      ['_media', 'Add a counter, for example {###}.'],
      ['_{#}_{##}', 'Use only one counter.'],
      ['_{##########}', 'The counter must have 1 to 9 # characters.'],
      ['x'.repeat(51), 'The tail must be 50 characters or fewer.'],
    ])('says the spec sentence for %j', async (tail, message) => {
      await open(numbered());
      await typeTail(tail);
      expect(text('[data-tail-error]')).toBe(message);
    });

    it('inserts the counter at the caret and then disables the Counter button', async () => {
      await open(numbered());
      await typeTail('-M-');
      const button = q<HTMLButtonElement>('[data-insert-counter]');
      expect(button.disabled).toBe(false);
      const input = q<HTMLInputElement>('[data-tail-input]');
      input.focus();
      input.setSelectionRange(3, 3);
      button.click();
      await settle(fixture);
      expect(input.value).toBe('-M-{###}');
      expect(q<HTMLButtonElement>('[data-insert-counter]').disabled).toBe(true);
      expect(q('[data-insert-counter]').getAttribute('title')).toBe(
        'The tail already has a counter.',
      );
      expect(text('[data-numbering-example]')).toBe('90003-80008-M-008');
    });

    it('saves the pattern with the scope and reports the new row version', async () => {
      await open(numbered());
      await typeTail('-M-{###}');
      q<HTMLButtonElement>('[data-save-numbering]').click();
      await settle(fixture);
      const body = api.updateAssetType.mock.calls[0][1];
      expect(body.numbering).toEqual({ enabled: true, pattern: '-M-{###}', scope: 'MATTER' });
      expect(body.rowVersion).toBe('TTTT');
      expect(updates).toHaveLength(1);
    });

    it('turning on a type saves enabled with the default tail and needs no confirm', async () => {
      await open(unnumbered(), [], 0);
      const box = q<HTMLInputElement>('[data-numbering-switch]');
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      await settle(fixture);
      expect(q<HTMLInputElement>('[data-tail-input]').value).toBe('_{###}');
      q<HTMLButtonElement>('[data-save-numbering]').click();
      await settle(fixture);
      expect(api.updateAssetType.mock.calls[0][1].numbering.enabled).toBe(true);
    });

    it('asks Turn Off Numbering first and sends only enabled false', async () => {
      await open(numbered());
      const box = q<HTMLInputElement>('[data-numbering-switch]');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      await settle(fixture);
      q<HTMLButtonElement>('[data-save-numbering]').click();
      await settle(fixture);
      expect(api.updateAssetType).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain(
        'Numbers already assigned stay and are never used again',
      );
      document.querySelector<HTMLButtonElement>('[data-confirm-primary]')!.click();
      await settle(fixture);
      expect(api.updateAssetType.mock.calls[0][1].numbering).toEqual({ enabled: false });
    });

    it('shows the sentence of a server refusal by its PATTERN code under the tail', async () => {
      await open(numbered());
      api.updateAssetType.mockReturnValue(
        apiError(400, {
          code: 'VALIDATION_FAILED',
          errors: { 'numbering.pattern': [{ code: 'PATTERN_TOO_LONG', message: 'long' }] },
        }),
      );
      await typeTail('_{###}-ok');
      q<HTMLButtonElement>('[data-save-numbering]').click();
      await settle(fixture);
      expect(text('[data-tail-error]')).toBe(
        'The whole name would be longer than 100 characters. Shorten the tail.',
      );
    });

    it('reports a stale row version to the page', async () => {
      await open(numbered());
      let conflicted = 0;
      fixture.componentInstance.conflicted.subscribe(() => conflicted++);
      api.updateAssetType.mockReturnValue(
        apiError(409, { code: 'CONCURRENCY_CONFLICT', detail: 'changed' }),
      );
      await typeTail('-M-{###}');
      q<HTMLButtonElement>('[data-save-numbering]').click();
      await settle(fixture);
      expect(conflicted).toBe(1);
    });

    it('is read only for a retired type', async () => {
      await open(numbered({ isActive: false }));
      expect(text('[data-numbering-readonly]')).toBe(
        'Reactivate this asset type to change numbering.',
      );
      expect(q<HTMLInputElement>('[data-numbering-switch]').disabled).toBe(true);
      expect(q<HTMLInputElement>('[data-tail-input]').disabled).toBe(true);
    });
  });

  describe('Next Numbers', () => {
    it('lists the counters with the full highest and next numbers and the row button', async () => {
      await open(numbered());
      expect(text('[data-next-numbers-card]')).toContain('Next Numbers');
      expect(text('[data-highest-of="7"]')).toBe('90003-80008_007');
      expect(text('[data-next-of="7"]')).toBe('90003-80008_008');
      expect(q('[data-set-next-of="7"]').getAttribute('aria-label')).toBe(
        'Set Next Number for 90003-80008',
      );
      expect(api.listAssetNumberCounters).toHaveBeenCalledWith(4, undefined, 1, 25, 'matter');
    });

    it('says None for a matter whose counter was raised before any asset', async () => {
      await open(numbered(), [counter({ highestAssigned: 0, nextNumber: 120 })]);
      expect(text('[data-highest-of="7"]')).toBe('None');
    });

    it('offers Set for a Matter and an empty state without counters', async () => {
      await open(numbered(), [], 0);
      expect(el().textContent).toContain('No matter has a counter yet.');
      expect(el().textContent).toContain(
        'Use Set for a Matter to continue after folders that already exist on the share.',
      );
      expect(all('[data-set-for-matter]').length).toBe(1);
    });

    it('keeps the card read only (no buttons) while numbering is off but counters exist', async () => {
      await open(unnumbered());
      expect(el().querySelector('[data-next-numbers-card]')).not.toBeNull();
      expect(el().querySelector('[data-set-for-matter]')).toBeNull();
      expect(el().querySelector('[data-set-next-of]')).toBeNull();
    });

    it('opens the Set Next Number dialog from the row with the counter prefilled', async () => {
      await open(numbered());
      q<HTMLButtonElement>('[data-set-next-of="7"]').click();
      await settle(fixture);
      const input = document.querySelector<HTMLInputElement>('[data-next-number-input]')!;
      expect(input.value).toBe('8');
      expect(document.querySelector('[data-next-number-example]')!.textContent).toContain(
        '90003-80008_008',
      );
    });
  });
});
