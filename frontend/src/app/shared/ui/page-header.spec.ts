import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Crumb, PageHeader, RecordTitle } from './page-header';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, RecordTitle],
  template: `
    <mf-page-header heading="Clients" description="All your clients." [crumbs]="crumbs()">
      <button mfActions type="button" data-secondary>Export</button>
      @if (showPrimary()) {
        <button mfActions type="button" data-primary>New client</button>
      }
    </mf-page-header>
    <mf-page-header [crumbs]="[{ label: 'Clients', link: '/clients' }, { label: 'Acme' }]">
      <mf-record-title mfTitle ref="00343" name="Acme Corp"
        ><b data-badge>Active</b></mf-record-title
      >
    </mf-page-header>
  `,
})
class Host {
  readonly crumbs = signal<Crumb[]>([]);
  readonly showPrimary = signal(true);
}

describe('mf-page-header', () => {
  async function render() {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, host: fixture.componentInstance };
  }
  const header = (el: HTMLElement, n: number) => el.querySelectorAll('mf-page-header')[n];

  it('renders one H1 with the heading and the description under it', async () => {
    const { el } = await render();
    const h = header(el, 0);
    expect(h.querySelector('h1')!.textContent!.trim()).toBe('Clients');
    expect(h.querySelector('[data-page-description]')!.textContent!.trim()).toBe(
      'All your clients.',
    );
  });

  it('puts the actions on the title row, in the order given (primary last)', async () => {
    const { el } = await render();
    const actions = header(el, 0).querySelector('[data-page-actions]')!;
    expect(Array.from(actions.children).map((b) => b.textContent!.trim())).toEqual([
      'Export',
      'New client',
    ]);
    expect(actions.parentElement!.querySelector('h1')).not.toBeNull(); // same row as the H1
  });

  it('shows no breadcrumb on a top-level page and a labelled trail with real links below it', async () => {
    const { el, host, fixture } = await render();
    expect(header(el, 0).querySelector('nav')).toBeNull();

    host.crumbs.set([{ label: 'Clients', link: '/clients' }, { label: 'Acme Corp' }]);
    fixture.detectChanges();
    const nav = header(el, 0).querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Breadcrumb');
    const link = nav.querySelector('a')!;
    expect(link.textContent).toBe('Clients');
    expect(link.getAttribute('href')).toBe('/clients');
    const current = nav.querySelector('[aria-current="page"]')!;
    expect(current.textContent).toBe('Acme Corp');
    expect(current.tagName).toBe('SPAN'); // the current page is not a link
  });

  it('lets a page supply a rich title: reference in monospace, then the name, then badges', async () => {
    const { el } = await render();
    const h1 = header(el, 1).querySelector('h1')!;
    expect(h1.querySelector('[data-ref]')!.textContent).toBe('00343');
    expect(h1.querySelector('[data-name]')!.textContent).toBe('Acme Corp');
    expect(h1.querySelector('[data-badge]')!.textContent).toBe('Active');
    expect(h1.textContent).toContain('00343');
  });
});
