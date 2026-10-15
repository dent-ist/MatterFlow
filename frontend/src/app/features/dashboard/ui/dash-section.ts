import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DashboardPrefs, SectionKey } from '../dashboard-prefs';

let nextId = 0;

/**
 * A titled block of the Dashboard. When given a `key` it can be collapsed with a Show / Hide button (`aria-expanded`); the choice is
 * remembered per user in this browser (`DashboardPrefs`). Without a key (Department, Needs attention) it always stays open.
 */
@Component({
  selector: 'mf-dash-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sec" [attr.aria-labelledby]="id" [attr.data-section]="name()">
      <div class="head">
        <h2 [id]="id">{{ heading() }}</h2>
        <ng-content select="[mfSectionActions]" />
        @if (key(); as k) {
          <button
            type="button"
            class="toggle"
            data-section-toggle
            [attr.aria-expanded]="!collapsed()"
            [attr.aria-controls]="id + '-body'"
            (click)="prefs.toggle(k)"
          >
            <i
              class="pi"
              [class]="collapsed() ? 'pi-chevron-right' : 'pi-chevron-down'"
              aria-hidden="true"
            ></i>
            {{ collapsed() ? 'Show' : 'Hide' }}<span class="sr-only"> {{ heading() }}</span>
          </button>
        }
      </div>
      @if (!collapsed()) {
        <div [id]="id + '-body'" class="body"><ng-content /></div>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s5);
    }
    .head {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: var(--mf-s2) var(--mf-s4);
      margin-bottom: var(--mf-s3);
    }
    h2 {
      margin: 0;
      margin-right: auto;
      font-size: var(--mf-fs-h3);
    }
    .toggle {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 0;
      background: none;
      border: 0;
      color: var(--mf-link);
      font: inherit;
      font-size: var(--mf-fs-sm);
      cursor: pointer;
    }
    .toggle:hover {
      text-decoration: underline;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class DashSection {
  protected readonly prefs = inject(DashboardPrefs);
  protected readonly id = `mf-sec-${nextId++}`;

  readonly heading = input.required<string>();
  /** Value of `data-section` (a stable hook for tests). */
  readonly name = input<string | null>(null);
  /** Makes the section collapsible and names the saved choice. */
  readonly key = input<SectionKey | null>(null);
  protected readonly collapsed = computed(() => {
    const k = this.key();
    return k !== null && this.prefs.collapsed().has(k);
  });
}
