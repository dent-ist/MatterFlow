import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../../core/auth/auth.store';
import { landingLink } from '../../core/auth/guards';
import { ApiError } from '../../core/http/api-error';
import { retryWhenBackOnline } from '../../core/http/connectivity';
import { QuietRequests } from '../../core/http/interceptors';
import {
  LandingApi,
  LandingPageListResponse,
  MyLandingPageDto,
} from '../../core/landing/landing-api';
import { landingLabel } from '../../core/landing/landing-pages';
import { NotificationService } from '../../core/notify/notification.service';
import { Dropdown, DropdownItem } from '../../shared/ui/dropdown';

/** The stored value of "Use My Role's Default" (the empty choice). */
const ROLE_DEFAULT = '';
/** A value no option has: the dropdown then shows its placeholder ("Pod Work (not available)"). */
const GONE = '__gone';

/**
 * The "My Landing Page" card of My Profile (epic #1330, UI spec section 4): the page the person sees first after signing in and when they click
 * the logo. One dropdown, "Use My Role's Default" first, then the pages the person can open now; the choice saves at once (toast "Landing
 * page saved"), and a live line always says where they will land. A stored choice that is no longer allowed is kept: the trigger reads
 * "<page> (not available)" and an amber banner says where they start instead. Loading shows the card's final layout; a failed load or save is
 * said inside the card (no toast, D-51).
 */
@Component({
  selector: 'mf-landing-card',
  imports: [Dropdown],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './landing-card.scss',
  template: `
    @if (state() !== 'empty') {
      <section class="lc mf-card" aria-labelledby="lc-title" data-landing-card>
        <h2 class="lc__title mf-card__title" id="lc-title">My Landing Page</h2>
        <p class="lc__help" id="lc-help">
          The page you see first after signing in, and when you click the logo.
        </p>
        @switch (state()) {
          @case ('error') {
            <p class="lc__muted" role="alert" data-landing-load-error>
              Couldn't load your landing page.
              <button type="button" class="mf-btn mf-btn--text" data-landing-retry (click)="load()">
                Retry
              </button>
            </p>
          }
          @case ('ready') {
            @if (banner(); as text) {
              <p class="pg-banner" role="status" data-landing-banner>
                <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                <span>{{ text }}</span>
              </p>
            }
            <div class="lc__field">
              <label for="my-landing" class="mf-label">Landing Page</label>
              @for (round of [rounds()]; track round) {
                <mf-dropdown
                  field
                  fill
                  buttonId="my-landing"
                  label="Landing Page"
                  [placeholder]="placeholder()"
                  [items]="items()"
                  [value]="shown()"
                  [disabled]="busy()"
                  [describedBy]="'lc-result'"
                  (valueChange)="choose($event)"
                />
              }
            </div>
            @if (saveError(); as reason) {
              <p class="lc__error mf-form-error" role="alert" data-landing-save-error>
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                <span>Couldn't save your landing page. {{ reason }}</span>
              </p>
            }
            <p class="lc__result" id="lc-result" aria-live="polite" data-landing-result>
              @if (busy()) {
                <span class="lc__muted">Saving...</span>
              } @else {
                {{ result() }}
              }
            </p>
          }
          @default {
            <div class="lc__skeleton" aria-busy="true" data-landing-loading>
              <span class="lc__bar lc__bar--label"></span>
              <span class="lc__bar lc__bar--field"></span>
              <span class="lc__bar lc__bar--line"></span>
              <span class="mf-sr-only" role="status">Loading your landing page</span>
            </div>
          }
        }
      </section>
    }
  `,
})
export class LandingCard {
  private readonly api = inject(LandingApi);
  private readonly auth = inject(AuthStore);
  private readonly quiet = inject(QuietRequests);
  private readonly notify = inject(NotificationService);
  private readonly injector = inject(Injector);

  /** `empty`: the person can open no page, so the card is not shown at all. */
  protected readonly state = signal<'loading' | 'ready' | 'error' | 'empty'>('loading');
  private readonly mine = signal<MyLandingPageDto | null>(null);
  private readonly pages = signal<LandingPageListResponse['pages']>([]);
  protected readonly busy = signal(false);
  /** Bumped when a save fails: the dropdown is drawn again with the earlier value. */
  protected readonly rounds = signal(0);
  protected readonly saveError = signal('');
  /** The value the dropdown shows ('' = Use My Role's Default). */
  protected readonly value = signal(ROLE_DEFAULT);

