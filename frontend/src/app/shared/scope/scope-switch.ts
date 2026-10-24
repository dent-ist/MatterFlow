import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { Scope } from './scope.service';

/** Zero-width space: a live region only speaks when its text changes, so the same message alternates with this. */
const NUDGE = String.fromCharCode(0x200b);

/**
 * The "My matters | All" switch (epic #758, PX-13): a two-button toggle group (`aria-pressed`), 44 px targets on touch, the state in words
 * and in a bold pressed button, never in colour alone. Put it in the page header's actions (`mfActions`). It draws nothing unless "All" is
 * offered (`canAll`): a project manager who may not see all matters has nothing to switch, the count line says what the list shows.
 * A polite live region announces a change the person made ("Showing matters you manage" / "Showing all matters").
 *
 *   <mf-scope-switch mfActions [scope]="scope.value()" [canAll]="scope.canAll()" (scopeChange)="scope.set($event)" />
 */
@Component({
  selector: 'mf-scope-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-ph-selector': '' },
  styles: `
    :host {
      display: inline-flex;
    }
    :host(:empty) {
      display: none;
    }
    .ss {
      display: inline-flex;
      max-width: 100%;
    }
    .ss .mf-btn[aria-pressed='true'] {
      border-color: var(--mf-primary);
      background: var(--mf-selected-bg);
      font-weight: 700;
    }
    .ss .mf-btn:first-child {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }
    .ss .mf-btn:last-child {
      margin-left: -1px;
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
    }
    @media (max-width: 639.98px) {
      :host {
        display: flex;
        flex: 1 1 100%;
      }
      .ss {
        width: 100%;
      }
      .ss .mf-btn {
        flex: 1 1 0;
        justify-content: center;
        min-height: 44px;
      }
    }
    @media (pointer: coarse) {
      .ss .mf-btn {
        min-height: 44px;
      }
    }
  `,
  template: `
    @if (visible()) {
      <div class="ss" role="group" aria-label="Scope" data-scope-switch>
        <button
          type="button"
          class="mf-btn"
          data-scope="mine"
          [attr.aria-pressed]="scope() === 'mine'"
          (click)="pick('mine')"
        >
          My matters
        </button>
        <button
          type="button"
          class="mf-btn"
          data-scope="all"
          [attr.aria-pressed]="scope() === 'all'"
          (click)="pick('all')"
        >
          {{ allLabel() }}
        </button>
      </div>
      <span class="mf-sr-only" role="status" aria-live="polite" data-scope-live>{{
        announcement()
      }}</span>
    }
  `,
})
export class ScopeSwitch {
  /** The scope in force; null when the switch does not apply. */
  readonly scope = input<Scope | null>(null);
  /** "All" is offered (Matter.AssignManagers). */
  readonly canAll = input(false);
  /** The second button's text. */
  readonly allLabel = input('All');
  /** The live region's text after a change by the person. */
  readonly announceMine = input('Showing matters you manage');
  readonly announceAll = input('Showing all matters');
  readonly scopeChange = output<Scope>();

  protected readonly announcement = signal('');
  private flip = false;

  protected visible(): boolean {
    return this.scope() !== null && this.canAll();
  }

  protected pick(scope: Scope): void {
    if (scope === this.scope()) return;
    // A live region only speaks when its text changes, so the same message alternates with a zero-width space.
    const text = scope === 'mine' ? this.announceMine() : this.announceAll();
    this.flip = !this.flip;
    this.announcement.set(this.flip ? text : `${text}${NUDGE}`);
    this.scopeChange.emit(scope);
  }
}
