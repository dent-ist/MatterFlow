import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IntegrationResponse } from '../../../../api/generated/api-client';
import { settle } from '../../../../shared/testing/org-testing';
import { IntegrationDialog, IntegrationDraft, isHttpsAddress } from './integration-dialog';
import { SecretDialog, SecretDraft } from './secret-dialog';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SecretDialog, IntegrationDialog],
  template: `
    <mf-secret-dialog
      [(open)]="secretOpen"
      [replacing]="replacing()"
      [busy]="false"
      [secretError]="secretError()"
      (save)="secrets.push($event)"
    />
    <mf-integration-dialog
      [(open)]="integrationOpen"
      [integration]="editing()"
      [fieldErrors]="fieldErrors()"
      (save)="drafts.push($event)"
    />
  `,
})
class Host {
  readonly secretOpen = signal(false);
  readonly replacing = signal(false);
  readonly secretError = signal('');
  readonly integrationOpen = signal(false);
  readonly editing = signal<IntegrationResponse | null>(null);
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly secrets: SecretDraft[] = [];
  readonly drafts: IntegrationDraft[] = [];
}

describe('Integrations dialogs (#1395)', () => {
  let fixture: ComponentFixture<Host>;
  const doc = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
  const typeInto = async (id: string, value: string): Promise<void> => {
    const input = doc(`#${id}`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
  };
  const submit = async (formSel: string): Promise<void> => {
    doc(formSel)!.dispatchEvent(new Event('submit'));
    await settle(fixture);
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(Host);
    await settle(fixture);
  });

  afterEach(() => fixture.destroy());

  describe('secret dialog', () => {
    beforeEach(async () => {
      fixture.componentInstance.secretOpen.set(true);
      await settle(fixture);
    });

    it('masks the secret, says it is never shown again and starts empty', () => {
      const input = doc('#sd-secret') as HTMLInputElement;
      expect(input.type).toBe('password');
      expect(input.getAttribute('autocomplete')).toBe('new-password');
      expect(input.value).toBe('');
      expect(doc('[data-secret-form]')!.textContent).toContain('never shows it again');
      expect(doc('[data-panel-title]')!.textContent).toContain('Set Client Secret');
    });

    it('says Replace when a secret is stored', async () => {
      fixture.componentInstance.secretOpen.set(false);
      fixture.componentInstance.replacing.set(true);
      await settle(fixture);
      fixture.componentInstance.secretOpen.set(true);
      await settle(fixture);

      expect(doc('[data-panel-title]')!.textContent).toContain('Replace Client Secret');
    });

    it('needs both the value and the date, and sends them trimmed', async () => {
      await submit('[data-secret-form]');
      expect(fixture.componentInstance.secrets).toEqual([]);
      expect(doc('#sd-secret-error')!.textContent).toContain('Enter the client secret.');
      expect(doc('[data-expires-error]')!.textContent).toContain(
        'Enter the date the secret expires.',
      );

      await typeInto('sd-secret', '  Abc8Q~value  ');
      await typeInto('sd-expires', '2027-03-18');
      await submit('[data-secret-form]');

      expect(fixture.componentInstance.secrets).toEqual([
        { secret: 'Abc8Q~value', expiresOn: '2027-03-18' },
      ]);
    });

    it('catches a pasted Secret ID and does not send it', async () => {
      await typeInto('sd-secret', '3f2a9c1e-8b7d-4e5f-9a6b-1c2d3e4f5a6b');
      await typeInto('sd-expires', '2027-03-18');
      await submit('[data-secret-form]');

      expect(doc('#sd-secret-error')!.textContent).toContain('That looks like the Secret ID');
      expect(fixture.componentInstance.secrets).toEqual([]);
    });

    it('shows what the server said under the field', async () => {
      fixture.componentInstance.secretError.set('The secret is not valid.');
      await settle(fixture);

      expect(doc('#sd-secret-error')!.textContent).toContain('The secret is not valid.');
    });

    it('forgets the value when it closes', async () => {
      await typeInto('sd-secret', 'Abc8Q~value');
      fixture.componentInstance.secretOpen.set(false);
      await settle(fixture);
      fixture.componentInstance.secretOpen.set(true);
      await settle(fixture);

      expect((doc('#sd-secret') as HTMLInputElement).value).toBe('');
    });
  });

  describe('integration dialog', () => {
    beforeEach(async () => {
      fixture.componentInstance.integrationOpen.set(true);
      await settle(fixture);
    });

    it('is the default width form dialog with the five fields and a help for the scope', () => {
      expect(doc('[data-panel-title]')!.textContent).toContain('Add Integration');
      for (const id of ['ig-name', 'ig-base', 'ig-scope']) expect(doc(`#${id}`)).not.toBeNull();
      expect(doc('[data-integration-type]')).not.toBeNull();
      expect(doc('[data-integration-enabled]')).not.toBeNull();
      expect(doc('#ig-scope-help')!.textContent).toContain('api://<app-id>/.default');
      expect(doc('[data-type-help]')!.textContent).toContain('as many as you need');
    });

    it('requires a name and an https Base URL', async () => {
      await typeInto('ig-base', 'http://matters.example-firm.test');
      await submit('[data-integration-form]');

      expect(fixture.componentInstance.drafts).toEqual([]);
      expect(doc('#ig-name-error')!.textContent).toContain('Enter a name.');
      expect(doc('#ig-base-error')!.textContent).toContain('starts with https://');
    });

    it('sends a trimmed draft', async () => {
      await typeInto('ig-name', ' Billing Export ');
      await typeInto('ig-base', 'https://billing.example-firm.test/export');
      await typeInto('ig-scope', 'api://ffffffff-0000-4000-8000-000000000006/.default');
      await submit('[data-integration-form]');

      expect(fixture.componentInstance.drafts).toEqual([
        {
          name: 'Billing Export',
          typeCode: 'OTHER',
          baseUrl: 'https://billing.example-firm.test/export',
          scope: 'api://ffffffff-0000-4000-8000-000000000006/.default',
          isEnabled: true,
        },
      ]);
    });

    it('refuses a scope with spaces', async () => {
      await typeInto('ig-name', 'X');
      await typeInto('ig-scope', 'two words');
      await submit('[data-integration-form]');

      expect(fixture.componentInstance.drafts).toEqual([]);
      expect(doc('#ig-scope-error')!.textContent).toContain('without spaces');
    });

    it("shows the server's messages (second Matter Lookup, duplicate name) under their fields", async () => {
      fixture.componentInstance.fieldErrors.set({
        typeCode: 'There is already a Matter Lookup integration. Edit it instead, or choose Other.',
        name: "An integration named 'X' already exists.",
      });
      await settle(fixture);

      expect(doc('[data-type-error]')!.textContent).toContain('already a Matter Lookup');
      expect(doc('#ig-name-error')!.textContent).toContain('already exists');
    });

    it('starts from the integration when editing', async () => {
      fixture.componentInstance.integrationOpen.set(false);
      fixture.componentInstance.editing.set({
        integrationId: 1,
        name: 'Matter Lookup',
        typeCode: 'MATTER_LOOKUP',
        baseUrl: 'https://m.test/api',
        scope: 'api://x/.default',
        isEnabled: false,
        status: 'DISABLED',
        lastTest: undefined,
        rowVersion: 'AA==',
      });
      await settle(fixture);
      fixture.componentInstance.integrationOpen.set(true);
      await settle(fixture);

      expect(doc('[data-panel-title]')!.textContent).toContain('Edit Integration');
      expect((doc('#ig-name') as HTMLInputElement).value).toBe('Matter Lookup');
      expect((doc('#ig-base') as HTMLInputElement).value).toBe('https://m.test/api');
      expect((doc('[data-integration-enabled]') as HTMLInputElement).checked).toBe(false);
    });
  });

  it('isHttpsAddress accepts only https with a host, no user name and no fragment', () => {
    expect(isHttpsAddress('https://matters.example-firm.test/api/v1')).toBe(true);
    for (const bad of [
      'http://x.test',
      'https://',
      'matters.test',
      'https://u:p@x.test',
      'https://x.test/#a',
      'javascript:alert(1)',
    ])
      expect(isHttpsAddress(bad), bad).toBe(false);
  });
});