  /** The stored choice, or null. */
  private readonly choice = computed(() => this.mine()?.choice ?? null);
  /** The stored choice is a page the person cannot open any more. */
  protected readonly gone = computed(() => !!this.choice() && this.mine()?.choiceAllowed === false);

  protected readonly items = computed<DropdownItem[]>(() => [
    { value: ROLE_DEFAULT, label: "Use My Role's Default" },
    ...this.pages().map((p) => ({ value: p.key, label: p.label })),
  ]);
  /** A page that is no longer allowed is not in the list: the trigger shows it through the placeholder. */
  protected readonly shown = computed(() =>
    this.gone() && this.value() === this.choice() ? GONE : this.value(),
  );
  protected readonly placeholder = computed(() =>
    this.gone() ? `${this.nameOf(this.choice())} (not available)` : "Use My Role's Default",
  );

  /** Where the person starts when nothing fixed applies: what today's rule picks (the server said `resolved` null). */
  private readonly automaticName = computed(() => landingLink(this.auth)?.name ?? 'My Work');

  /** The page the person actually starts on, by name. */
  private readonly startName = computed(() => {
    const resolved = landingLabel(this.mine()?.resolved);
    return resolved ?? this.automaticName();
  });

  protected readonly banner = computed(() =>
    this.gone()
      ? `${this.nameOf(this.choice())} is no longer available to you, so you start on ${this.startName()}. Your choice is kept in case access comes back.`
      : '',
  );

  protected readonly result = computed(() => {
    const mine = this.mine();
    if (!mine) return '';
    const resolved = landingLabel(mine.resolved);
    if (mine.source === 'CHOICE' && resolved) return `You start on ${resolved}.`;
    if (mine.source === 'ROLE_DEFAULT' && resolved && mine.roleName) {
      return `You start on ${resolved}. This is the default of your role, ${mine.roleName}.`;
    }
    return mine.roleName
      ? `Your role has no fixed landing page. You start on ${this.automaticName()}, chosen automatically.`
      : `You start on ${this.automaticName()}, chosen automatically.`;
  });

  constructor() {
    void this.load();
    retryWhenBackOnline(
      () => this.state() === 'error',
      () => void this.load(),
    );
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      const [mine, pages] = await this.quiet.run(() =>
        Promise.all([firstValueFrom(this.api.mine()), firstValueFrom(this.api.myPages())]),
      );
      this.pages.set(pages.pages);
      this.apply(mine);
      this.state.set(pages.pages.length === 0 ? 'empty' : 'ready');
    } catch {
      this.state.set('error');
    }
  }

  private apply(mine: MyLandingPageDto): void {
    this.mine.set(mine);
    this.value.set(mine.choice ?? ROLE_DEFAULT);
    // The logo and the next redirect follow the same answer.
    this.auth.setLanding(mine);
  }

  private nameOf(key: string | null): string {
    return landingLabel(key) ?? key ?? '';
  }

  /** Saves at once. The dropdown is disabled while the request runs; a failed save puts the earlier value back and says why inline. */
  protected async choose(next: string): Promise<void> {
    if (next === GONE || this.busy()) return;
    const previous = this.mine()?.choice ?? ROLE_DEFAULT;
    if (next === previous && !this.gone()) return;
    this.saveError.set('');
    this.value.set(next);
    this.busy.set(true);
    try {
      const saved = await this.quiet.run(() =>
        firstValueFrom(this.api.setMine(next === ROLE_DEFAULT ? null : next)),
      );
      this.busy.set(false);
      this.apply(saved);
      this.notify.success('Landing page saved', this.savedDetail(saved));
    } catch (err) {
      this.busy.set(false);
      this.value.set(previous);
      this.rounds.update((n) => n + 1);
      this.saveError.set(err instanceof ApiError ? err.message : 'Try again.');
    }
    // The disabled dropdown took the focus with it: it gets it back once it can.
    afterNextRender(() => document.getElementById('my-landing')?.focus(), {
      injector: this.injector,
    });
  }

  private savedDetail(saved: MyLandingPageDto): string {
    const resolved = landingLabel(saved.resolved);
    if (saved.source === 'CHOICE' && resolved) return `You start on ${resolved} after you sign in.`;
    if (saved.source === 'ROLE_DEFAULT' && resolved) {
      return `You start on ${resolved}, the default of your role.`;
    }
    return `You start on ${this.automaticName()}, chosen automatically.`;
  }
}
