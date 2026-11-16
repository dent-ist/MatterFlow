import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { LOOKUP_UNAVAILABLE } from '../../features/admin/settings/integrations/integration-text';
import { Tip } from '../ui/tip';
import { MatterLookup } from './matter-lookup';

/** A sentence under the field after a Lookup: it filled the form, found nothing, or did not work. */
export interface LookupMessage {
  readonly kind: 'ok' | 'info' | 'error';
  readonly text: string;
}

/**
 * The Lookup button (`mf-lookup-button`, #1395, docs/ux/design-guidelines.md "Lookup button"): a secondary 36 px button with the search icon, placed after the field it fills (the field's
 * `mfFieldAction` slot). Four states. Ready: it asks the Matter Lookup integration. Not set up, turned off or failing: the button stays in place, `aria-disabled` with a tooltip that says why
 * and who can fix it (it stays a Tab stop so the keyboard reaches the tooltip). `needs` is the other reason it cannot run yet ("Enter a client number first."). It never blocks the form.
 */
@Component({
  selector: 'mf-lookup-button',
  imports: [Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="mf-btn"
      data-lookup
      [attr.aria-disabled]="off() ? 'true' : null"
      [mfTip]="tip()"
      (click)="onClick()"
    >
      <i class="pi pi-search" aria-hidden="true"></i>
      {{ busy() ? 'Looking up...' : 'Lookup' }}
    </button>
  `,
})
export class LookupButton {
  private readonly matterLookup = inject(MatterLookup);
  /** True while a lookup runs. */
  readonly busy = input(false);
  /** Why the button cannot run yet even though Lookup is ready ("Enter a client number first."); empty when it can. */
  readonly needs = input('');
  /** The person pressed Lookup while it can run. */
  readonly lookup = output<void>();

  private readonly unavailable = computed(
    () => LOOKUP_UNAVAILABLE[this.matterLookup.state()] ?? null,
  );
  protected readonly off = computed(
    () =>
      this.busy() ||
      this.unavailable() !== null ||
      this.matterLookup.state() === 'unknown' ||
      this.needs() !== '',
  );
  protected readonly tip = computed(() => this.unavailable()?.tip ?? (this.needs() || null));

  protected onClick(): void {
    if (!this.off()) this.lookup.emit();
  }
}

/**
 * What stands under the field the Lookup button belongs to (`mf-lookup-note`): when Lookup is not set up, turned off or failing, the sentence "Lookup isn't available yet. Enter the details
 * yourself." (everyone), plus the text button "Open Integrations" for an administrator (`Integrations.Manage`); after a lookup, its result (`message`). Polite live region.
 */
@Component({
  selector: 'mf-lookup-note',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .ln {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s3);
      margin: var(--mf-s1) 0 0;
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .ln--error {
      color: var(--mf-sem-overdue-fg);
    }
    .ln .pi {
      font-size: var(--mf-icon-sm);
    }
  `,
  template: `
    <div aria-live="polite" data-lookup-note>
      @if (unavailable(); as u) {
        <p class="ln" data-lookup-unavailable>
          <span><i class="pi pi-info-circle" aria-hidden="true"></i> {{ u.sentence }}</span>
          @if (isAdmin()) {
            <a
              class="mf-link"
              routerLink="/admin/settings"
              [queryParams]="{ tab: 'integrations' }"
              data-open-integrations
              >Open Integrations</a
            >
          }
        </p>
      } @else if (message(); as m) {
        <p
          class="ln"
          [class.ln--error]="m.kind === 'error'"
          data-lookup-message
          [attr.data-kind]="m.kind"
        >
          <span
            ><i
              class="pi"
              [class]="
                m.kind === 'error'
                  ? 'pi-exclamation-circle'
                  : m.kind === 'ok'
                    ? 'pi-check-circle'
                    : 'pi-info-circle'
              "
              aria-hidden="true"
            ></i>
            {{ m.text }}</span
          >
          @if (m.kind === 'error') {
            <button
              type="button"
              class="mf-btn mf-btn--text"
              data-lookup-retry
              (click)="retry.emit()"
            >
              Retry
            </button>
          }
        </p>
      }
    </div>
  `,
})
export class LookupNote {
  private readonly matterLookup = inject(MatterLookup);
  private readonly auth = inject(AuthStore);
  /** The result of the last lookup, or null. */
  readonly message = input<LookupMessage | null>(null);
  readonly retry = output<void>();
  protected readonly unavailable = computed(
    () => LOOKUP_UNAVAILABLE[this.matterLookup.state()] ?? null,
  );
  protected readonly isAdmin = computed(() => this.auth.has('Integrations.Manage'));
}
