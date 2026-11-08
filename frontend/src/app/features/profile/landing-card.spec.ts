import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { MyLandingPageDto } from '../../api/generated/api-client';
import { FakeMeApi, landingOf, profileOf, provideFakeMe } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { LandingApi } from '../../core/landing/landing-api';
import { NotificationService } from '../../core/notify/notification.service';
import { apiError, ok, settle } from '../../shared/testing/org-testing';
import { ddChoose, ddOptionTexts, ddText, ddValue } from '../../testing/dropdown-testing.spec-util';
import { LandingCard } from './landing-card';

const PAGES = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard' },
  { key: 'my-work', label: 'My Work', path: '/my-work' },
  { key: 'task-queue', label: 'Task Queue', path: '/tasks' },
];

describe('LandingCard (My Landing Page)', () => {
  let fixture: ComponentFixture<LandingCard>;
  let mine: ReturnType<typeof vi.fn>;
  let myPages: ReturnType<typeof vi.fn>;
  let setMine: ReturnType<typeof vi.fn>;
  const root = (): HTMLElement => fixture.nativeElement;
  const text = (sel: string): string | undefined =>
    root().querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();

  async function create(
    options: {
      answer?: MyLandingPageDto | Error;
      pages?: typeof PAGES;
      permissions?: string[];
      hasWork?: boolean;
    } = {},
  ): Promise<void> {
    mine = vi.fn(() =>
      options.answer instanceof Error
        ? apiError(500, { status: 500 })
        : ok(options.answer ?? landingOf()),
    );
    myPages = vi.fn(() => ok({ pages: options.pages ?? PAGES }));
    setMine = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(
          new FakeMeApi(
            profileOf({
              permissions: (options.permissions ?? ['Task.View']) as never,
              hasWork: options.hasWork ?? true,
              roles: ['Director'],
            }),
          ),
        ),
        { provide: LandingApi, useValue: { mine, myPages, setMine } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(LandingCard);
    await settle(fixture);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('is a card with the title, the description and one Landing Page field, "Use My Role\'s Default" first', async () => {
    await create();
    expect(text('h2')).toBe('My Landing Page');
    expect(text('.lc__help')).toBe(
      'The page you see first after signing in, and when you click the logo.',
    );
    expect(text('label[for="my-landing"]')).toBe('Landing Page');
    expect(ddText(root(), 'Landing Page')).toBe("Use My Role's Default");
    expect(ddOptionTexts(root(), 'Landing Page')).toEqual([
      "Use My Role's Default",
      'Dashboard',
      'My Work',
      'Task Queue',
    ]);
  });

  it('says where the person starts: role default, automatic, own choice', async () => {
    await create({
      answer: landingOf({
        roleName: 'Director',
        roleDefault: 'dashboard',
        resolved: 'dashboard',
        resolvedPath: '/dashboard',
        source: 'ROLE_DEFAULT',
      }),
    });
    expect(text('[data-landing-result]')).toBe(
      'You start on Dashboard. This is the default of your role, Director.',
    );
    TestBed.resetTestingModule();
    await create({ answer: landingOf({ roleName: 'Director' }), hasWork: true });
    expect(text('[data-landing-result]')).toBe(
      'Your role has no fixed landing page. You start on My Work, chosen automatically.',
    );
    TestBed.resetTestingModule();
    await create({
      answer: landingOf({
        choice: 'task-queue',
        resolved: 'task-queue',
        resolvedPath: '/tasks',
        source: 'CHOICE',
      }),
    });
    expect(text('[data-landing-result]')).toBe('You start on Task Queue.');
    expect(ddValue(root(), 'Landing Page')).toBe('task-queue');
  });

  it('a person with no role and no choice starts where the rule says, "chosen automatically"', async () => {
    await create({ answer: landingOf(), hasWork: false });
    expect(text('[data-landing-result]')).toBe('You start on Task Queue, chosen automatically.');
  });

  it('saves at once, toasts, updates the line and tells the rest of the app (the logo follows)', async () => {
    await create({ answer: landingOf({ roleName: 'Director' }) });
    const success = vi.spyOn(TestBed.inject(NotificationService), 'success');
    setMine.mockReturnValue(
      ok(
        landingOf({
          choice: 'my-work',
          resolved: 'my-work',
          resolvedPath: '/my-work',
          source: 'CHOICE',
        }),
      ),
    );
    ddChoose(root(), 'Landing Page', 'My Work');
    await settle(fixture);
    expect(setMine).toHaveBeenCalledWith('my-work');
    expect(success).toHaveBeenCalledWith(
      'Landing page saved',
      'You start on My Work after you sign in.',
    );
    expect(text('[data-landing-result]')).toBe('You start on My Work.');
    expect(TestBed.inject(AuthStore).landing()?.resolvedPath).toBe('/my-work');
    expect(root().querySelector('[data-landing-save-error]')).toBeNull();
  });

  it('choosing "Use My Role\'s Default" sends null and says which page the role gives', async () => {
    await create({
      answer: landingOf({
        choice: 'my-work',
        roleName: 'Director',
        roleDefault: 'dashboard',
        resolved: 'my-work',
        resolvedPath: '/my-work',
        source: 'CHOICE',
      }),
    });
    const success = vi.spyOn(TestBed.inject(NotificationService), 'success');
    setMine.mockReturnValue(
      ok(
        landingOf({
          roleName: 'Director',
          roleDefault: 'dashboard',
          resolved: 'dashboard',
          resolvedPath: '/dashboard',
          source: 'ROLE_DEFAULT',
        }),
      ),
    );
    ddChoose(root(), 'Landing Page', "Use My Role's Default");
    await settle(fixture);
    expect(setMine).toHaveBeenCalledWith(null);
    expect(success).toHaveBeenCalledWith(
      'Landing page saved',
      'You start on Dashboard, the default of your role.',
    );
  });

  it('disables the field and says "Saving..." while the request runs', async () => {
    await create();
    const gate = new Subject<MyLandingPageDto>();
    setMine.mockReturnValue(gate);
    ddChoose(root(), 'Landing Page', 'Dashboard');
    await settle(fixture);
    expect(root().querySelector<HTMLButtonElement>('#my-landing')!.disabled).toBe(true);
    expect(text('[data-landing-result]')).toBe('Saving...');
    gate.next(
      landingOf({
        choice: 'dashboard',
        resolved: 'dashboard',
        resolvedPath: '/dashboard',
        source: 'CHOICE',
      }),
    );
    gate.complete();
    await settle(fixture);
    expect(root().querySelector<HTMLButtonElement>('#my-landing')!.disabled).toBe(false);
  });

  it('a failed save puts the earlier value back and says why inline, no toast', async () => {
    await create({
      answer: landingOf({
        choice: 'my-work',
        resolved: 'my-work',
        resolvedPath: '/my-work',
        source: 'CHOICE',
      }),
    });
    const success = vi.spyOn(TestBed.inject(NotificationService), 'success');
    const error = vi.spyOn(TestBed.inject(NotificationService), 'error');
    setMine.mockReturnValue(apiError(400, { status: 400, detail: 'Unknown page.' }));
    ddChoose(root(), 'Landing Page', 'Dashboard');
    await settle(fixture);
    expect(ddValue(root(), 'Landing Page')).toBe('my-work');
    expect(text('[data-landing-save-error]')).toContain("Couldn't save your landing page.");
    expect(root().querySelector('[data-landing-save-error]')!.getAttribute('role')).toBe('alert');
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('a stored choice that is no longer allowed: amber banner, "<page> (not available)", kept, not in the list', async () => {
    await create({
      answer: landingOf({
        choice: 'pod-work',
        choiceAllowed: false,
        roleName: 'Director',
        roleDefault: 'dashboard',
        resolved: 'dashboard',
        resolvedPath: '/dashboard',
        source: 'ROLE_DEFAULT',
      }),
    });
    const banner = root().querySelector('[data-landing-banner]')!;
    expect(banner.classList.contains('pg-banner')).toBe(true);
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Pod Work is no longer available to you, so you start on Dashboard. Your choice is kept in case access comes back.',
    );
    expect(ddText(root(), 'Landing Page')).toBe('Pod Work (not available)');
    expect(ddOptionTexts(root(), 'Landing Page')).not.toContain('Pod Work');
  });

  it('choosing another value replaces the stale one and the banner goes away', async () => {
    await create({
      answer: landingOf({
        choice: 'pod-work',
        choiceAllowed: false,
        resolved: undefined,
        source: undefined,
      }),
    });
    expect(root().querySelector('[data-landing-banner]')).not.toBeNull();
    setMine.mockReturnValue(
      ok(
        landingOf({
          choice: 'my-work',
          resolved: 'my-work',
          resolvedPath: '/my-work',
          source: 'CHOICE',
        }),
      ),
    );
    ddChoose(root(), 'Landing Page', 'My Work');
    await settle(fixture);
    expect(root().querySelector('[data-landing-banner]')).toBeNull();
    expect(ddText(root(), 'Landing Page')).toBe('My Work');
  });

  it('a failed load says so inside the card with Retry (no toast), and Retry loads again', async () => {
    await create({ answer: new Error('x') });
    expect(text('[data-landing-load-error]')).toContain("Couldn't load your landing page.");
    mine.mockReturnValue(ok(landingOf()));
    root().querySelector<HTMLButtonElement>('[data-landing-retry]')!.click();
    await settle(fixture);
    expect(root().querySelector('#my-landing')).not.toBeNull();
  });

  it("shows the card's final layout while loading", async () => {
    mine = vi.fn(() => new Subject<MyLandingPageDto>());
    myPages = vi.fn(() => ok({ pages: PAGES }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(profileOf({ permissions: ['Task.View'] }))),
        { provide: LandingApi, useValue: { mine, myPages } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(LandingCard);
    await settle(fixture);
    expect(text('h2')).toBe('My Landing Page');
    expect(root().querySelector('[data-landing-loading]')!.getAttribute('aria-busy')).toBe('true');
  });

  it('is not shown for a person who can open no page', async () => {
    await create({ pages: [] });
    expect(root().querySelector('[data-landing-card]')).toBeNull();
  });
});
