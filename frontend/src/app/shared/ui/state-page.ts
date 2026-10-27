import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { BrandingService } from '../../core/branding/branding.service';
import { LandingLink } from '../../core/auth/guards';
import { TitleIcon } from './page-header';

/**
 * The one card of the route-level state pages (403, 404 and the error page; S10, #607; mock `docs/ux/shell-review/mocks/mock-nav-and-system.png`):
 * a centred card with the icon and the title (22px / 700, 18px below 640px, the page-header numbers), one sentence of reason, the address that
 * was asked for in monospace (project it as the default content), the primary action ("Go to ..." from the landing rule, or a button in the
 * `mfPrimary` slot) and one secondary action in the `mfSecondary` slot (Search on a 404, Copy link on a 403, Try again on the error page).
 * The brand line sits under the card, outside it. The card has no illustration and never touches the page edges. The title is the page's
 * one H1 and takes focus once on arrival (S12, #610: a link, a guard denial and a reload all land on it, so a screen reader reads it; nothing else
 * moves, and Back restores the rules of the page it returns to).
 *
 *   <mf-state-page icon="pi pi-ban" heading="..." reason="..." [primary]="link"> <p>You asked for ...</p> <button mfSecondary>...</button> </mf-state-page>
 */
@Component({
  selector: 'mf-state-page',
  imports: [RouterLink, TitleIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sp" data-state-page>
      <h1 class="sp__title" data-page-title tabindex="-1">
        <mf-title-icon [icon]="icon()" />{{ heading() }}
      </h1>
      <p class="sp__reason" data-state-reason>{{ reason() }}</p>
      <div class="sp__detail"><ng-content /></div>
      <div class="sp__actions" data-state-actions>
        @if (primary(); as l) {
          <a class="mf-btn mf-btn--primary" [routerLink]="l.path" data-back-link
            >Go to {{ l.name }}</a
          >
        }
        <ng-content select="[mfPrimary]" />
        <div class="sp__secondary" data-state-secondary><ng-content select="[mfSecondary]" /></div>
      </div>
    </section>
    <p class="sp__brand" data-state-brand>{{ brand.appName() }}</p>
  `,
  styles: `
    :host {
      display: block;
      padding: var(--mf-s6) 0;
    }
    .sp {
      box-sizing: border-box;
      width: 100%;
      max-width: 32rem;
      margin: 0 auto;
      padding: var(--mf-s5) var(--mf-s5);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
    }
    .sp__title {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-h2);
      font-weight: 700;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    @media (max-width: 639.98px) {
      .sp__title {
        font-size: var(--mf-fs-h3);
      }
      .sp {
        padding: var(--mf-s4);
      }
      :host {
        padding-top: var(--mf-s3);
      }
    }
    .sp__reason {
      margin: 0 0 var(--mf-s3);
      overflow-wrap: anywhere;
      color: var(--mf-text-muted);
    }
    .sp__detail:empty {
      display: none;
    }
    .sp__detail {
      margin-bottom: var(--mf-s3);
    }
    .sp__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
      margin-top: var(--mf-s4);
    }
    .sp__secondary {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .sp__secondary:empty {
      display: none;
    }
    .sp__brand {
      margin: var(--mf-s4) 0 0;
      overflow-wrap: anywhere; /* the administrator's application name, up to 40 characters */
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      letter-spacing: 0.02em;
      text-align: center;
    }
  `,
})
export class StatePage {
  protected readonly brand = inject(BrandingService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() =>
      this.host.nativeElement.querySelector<HTMLElement>('[data-page-title]')?.focus(),
    );
  }

  readonly icon = input.required<string>();
  readonly heading = input.required<string>();
  readonly reason = input('');
  /** The "Go to ..." target from the landing rule; none shows no link (a link to a page that answers 403 is worse than none). */
  readonly primary = input<LandingLink | null>(null);
}
