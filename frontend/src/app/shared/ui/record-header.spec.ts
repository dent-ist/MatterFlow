import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { settle } from '../testing/org-testing';
import { CRUMB_MAX, RecordAction, RecordHeader, truncateCrumb } from './record-header';

const LONG = 'Meridian Pharmaceuticals International Holdings, Incorporated and its Subsidiaries';

function action(id: string, role: RecordAction['role'], extra: Partial<RecordAction> = {}) {
  return { id, role, label: id, run: vi.fn(), ...extra } as RecordAction;
}

@Component({
  imports: [RecordHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-record-header
      kind="matter"
      [parents]="[{ label: 'Matters', link: '/matters' }]"
      [current]="current()"
      ref="00107-00001"
      [name]="name()"
      [active]="true"
      [sensitive]="sensitive()"
      [actions]="actions()"
    >
      <span mfContext data-ctx>Client 00107 Hartwell</span>
    </mf-record-header>
  `,
})
class Host {
  readonly current = signal('00107-00001 Short');
  readonly name = signal('Short');
  readonly sensitive = signal(false);
  readonly actions = signal<RecordAction[]>([]);
}

describe('truncateCrumb', () => {
  it('leaves text up to 40 characters alone and cuts longer text with an ellipsis (40 characters visible)', () => {
    expect(CRUMB_MAX).toBe(40);
    expect(truncateCrumb('a'.repeat(40))).toBe('a'.repeat(40));
    const cut = truncateCrumb('b'.repeat(41));
    expect(cut.length).toBe(40);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('mf-record-header', () => {
  let fixture: ComponentFixture<Host>;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement>(sel: string): T | null => el().querySelector<T>(sel);

  async function create(setup?: (h: Host) => void): Promise<void> {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(Host);
    setup?.(fixture.componentInstance);
    await settle(fixture);
  }

  it('renders one h1 with the reference and the name, and the context line from the slot', async () => {
    await create();
    expect(el().querySelectorAll('h1').length).toBe(1);
    expect(q('h1 .mf-ref')?.textContent).toBe('00107-00001');
    expect(q('h1 [data-name]')?.textContent).toBe('Short');
    expect(q('[data-ctx]')?.textContent).toBe('Client 00107 Hartwell');
  });

  it('cuts only the last crumb: 40 characters visible, the full text as tooltip and for screen readers, aria-current on it', async () => {
    await create((h) => {
      h.current.set('00107-00001 ' + LONG);
      h.name.set(LONG);
    });
    const cur = q('[data-crumb-current]')!;
    expect(cur.getAttribute('aria-current')).toBe('page');
    expect(cur.getAttribute('title')).toBe('00107-00001 ' + LONG);
    expect(cur.querySelector('[aria-hidden=true]')!.textContent!.length).toBe(40);
    expect(cur.querySelector('.mf-sr-only')!.textContent).toBe('00107-00001 ' + LONG);
    expect(q('.rh__trail a')?.textContent).toBe('Matters'); // earlier steps are unchanged links
  });

  it('gives the name the full text as tooltip and keeps it whole in the heading', async () => {
    await create((h) => h.name.set(LONG));
    expect(q('h1 [data-name]')?.getAttribute('title')).toBe(LONG);
    expect(q('h1')!.textContent).toContain(LONG);
  });

  it('puts Edit, Activity and the primary action in the header and the rest in the overflow, in that order', async () => {
    await create((h) =>
      h.actions.set([
        action('edit', 'edit'),
        action('activity', 'activity'),
        action('create', 'primary'),
        action('new-project', 'secondary'),
        action('toggle', 'state'),
      ]),
    );
    const buttons = Array.from(el().querySelectorAll('[data-page-actions] > button')).map((b) =>
      b.getAttribute('data-action'),
    );
    expect(buttons).toEqual(['edit', 'activity', 'create']);
    q<HTMLButtonElement>('[data-overflow]')!.click();
    await settle(fixture);
    expect(
      Array.from(el().querySelectorAll('[role=menuitem]')).map((b) =>
        b.getAttribute('data-action'),
      ),
    ).toEqual(['new-project', 'toggle']);
    expect(q('[data-overflow]')!.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('renders no overflow when nothing goes into it', async () => {
    await create((h) => h.actions.set([action('edit', 'edit'), action('create', 'primary')]));
    expect(q('[data-overflow]')).toBeNull();
    TestBed.resetTestingModule();
    await create((h) => h.actions.set([]));
    expect(q('[data-overflow]')).toBeNull();
  });

  it('keeps a disabled primary action focusable with aria-disabled and its reason, and does not run it', async () => {
    const create1 = action('create', 'primary', { disabled: true, reason: 'Inactive.' });
    await create((h) => h.actions.set([create1]));
    const b = q<HTMLButtonElement>('[data-action=create]')!;
    expect(b.disabled).toBe(false);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(b.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Inactive.',
    );
    b.click();
    expect(create1.run).not.toHaveBeenCalled();
  });

  it('shows the Sensitive note as a one-line role=note that the badge points to', async () => {
    await create((h) => h.sensitive.set(true));
    const note = q('[role=note]')!;
    expect(note.textContent).toContain('Sensitive matter.');
    expect(note.textContent).toContain('does not restrict');
    expect(note.hasAttribute('aria-live')).toBe(false);
    const badge = q('mf-sensitive-badge span[aria-describedby]')!;
    expect(badge.getAttribute('aria-describedby')).toBe(note.id);
  });

  it('draws the skeleton without a title, actions or note', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const f = TestBed.createComponent(RecordHeader);
    f.componentRef.setInput('kind', 'project');
    f.componentRef.setInput('skeleton', true);
    f.componentRef.setInput('parents', [{ label: 'Matters', link: '/matters' }, { label: '' }]);
    await settle(f);
    const root = f.nativeElement as HTMLElement;
    expect(root.querySelector('[data-title-skeleton]')).not.toBeNull();
    expect(root.querySelectorAll('[data-crumb-skeleton]').length).toBe(2);
    expect(root.querySelector('[data-overflow]')).toBeNull();
  });
});

describe('mf-record-header on a phone and a tablet', () => {
  let original: typeof matchMedia;
  const queries = (phone: boolean, desktop: boolean) => (query: string) =>
    ({
      matches: query.includes('max-width') ? phone : desktop,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;

  beforeEach(() => (original = window.matchMedia));
  afterEach(() => (window.matchMedia = original));

  async function visible(phone: boolean, desktop: boolean) {
    window.matchMedia = queries(phone, desktop);
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const f = TestBed.createComponent(Host);
    f.componentInstance.actions.set([
      action('edit', 'edit'),
      action('activity', 'activity'),
      action('create', 'primary'),
      action('new-project', 'secondary'),
      action('toggle', 'state'),
    ]);
    await settle(f);
    const root = f.nativeElement as HTMLElement;
    const buttons = Array.from(root.querySelectorAll('[data-page-actions] > button')).map((b) =>
      b.getAttribute('data-action'),
    );
    root.querySelector<HTMLButtonElement>('[data-overflow]')!.click();
    await settle(f);
    const menu = Array.from(root.querySelectorAll('[role=menuitem]')).map((b) =>
      b.getAttribute('data-action'),
    );
    return { buttons, menu };
  }

  it('phone: only the primary action stays, everything else is in the overflow', async () => {
    expect(await visible(true, false)).toEqual({
      buttons: ['create'],
      menu: ['edit', 'activity', 'new-project', 'toggle'],
    });
  });

  it('tablet: the primary action and Edit stay; the actions beyond the first two are in the overflow', async () => {
    expect(await visible(false, false)).toEqual({
      buttons: ['edit', 'create'],
      menu: ['activity', 'new-project', 'toggle'],
    });
  });
});
