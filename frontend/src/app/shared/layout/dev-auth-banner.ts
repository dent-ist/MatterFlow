import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { MeApi } from '../../core/auth/me-api';
import { StubMeApi } from '../../core/auth/stub-me-api';

/** Non-production banner: "Dev auth: acting as <user> [switch]" (UX 5.1). Only with the stub provider. */
@Component({
  selector: 'mf-dev-auth-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (stub(); as s) {
      <div class="mf-dev-banner" role="region" aria-label="Development authentication">
        <span>Dev auth: acting as {{ auth.displayName() || 'nobody' }}</span>
        <label>
          Switch user
          <select (change)="switchTo($any($event.target).value)" [value]="s.scenario()">
            @for (opt of options; track opt.id) {
              <option [value]="opt.id" [selected]="opt.id === s.scenario()">{{ opt.label }}</option>
            }
          </select>
        </label>
      </div>
    }
  `,
  styles: `
    .mf-dev-banner {
      display: flex;
      gap: var(--mf-s4);
      align-items: center;
      justify-content: center;
      padding: var(--mf-s1) var(--mf-s4);
      background: var(--mf-warning-bg);
      color: var(--mf-warning);
      font-size: var(--mf-fs-sm);
    }
    select {
      margin-left: var(--mf-s2);
      font: inherit;
    }
  `,
})
export class DevAuthBanner {
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly api = inject(MeApi);

  protected readonly stub = computed(() => (this.api instanceof StubMeApi ? this.api : null));
  protected readonly options = Object.entries(
    (this.api instanceof StubMeApi ? this.api.scenarios : {}) as Record<string, { label: string }>,
  ).map(([id, s]) => ({ id, label: s.label }));

  protected async switchTo(id: string): Promise<void> {
    const stub = this.stub();
    if (!stub) return;
    stub.setScenario(id);
    await this.auth.refresh();
    await this.router.navigateByUrl('/', { onSameUrlNavigation: 'reload' });
  }
}
