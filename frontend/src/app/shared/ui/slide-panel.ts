import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  model,
  output,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { DialogFocus } from './dialog-focus';
import { ScrollRegion } from './scroll-region';

let nextPanel = 0;

/**
 * The one right-hand drawer of the app (D-33, #1142; epic #1001, MD-01). Width is set by this component only: `--mf-drawer-w` (520 px) by default, `size="large"`
 * is `--mf-drawer-w-wide` (720 px, for a drawer that holds a grid); nobody passes a width. The anatomy, from top to bottom:
 *
 *   header   56 px: the title 16 / 600 with an optional subtitle 13 muted, then the icon actions (the host puts `mf-btn mf-btn--icon` buttons or links in the
 *            `[mfDrawerActions]` slot: 18 px icon, 36 px target, tooltip and name), then the grey 36 x 36 close icon button (the same as a dialog's)
 *   tabs     a tab strip (`mf-tabs`) in the `[mfDrawerTabs]` slot sits under the header and does not scroll
 *   body     scrolls inside (named and focusable while it overflows when `scrollLabel` is set)
 *   footer   only for a drawer that edits (`showFooter`): `[Cancel] ... [Primary]`; `customFooter` projects the host's own buttons (`[mfDrawerFooter]`)
 *
 * The title is the drawer's top heading (`h2`, under the page `h1`); the sections inside a drawer are `h3` and below, one level at a time (axe heading-order, #1294).
 *
 * It is an accessible modal dialog (PrimeNG `p-dialog`, docked right): Esc and a click on the scrim close it, Tab stays inside, focus moves to the first field
 * (or the close button, `initialFocus`) when it opens and returns to the control that opened it when it closes; the page stays visible behind the scrim.
 * While `dirty` is set, Esc, the scrim, the X and Cancel do not close it at once: a "Discard changes?" bar asks first (Keep Editing / Discard Changes).
 * A host that asks its own question (`hostClosing`) gets `(closeRequest)` instead and closes the panel itself. `busy` disables the actions and shows
 * "Saving..."; `error` shows a message in the footer (`role="alert"`). The page owns the form and the save: it listens to `(submitted)` and closes the panel
 * with `visible.set(false)` when the save worked. Put an `@if` around a form in the host so it is created only while the panel is open.
 *
 * ```html
 * <mf-slide-panel title="Person" subtitle="Test User" closeLabel="Close person details" [showFooter]="false" [(visible)]="open">
 *   <a mfDrawerActions class="mf-btn mf-btn--icon" ...><i class="pi pi-list"></i></a>
 *   (an `mf-tabs` strip carrying the `mfDrawerTabs` attribute goes here)
 *   ...body...
 * </mf-slide-panel>
 * ```
 */
@Component({
  selector: 'mf-slide-panel',
  imports: [Dialog, Button, DialogFocus, ScrollRegion],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './slide-panel.scss',
  encapsulation: ViewEncapsulation.None,
  template: `
    <p-dialog
      position="right"
      [styleClass]="frameClass()"
      [maskStyleClass]="maskClass()"
      [modal]="true"
      [closable]="false"
      [dismissableMask]="!dirty() && !hostClosing()"
      [closeOnEscape]="false"
      [mfDialogFocus]="visible()"
      [focusOnShow]="false"
      (onShow)="shown()"
      [draggable]="false"
      [resizable]="false"
      [visible]="visible()"
      (visibleChange)="onVisible($event)"
    >
      <ng-template #header let-labelId="ariaLabelledBy">
        <span class="sp__head">
          <h2
            class="sp__title"
            data-panel-title
            data-drawer-title
            data-panel-heading
            tabindex="-1"
            [id]="labelId"
            [attr.title]="title()"
            [textContent]="title()"
          ></h2>
          @if (subtitle()) {
            <span class="sp__sub">{{ subtitle() }}</span>
          }
        </span>
        <span class="sp__actions"><ng-content select="[mfDrawerActions]" /></span>
        <button
          type="button"
          class="mf-dlg__x"
          data-panel-close
          [attr.aria-label]="closeLabel() || 'Close ' + title()"
          (click)="requestClose()"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </ng-template>
      @if (visible()) {
        <div class="sp__tabs"><ng-content select="[mfDrawerTabs]" /></div>
        <div class="sp__body" data-panel-body [mfScrollRegion]="scrollLabel()">
          <ng-content />
        </div>
      }
      @if (showFooter()) {
        <ng-template #footer>
          <div class="sp__foot" data-panel-footer>
            @if (error()) {
              <p class="sp__error" role="alert" data-panel-error>
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i>{{ error() }}
              </p>
            }
            @if (guard()) {
              <div
                class="sp__guard"
                role="alertdialog"
                aria-label="Discard changes?"
                data-panel-guard
              >
                <span>You have unsaved changes. Discard them?</span>
                <span class="sp__guard-actions">
                  <p-button
                    label="Keep Editing"
                    severity="secondary"
                    data-guard-keep
                    (onClick)="guard.set(false)"
                  />
                  <p-button
                    label="Discard Changes"
                    severity="danger"
                    data-guard-discard
                    (onClick)="close()"
                  />
                </span>
              </div>
            }
            @if (customFooter()) {
              <div class="sp__buttons"><ng-content select="[mfDrawerFooter]" /></div>
            } @else {
              <div class="sp__buttons">
                <p-button
                  [label]="secondaryLabel()"
                  severity="secondary"
                  data-panel-cancel
                  (onClick)="requestClose()"
                />
                <p-button
                  [label]="busy() ? 'Saving...' : primaryLabel()"
                  [styleClass]="busy() ? 'sp__busy' : ''"
                  [attr.aria-disabled]="!canSubmit() || busy() ? 'true' : null"
                  data-panel-primary
                  (onClick)="canSubmit() && !busy() && submitted.emit()"
                />
              </div>
            }
          </div>
        </ng-template>
      }
    </p-dialog>
  `,
})
export class SlidePanel {
  readonly title = input.required<string>();
  /** A quiet line under the title (the CM number). */
  readonly subtitle = input('');
  /** `default` 520 px; `large` 720 px for a drawer that holds a grid. The width belongs to this component (`slide-panel.scss`). */
  readonly size = input<'default' | 'large'>('default');
  readonly primaryLabel = input('Save');
  readonly secondaryLabel = input('Cancel');
  /** The save runs: the primary button says "Saving..." and ignores clicks (it stays focusable). */
  readonly busy = input(false);
  /** Why the save failed; shown in the footer and announced. */
  readonly error = input('');
  /** Unsaved changes: closing asks before it discards. */
  readonly dirty = input(false);
  /** False while the form is invalid; the primary button is `aria-disabled` and does nothing. */
  readonly canSubmit = input(true);
  /** False for a panel that has no footer (a read-only drawer closes with the X). */
  readonly showFooter = input(true);
  /** The footer holds the host's own buttons (`[mfDrawerFooter]`, Cancel first) instead of Cancel and the primary. */
  readonly customFooter = input(false);
  /** The accessible name of the close button when "Close <title>" does not fit ("Close person details"). */
  readonly closeLabel = input('');
  /** Names the scrolling body as a focusable region while it overflows (axe scrollable-region-focusable): "Activity". Empty: not a region. */
  readonly scrollLabel = input('');
  /** Extra class on the panel for the host's own selectors (`mf-users-drawer`); it never sets a size. */
  readonly panelClass = input('');
  /** Extra class on the scrim (the Users drawer follows the visual viewport). */
  readonly maskClass = input('');
  /** Where focus goes when the panel opens: the first field (default; the close button when there is none), the close button, or nowhere (`(opened)` places it). */
  readonly initialFocus = input<'field' | 'close' | 'none'>('field');
  /** The host asks its own question before closing: the X, Esc, the scrim and Cancel emit `closeRequest` and the host sets `visible` to false. */
  readonly hostClosing = input(false);

