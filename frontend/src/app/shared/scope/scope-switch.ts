import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { Segmented } from '../ui/segmented';
import { Scope } from './scope.service';

/** Zero-width space: a live region only speaks when its text changes, so the same message alternates with this. */
const NUDGE = String.fromCharCode(0x200b);

/**
 * The "My matters | All" switch (epic #758, PX-13): the shared segmented toggle (`mfSegmented`, issue #919: `aria-pressed`, one Tab stop, arrow keys, 44 px targets on touch, a check mark on the pressed button, never colour alone). Put it in the page header's actions (`mfActions`). It draws nothing unless "All" is
 * offered (`canAll`): a project manager who may not see all matters has nothing to switch, the count line says what the list shows.
 * A polite live region announces a change the person made ("Showing matters you manage" / "Showing all matters").
 *
 *   <mf-scope-switch mfActions [scope]="scope.value()" [canAll]="scope.canAll()" (scopeChange)="scope.set($event)" />
 */
@Component({
  selector: 'mf-scope-switch',
  imports: [Segmented],
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
      max-width: 100%;
    }
    @media (max-width: 639.98px) {
      :host {
        display: flex;
        flex: 1 1 100%;
      }
      .ss {
        display: flex;
        width: 100%;
      }
      .ss .mf-btn {
        flex: 1 1 0;
      }
    }
  `,
  template: `
    @if (visible()) {
      <div
        mfSegmented
        class="ss"
        role="group"
        aria-label="Scope"
        data-scope-switch
        [attr.title]="description() || null"
      >
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
  /** What the shown scope means: the switch's tooltip (a page with no sentence under its title says it here). */
  readonly description = input('');
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
