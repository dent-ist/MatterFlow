import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Segmented } from '../../../shared/ui/segmented';
import { TabView } from './users-model';

/**
 * Workload | Coverage | Skills as text toggle buttons (U2, #128). A group of buttons with `aria-pressed`, not a second tablist (the tab row above is
 * the page's tablist). The tab renders it only when the person may open Coverage, so a Pod Lead without `Dashboard.ViewCoverage` sees no switch.
 * It is the first control of the toolbar on both views.
 */
@Component({
  selector: 'mf-users-views',
  imports: [Segmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div mfSegmented role="group" aria-label="Users view" data-users-views>
      @for (v of shown(); track v.key) {
        <button
          type="button"
          class="mf-btn"
          [attr.data-view]="v.key"
          [attr.aria-pressed]="view() === v.key"
          [attr.title]="v.title"
          (click)="viewChange.emit(v.key)"
        >
          <i class="pi" [class]="v.icon" aria-hidden="true"></i>
          <span class="t">{{ v.label }}</span>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: inline-block;
    }
    /* The three buttons are exactly the same width (wide enough for the longest label with its icon), so the switch never changes size. */
    .mf-btn {
      flex: 0 0 8.75rem;
      min-width: 8.75rem;
      justify-content: center;
    }
    /* The same themed switch on all three views; on a small phone the words give way to the icons (the title and the accessible name keep them). */
    @media (max-width: 420px) {
      .mf-btn {
        flex-basis: 2.75rem;
        min-width: 2.75rem;
      }
      .t {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
    }
  `,
})
export class UsersViews {
  readonly view = input.required<TabView>();
  /** Coverage needs Dashboard.ViewCoverage; Skills needs only Dashboard.ViewUsers (the tab's own permission). */
  readonly coverage = input(true);
  protected readonly shown = computed(() =>
    this.views.filter((v) => v.key !== 'coverage' || this.coverage()),
  );
  readonly viewChange = output<TabView>();

  protected readonly views: { key: TabView; label: string; title: string; icon: string }[] = [
    {
      key: 'workload',
      label: 'Workload',
      icon: 'pi-chart-bar',
      title: 'Workload: who has room and what is open',
    },
    {
      key: 'coverage',
      label: 'Coverage',
      icon: 'pi-th-large',
      title: 'Coverage: task types each person has completed',
    },
    {
      key: 'skills',
      label: 'Skills',
      icon: 'pi-star',
      title: 'Skills and training: completed tasks by person and task type, and thin cover',
    },
  ];
}
