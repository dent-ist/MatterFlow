import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TabView } from './users-model';

/**
 * Workload | Coverage as two text toggle buttons (U2, #128). A group of buttons with `aria-pressed`, not a second tablist (the tab row above is
 * the page's tablist). The tab renders it only when the person may open Coverage, so a Pod Lead without `Dashboard.ViewCoverage` sees no switch.
 * It is the first control of the toolbar on both views.
 */
@Component({
  selector: 'mf-users-views',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="views" role="group" aria-label="Users view" data-users-views>
      @for (v of views; track v.key) {
        <button
          type="button"
          class="seg"
          [attr.data-view]="v.key"
          [attr.aria-pressed]="view() === v.key"
          [attr.title]="v.title"
          (click)="viewChange.emit(v.key)"
        >
          {{ v.label }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: inline-block;
    }
    .views {
      display: inline-flex;
      box-sizing: border-box;
      height: 32px;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      overflow: hidden;
      background: var(--mf-surface);
    }
    .seg {
      min-width: 5.5rem;
      padding: 0 var(--mf-s3);
      color: var(--mf-text);
      background: transparent;
      border: 0;
      font: inherit;
      font-size: var(--mf-fs-md);
      cursor: pointer;
    }
    .seg + .seg {
      border-left: 1px solid var(--mf-border-strong);
    }
    .seg:hover {
      background: var(--mf-surface-alt);
    }
    .seg[aria-pressed='true'] {
      color: var(--mf-primary);
      background: var(--mf-selected-bg);
      font-weight: 600;
      box-shadow: inset 0 -2px 0 var(--mf-primary);
    }
    .seg:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
  `,
})
export class UsersViews {
  readonly view = input.required<TabView>();
  readonly viewChange = output<TabView>();

  protected readonly views: { key: TabView; label: string; title: string }[] = [
    { key: 'workload', label: 'Workload', title: 'Workload: who has room and what is open' },
    {
      key: 'coverage',
      label: 'Coverage',
      title: 'Coverage: task types each person has completed',
    },
  ];
}