  readonly visible = model(false);
  readonly submitted = output<void>();
  readonly cancelled = output<void>();
  /** The panel finished opening (and, with `initialFocus`, took focus). */
  readonly opened = output<void>();
  /** `hostClosing`: the person asked to close. */
  readonly closeRequest = output<void>();

  private readonly uid = `mf-slide-${nextPanel++}`;
  protected readonly guard = signal(false);
  protected readonly frameClass = computed(
    () =>
      `mf-drawer mf-slide ${this.uid}${this.size() === 'large' ? ' mf-drawer--wide' : ''}${this.panelClass() ? ' ' + this.panelClass() : ''}`,
  );

  protected onVisible(v: boolean): void {
    if (v) return;
    this.requestClose();
  }

  /** The X, Cancel: asks first while there are unsaved changes. */
  protected requestClose(): void {
    if (this.hostClosing()) {
      this.closeRequest.emit();
      return;
    }
    if (this.dirty()) {
      this.guard.set(true);
      return;
    }
    this.close();
  }

  protected close(): void {
    this.guard.set(false);
    if (this.visible()) {
      this.visible.set(false);
      this.cancelled.emit();
    }
  }

  /**
   * Esc closes the panel, or asks first while there are unsaved changes (PrimeNG's own Esc handling is off). A key that an open dropdown or menu inside the panel used
   * to close its own list is left alone, and so is a key meant for a dialog opened above the panel (the dialog with the higher stacking order closes first).
   */
  @HostListener('document:keydown.escape', ['$event'])
  protected onEscape(e: Event): void {
    if (!this.visible() || e.defaultPrevented) return;
    const mine = document.querySelector<HTMLElement>(`.${this.uid}`)?.closest('.p-dialog-mask');
    if (!mine) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target?.closest('[role=listbox], [role=menu], .dd-panel')) return;
    const z = (el: Element): number => Number(getComputedStyle(el).zIndex) || 0;
    if (
      Array.from(document.querySelectorAll('.p-dialog-mask')).some(
        (m) => m !== mine && z(m) > z(mine),
      )
    ) {
      return;
    }
    this.requestClose();
  }

  /** A click on the scrim while there are unsaved changes asks as well. */
  @HostListener('document:click', ['$event'])
  protected onDocClick(e: Event): void {
    const t = e.target;
    if (
      this.visible() &&
      this.dirty() &&
      !this.hostClosing() &&
      t instanceof HTMLElement &&
      t.classList.contains('p-dialog-mask') &&
      t.querySelector(`.${this.uid}`)
    ) {
      this.guard.set(true);
    }
  }

  /** Focus goes to the first field, or to the close button when the panel has none. */
  protected shown(): void {
    const root = document.querySelector<HTMLElement>(`.${this.uid}`);
    const close = root?.querySelector<HTMLElement>('[data-panel-close]');
    const mode = this.initialFocus();
    if (mode === 'close') {
      close?.focus();
    } else if (mode === 'field') {
      const field = root?.querySelector<HTMLElement>(
        '[data-panel-body] input:not([type=hidden]):not([disabled]), [data-panel-body] select:not([disabled]), [data-panel-body] textarea:not([disabled]), [data-panel-body] [tabindex="0"]',
      );
      (field ?? close)?.focus();
    }
    this.opened.emit();
  }
}
