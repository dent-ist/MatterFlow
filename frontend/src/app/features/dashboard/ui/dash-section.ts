import { ChangeDetectionStrategy, Component, input } from '@angular/core';

let nextId = 0;

/**
 * A titled block of a Dashboard tab: a labelled region with an H2 and an optional slot for actions (a link, the period control) beside
 * the heading.
 */
@Component({
  selector: 'mf-dash-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sec" [attr.aria-labelledby]="id" [attr.data-section]="name()">
      <div class="head">
        <h2 [id]="id" tabindex="-1" data-skip-target>{{ heading() }}</h2>
        <ng-content select="[mfSectionActions]" />
      </div>
      <div class="body"><ng-content /></div>
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
    h2:focus {
      outline: none;
    }
    h2:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    h2 {
      margin: 0;
      margin-right: auto;
      font-size: var(--mf-fs-h3);
    }
  `,
})
export class DashSection {
  protected readonly id = `mf-sec-${nextId++}`;

  readonly heading = input.required<string>();
  /** Value of `data-section` (a stable hook for tests). */
  readonly name = input<string | null>(null);
}
