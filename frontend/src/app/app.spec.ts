import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MessageService } from 'primeng/api';
import { App } from './app';
import { routes } from './app.routes';
import { FakeMeApi, provideFakeMe, withPermissions } from './core/auth/auth-testing';
import { MeApi } from './core/auth/me-api';
import { StubMeApi } from './core/auth/stub-me-api';
import { APP_ENV } from './core/config/app-env';
import { IdentityAdminApi } from './core/identity-admin/identity-admin-api';
import { InMemoryIdentityAdminApi } from './core/identity-admin/in-memory-identity-admin-api';
import { USER_TIME_ZONE } from './core/time/clock';
import { environment } from '../environments/environment';

function configure(scenario: string) {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      MessageService,
      { provide: USER_TIME_ZONE, useValue: 'America/Chicago' },
      { provide: APP_ENV, useValue: { ...environment, stubScenario: scenario } },
      { provide: MeApi, useClass: StubMeApi },
    ],
  });
}

async function open(scenario: string, url = '/') {
  configure(scenario);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  const el = harness.routeNativeElement ?? document.body;
  const root = document.body;
  return { harness, el, root, router: TestBed.inject(Router) };
}

const navLabels = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('nav a')).map((a) => a.textContent?.trim());

// Navigating lazy routes loads sizeable chunks on first use; give the shell tests room when the machine is busy.
describe('App shell with the stub provider', { timeout: 30_000 }, () => {
  // These tests query the whole document; start from an empty one so DOM left behind by other spec files in the same worker cannot leak in.
  beforeEach(() => document.body.replaceChildren());
  afterEach(() => TestBed.resetTestingModule());

  it('creates the root component', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions('Task.View'))),
      ],
    });
    await TestBed.compileComponents(); // the leave-confirm host is deferred
    expect(TestBed.createComponent(App).componentInstance).toBeTruthy();
  });

  it('shows a pending user only Access Pending, from every route', async () => {
    const { harness, router } = await open('pending');
    expect(router.url).toBe('/access-pending');
    const page = harness.routeNativeElement as HTMLElement;
    expect(page.querySelector('h1')?.textContent).toContain('Your access is pending');
    expect(page.textContent).toContain('Tariq Mahmood');
    expect(page.textContent).toContain('KE\\tmahmood');
    expect(document.querySelector('nav')).toBeNull();
    expect(document.querySelector('input[type=search]')).toBeNull();

    for (const url of ['/tasks', '/clients', '/admin/users', '/dashboard', '/nowhere']) {
      await harness.navigateByUrl(url);
      expect(router.url).toBe('/access-pending');
    }
  });

  it('shows an account-disabled message with no Check again button', async () => {
    const { harness } = await open('disabled');
    const page = harness.routeNativeElement as HTMLElement;
    expect(page.textContent).toContain('Your account is disabled. Contact the administrator.');
    expect(page.textContent).not.toContain('Check again');
  });

  it('lets a pending user pass after access is granted ("Check again")', async () => {
    const { harness, router } = await open('pending');
    const stub = TestBed.inject(MeApi) as StubMeApi;
    const page = harness.routeNativeElement as HTMLElement;
    const button = () => page.querySelector('p-button button') as HTMLButtonElement;

    button().click();
    await new Promise((r) => setTimeout(r));
    harness.detectChanges();
    expect(page.querySelector('.mf-status')?.textContent).toContain(
      'Still pending. Nothing has changed yet.',
    );
    expect(router.url).toBe('/access-pending');

    stub.grant();
    button().click();
    await harness.fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    expect(router.url).toBe('/my-work');
  });

  it('shows a technician only permitted nav items and no Administration', async () => {
    const { router } = await open('technician');
    expect(router.url).toBe('/my-work');
    expect(navLabels(document.body)).toEqual([
      'Dashboard',
      'My Work',
      'Task Queue',
      'Pod Work',
      'Clients',
      'Matters',
      'Projects',
      'Assets',
    ]);
    expect(document.body.textContent).not.toContain('Administration');
    expect(document.querySelector('input[type=search]')?.getAttribute('placeholder')).toContain(
      'Search',
    );
    expect(document.body.textContent).toContain('Create task');
  });

  it('hides the header Create task button on the Create task page itself (UXR-23)', async () => {
    const { router } = await open('technician', '/tasks');
    const headerButton = () => document.querySelector('.mf-header p-button');
    expect(headerButton()).not.toBeNull();

    await router.navigateByUrl('/tasks/new');
    await new Promise((resolve) => setTimeout(resolve));
    expect(headerButton()).toBeNull();
  });

  it('shows the pending-access count badge on Users for users who can view users', async () => {
    configure('director');
    TestBed.configureTestingModule({
      providers: [{ provide: IdentityAdminApi, useClass: InMemoryIdentityAdminApi }],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    await new Promise((r) => setTimeout(r, 20));
    harness.detectChanges();

    const badge = document.querySelector('[data-pending-badge]');
    expect(badge?.textContent?.trim()).toBe('2');
    expect(badge?.closest('a')?.textContent).toContain('Users');
  });

  it('hides nav items the user has no View permission for', async () => {
    configure('technician');
    const stub = TestBed.inject(MeApi) as StubMeApi;
    stub.scenarios['technician'] = {
      ...stub.scenarios['technician'],
      permissions: ['Task.View', 'Client.View'],
    };
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');
    expect(navLabels(document.body)).toEqual(['My Work', 'Task Queue', 'Clients']);
    expect(document.body.textContent).not.toContain('Create task');
  });

  it('shows the Dashboard item only with Dashboard.View and a tab permission', async () => {
    configure('technician');
    const stub = TestBed.inject(MeApi) as StubMeApi;
    stub.scenarios['technician'] = {
      ...stub.scenarios['technician'],
      permissions: ['Task.View', 'Dashboard.View', 'Dashboard.ViewSwimlane'],
    };
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');
    expect(navLabels(document.body)).toEqual(['Dashboard', 'My Work', 'Task Queue']);
  });

  it('shows System Admin the Administration section', async () => {
    await open('admin');
    expect(document.body.textContent).toContain('Administration');
    expect(navLabels(document.body)).toContain('Audit Logs');
    expect(navLabels(document.body)).toContain('Users');
  });

  it('lists the Administration items at one level, without groups', async () => {
    await open('admin');
    expect(document.body.querySelector('.mf-nav-group-toggle')).toBeNull();
    const admin = document.body.querySelector('ul[aria-labelledby="mf-admin-heading"]')!;
    expect(Array.from(admin.querySelectorAll('li a')).map((a) => a.textContent!.trim())).toEqual([
      'Users',
      'Task Types',
      'Labels',
      'Asset Types',
      'Custom Fields',
      'Audit Logs',
    ]);
  });

  it('sends a user without the permission to the 403 page', async () => {
    const { router, harness } = await open('technician', '/admin/users');
    expect(router.url).toBe('/403');
    expect((harness.routeNativeElement as HTMLElement).textContent).toContain(
      "You don't have permission to view this.",
    );
  });

  it('renders the 404 page for unknown routes and the empty Dashboard', async () => {
    const { harness } = await open('technician', '/does-not-exist');
    expect(document.body.textContent).toContain("We couldn't find that.");
    await harness.navigateByUrl('/dashboard');
    expect(document.body.textContent).toContain('Dashboard');
  });
});
