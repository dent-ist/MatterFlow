import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DashScope, SCOPE_PARAM } from '../dash-scope';

let nextId = 0;

/**
 * The one Scope control of the Dashboard (UX review 2, P1): "Scope: All pods / My pods / a Pod" at the right end of the tab row, left of Refresh,
 * on every tab. The scope in effect is always text in the control. A choice is in effect at once, written to the address (`?pod=`; the default is
 * left out), remembered per user, and announced by the page (`scopeChange` carries the text for its polite live region). Own Pods come first;
 * the other Pods are listed only for people who may see them.
 */
@Component({
  selector: 'mf-dash-scope',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc" data-dash-scope>
      <label class="sc-lbl" [for]="id">Scope</label>
      <select
        class="mf-control mf-control--compact"
        data-scope
        [id]="id"
        [value]="scope.scope()"
        (change)="onSelect($any($event.target).value)"
      >
        @for (o of general(); track o.value) {
          <option [value]="o.value" [selected]="o.value === scope.scope()">{{ o.label }}</option>
        }
        @if (mine().length > 0) {
          <optgroup label="My pods">
            @for (o of mine(); track o.value) {
              <option [value]="o.value" [selected]="o.value === scope.scope()">
                {{ o.label }}
              </option>
            }
          </optgroup>
        }
        @if (other().length > 0) {
          <optgroup label="Other pods">
            @for (o of other(); track o.value) {
              <option [value]="o.value" [selected]="o.value === scope.scope()">
                {{ o.label }}
              </option>
            }
          </optgroup>
        }
      </select>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .sc {
      display: flex;
      max-width: 22rem;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .sc-lbl {
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
      white-space: nowrap;
    }
    select {
      min-height: 2rem;
      max-width: 14rem;
      min-width: 0;
    }
    @media (max-width: 480px) {
      select {
        max-width: 8.5rem;
      }
    }
  `,
})
export class ScopeControl {
  protected readonly scope = inject(DashScope);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly id = `mf-scope-${nextId++}`;
  protected readonly general = computed(() =>
    this.scope.options().filter((o) => o.group === 'general'),
  );
  protected readonly mine = computed(() => this.scope.options().filter((o) => o.group === 'mine'));
  protected readonly other = computed(() =>
    this.scope.options().filter((o) => o.group === 'other'),
  );

  /** The text for the page's live region after a change ("Scope: Review Alpha"). */
  readonly scopeChange = output<string>();

  protected onSelect(value: string): void {
    if (value === this.scope.scope() || !this.scope.isValid(value)) return;
    this.scope.choose(value);
    this.scopeChange.emit(`Scope: ${this.scope.labelOf(value)}`);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [SCOPE_PARAM]: this.scope.addressValue(value), upod: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
