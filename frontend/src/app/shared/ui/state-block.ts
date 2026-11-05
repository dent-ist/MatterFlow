import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The one calm block of every empty, error and no-access state (D-51, #1145): a 24 px icon (muted; the error icon in `--mf-sem-overdue-solid`), ONE sentence with
 * a full stop (the projected text), an optional second line (`mfStateReason`: the reason or the error reference) and an optional action (`mfStateAction`,
 * a Title Case button: "+ New Task", "Clear Filters", a secondary "Retry"). It is centred in the room it is given; `fill` also centres it vertically in a
 * card or panel that is taller than the block (Notifications). Wording: "No tasks yet." (with a New button only when the person may create one), "No tasks
 * match these filters." + Clear Filters, "No results for "text".", "No tasks." (read only), "Couldn't load tasks." + Retry.
 *
 *   <mf-state-block>No clients yet.<p-button mfStateAction label="+ New Client" /></mf-state-block>
 *   <mf-state-block kind="error">Couldn't load clients.<mf-error-reference mfStateReason /><p-button mfStateAction label="Retry" severity="secondary" /></mf-state-block>
 */
@Component({
  selector: 'mf-state-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.sb--fill]': 'fill()' },
  template: `
    <div
      class="sb"
      [class.sb--error]="kind() === 'error'"
      [attr.role]="alert() ? 'alert' : null"
      [attr.data-state-block]="kind()"
    >
      <i class="pi sb__mark" [class]="glyph()" aria-hidden="true"></i>
      <p class="sb__text"><ng-content /></p>
      <div class="sb__reason"><ng-content select="[mfStateReason]" /></div>
      <div class="sb__act"><ng-content select="[mfStateAction]" /></div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    :host(.sb--fill) {
      height: 100%;
    }
    .sb {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--mf-s2);
      box-sizing: border-box;
      min-height: 100%;
      padding: var(--mf-s5);
      text-align: center;
    }
    .sb__mark {
      /* D-51: 24 px. There is no 24 px icon token yet (the scale stops at --mf-icon-lg 20), so the 24 px spacing step carries it. */
      font-size: var(--mf-s5);
      color: var(--mf-text-muted);
    }
    .sb--error .sb__mark {
      color: var(--mf-sem-overdue-solid);
    }
    .sb__text {
      max-width: 40rem;
      margin: 0;
      color: var(--mf-text);
      overflow-wrap: anywhere;
    }
    .sb__reason {
      max-width: 40rem;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      overflow-wrap: anywhere;
    }
    .sb__text:empty,
    .sb__reason:empty,
    .sb__act:empty {
      display: none;
    }
    .sb__act {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--mf-s2);
      margin-top: var(--mf-s1);
    }
  `,
})
export class StateBlock {
  /** `empty` (nothing here, no access) or `error` (a load failed: red triangle, announced as an alert). */
  readonly kind = input<'empty' | 'error'>('empty');
  /** A PrimeIcons class; the default is `pi-inbox` (empty) or `pi-exclamation-triangle` (error). */
  readonly icon = input('');
  /** Announce the block as an alert (default: errors only). */
  readonly announce = input<boolean | null>(null);
  /** Centre the block vertically in a taller card or panel. */
  readonly fill = input(false);

  protected readonly glyph = computed(
    () => this.icon() || (this.kind() === 'error' ? 'pi-exclamation-triangle' : 'pi-inbox'),
  );
  protected readonly alert = computed(() => this.announce() ?? this.kind() === 'error');
}
