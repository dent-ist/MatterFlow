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
import { CopyButton } from './copy-button';

/**
 * The one card of every system and not-found state (403, 404, the error page, Access Pending and a missing record; D-53, D-47, #1193):
 * a centred card 480 px wide (radius 12) with a 48 px icon tile, the title (the page's one H1, 22px / 700, one line), ONE sentence of
 * reason, an optional reference line (the address that was asked for, or the error reference: muted mono with a copy button) and ONE
 * button (the "Go to ..." link from the landing rule, or a button in the `mfPrimary` slot). The brand line sits under the card, outside it.
 * The title takes focus once on arrival (a link, a guard denial and a reload all land on it, so a screen reader reads it) and shows no
 * focus box (D-05).
 *
 *   <mf-state-page icon="pi pi-ban" heading="..." reason="..." [primary]="link" address="/admin/users"> <button mfPrimary>...</button> </mf-state-page>
 */
@Component({
  selector: 'mf-state-page',
  imports: [RouterLink, CopyButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sp" data-state-page>
      <span class="sp__tile" [class.sp__tile--error]="tone() === 'error'" aria-hidden="true">
        <i [class]="icon()"></i>
      </span>
      <h1 class="sp__title" data-page-title tabindex="-1">{{ heading() }}</h1>
      @if (reason()) {
        <p class="sp__reason" data-state-reason>{{ reason() }}</p>
      }
      @if (address()) {
        <p class="sp__ref" data-asked>
          <span>Asked for</span> <code data-asked-path>{{ address() }}</code>
          <mf-copy-button [text]="addressCopy() || address()" label="address" />
        </p>
      }
      <div class="sp__detail"><ng-content /></div>
      <div class="sp__actions" data-state-actions>
        @if (primary(); as l) {
          <a class="mf-btn mf-btn--primary" [routerLink]="l.path" data-back-link
            >Go to {{ l.name }}</a
          >
        }
        <ng-content select="[mfPrimary]" />
      </div>
    </section>
    @if (showBrand()) {
      <p class="sp__brand" data-state-brand>{{ brand.appName() }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: var(--mf-s6) 0;
    }
    .sp {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
      max-width: 480px;
      margin: 0 auto;
      padding: var(--mf-s5);
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-card);
      text-align: center;
    }
    .sp__tile {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--mf-s7);
      height: var(--mf-s7);
      margin-bottom: var(--mf-s3);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-primary);
      color: var(--mf-primary-contrast);
      font-size: var(--mf-icon-xl);
    }
    .sp__tile i {
      font-size: inherit;
    }
    .sp__tile--error {
      background: var(--mf-sem-overdue-solid);
    }
    .sp__title {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-h2);
      font-weight: 700;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    /* Focus arrives here from code (once, on arrival): a screen reader reads the title, no box is drawn (D-05). */
    .sp__title:focus,
    .sp__title:focus-visible {
      outline: none;
    }
    .sp__reason {
      margin: 0 0 var(--mf-s3);
      overflow-wrap: anywhere;
      color: var(--mf-text-muted);
    }
    .sp__ref {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: var(--mf-s1);
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .sp__ref code {
      font-family: var(--mf-font-mono);
      overflow-wrap: anywhere;
    }
    .sp__detail:empty {
      display: none;
    }
    .sp__detail {
      margin-bottom: var(--mf-s3);
      color: var(--mf-text-muted);
      overflow-wrap: anywhere;
    }
    .sp__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: var(--mf-s2);
      margin-top: var(--mf-s2);
    }
    .sp__brand {
      margin: var(--mf-s4) 0 0;
      overflow-wrap: anywhere; /* the administrator's application name, up to 40 characters */
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      text-align: center;
    }
  `,
})
export class StatePage {
  protected readonly brand = inject(BrandingService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => {
      if (!this.focusOnArrival()) return;
      this.host.nativeElement.querySelector<HTMLElement>('[data-page-title]')?.focus();
    });
  }

  readonly icon = input.required<string>();
  readonly heading = input.required<string>();
  readonly reason = input('');
  /** The tile colour: `error` for a failure (the error page), the primary colour for an answer (403, 404, pending). */
  readonly tone = input<'default' | 'error'>('default');
  /** The address that was asked for: muted mono with a copy button under the sentence (403, 404). */
  readonly address = input('');
  /** What the copy button puts on the clipboard when it differs from the shown address (the full URL). */
  readonly addressCopy = input('');
  /** The application name under the card (the route-level pages); a record's missing state inside the shell has none (D-47). */
  readonly showBrand = input(true);
  /** The title takes focus once on arrival; false where the owner of the page moves focus itself (`mf-record-state`). */
  readonly focusOnArrival = input(true);
  /** The "Go to ..." target from the landing rule; none shows no link (a link to a page that answers 403 is worse than none). */
  readonly primary = input<LandingLink | null>(null);
}
