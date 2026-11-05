import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Dismissable } from '../../../shared/ui/dismissable';
import { CapacityPerson } from '../../../api/generated/api-client';
import { groupPeople, personDetail } from './capacity-model';
import { IntPipe } from '../../../shared/ui/number-format';

let nextId = 0;

/**
 * The People popover of the capacity battery (epic #1063, DB-05): everyone the battery counts (up to 200), grouped by state, searchable and scrollable. The list is read
 * only when the popover opens (the parent does that); the search is a client filter. It is a dialog with a labelled search box: Esc closes it and returns focus to the People
 * button, a press or focus move outside closes it (the shared popover rule), Tab stays among its controls.
 */
@Component({
  selector: 'mf-dash-people',
  imports: [IntPipe, Dismissable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #panel
      class="pop"
      role="dialog"
      aria-modal="false"
      [attr.aria-labelledby]="uid + '-h'"
      data-people
      [mfDismissable]="trigger()"
      (dismissed)="closed.emit()"
      (keydown.tab)="trap($event, false)"
      (keydown.shift.tab)="trap($event, true)"
    >
      <div class="head">
        <h3 [id]="uid + '-h'">People ({{ people().length }})</h3>
        <button
          type="button"
          class="mf-btn mf-btn--icon"
          aria-label="Close people list"
          data-people-close
          (click)="closed.emit(); trigger()?.focus()"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </div>
      <label class="sr-only" [for]="uid + '-q'">Search people</label>
      <input
        #search
        class="mf-control q"
        type="search"
        autocomplete="off"
        placeholder="Search people"
        [id]="uid + '-q'"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
        data-people-search
      />
      <p class="sr-only" role="status" aria-live="polite" data-people-count>
        {{ shownCount() | mfInt }} {{ shownCount() === 1 ? 'person' : 'people' }} shown
      </p>
      <div class="list" tabindex="0" role="region" aria-label="People by state, scrollable">
        @for (g of groups(); track g.state) {
          <section [attr.data-group]="g.state">
            <h4>
              <i class="pi" [class]="g.icon" aria-hidden="true"></i>{{ g.label }} ({{
                g.people.length
              }})
            </h4>
            <ul>
              @for (p of g.people; track p.userId) {
                <li data-person>
                  <span class="name">{{ p.displayName }}</span>
                  <span class="detail">{{ detail(p) }}</span>
                </li>
              }
            </ul>
          </section>
        } @empty {
          <p class="none" data-people-none>No one matches "{{ query() }}".</p>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
    .pop {
      position: absolute;
      top: 44px;
      right: var(--mf-s3);
      left: var(--mf-s3);
      z-index: 20;
      display: flex;
      max-height: 340px;
      flex-direction: column;
      gap: var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      box-shadow: var(--mf-shadow-pop);
      font-size: 13px;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    h3 {
      margin: 0;
      font-size: 14px;
    }
    .q {
      width: 100%;
    }
    .list {
      min-height: 0;
      flex: 1 1 auto;
      overflow: auto;
      overscroll-behavior: contain;
    }
    .list:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    h4 {
      display: flex;
      align-items: center;
      gap: var(--mf-s1);
      margin: var(--mf-s2) 0 var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: 12px;
      font-weight: 700;
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      justify-content: space-between;
      gap: var(--mf-s3);
      padding: 3px 0;
      border-bottom: 1px solid var(--mf-border-soft);
    }
    .detail {
      color: var(--mf-text-muted);
      white-space: nowrap;
    }
    .none {
      margin: var(--mf-s3) 0;
      color: var(--mf-text-muted);
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
export class DashPeople {
  /** Everyone the battery counts (the People endpoint's answer, at most 200). */
  readonly people = input.required<readonly CapacityPerson[]>();
  /** The People button that opened this: Esc gives it focus back. */
  readonly trigger = input<HTMLElement | null>(null);
  readonly closed = output<void>();

  protected readonly uid = `dash-people-${nextId++}`;
  protected readonly query = signal('');
  protected readonly groups = computed(() => groupPeople(this.people(), this.query()));
  protected readonly shownCount = computed(() =>
    this.groups().reduce((n, g) => n + g.people.length, 0),
  );
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly search = viewChild.required<ElementRef<HTMLInputElement>>('search');
  protected readonly detail = personDetail;

  constructor() {
    afterNextRender(() => this.search().nativeElement.focus());
  }

  /** Tab stays inside the popover: past the last control it wraps to the first, and back. */
  protected trap(event: Event, back: boolean): void {
    const items = Array.from(
      this.panel().nativeElement.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]'),
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (back && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!back && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
