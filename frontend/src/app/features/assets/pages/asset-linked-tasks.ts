import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { AssetTaskLink, AssetsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { ErrorReference } from '../../../shared/ui/error-reference';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * The Linked Tasks tab of an Asset (UX S08): every Task the Asset is linked to with its number, title, status and the role of the link,
 * newest link first. Needs `Task.View` (the asset endpoint itself needs `Asset.View`). Rendered only while its tab is open.
 */
@Component({
  selector: 'mf-asset-linked-tasks',
  imports: [ErrorReference, RouterLink, Button, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    @if (!canView()) {
      <div class="pg-state" data-no-access="linked-tasks">
        You don't have permission to view tasks.
      </div>
    } @else {
      @switch (state()) {
        @case ('loading') {
          <div class="pg-state" role="status" aria-busy="true" data-loading>
            Loading linked tasks...
          </div>
        }
        @case ('error') {
          <div class="pg-alert" role="alert" data-error>
            We couldn't load the linked tasks.
            <mf-error-reference />
            <p-button label="Retry" severity="secondary" (onClick)="load()" />
          </div>
        }
        @default {
          @if (links().length === 0) {
            <div class="pg-state" data-empty="linked-tasks">
              No tasks are linked to this asset yet.
            </div>
          } @else {
            <table class="pg-table">
              <caption class="pg-sr">
                Tasks linked to this asset
              </caption>
              <thead>
                <tr>
                  <th scope="col">Ref</th>
                  <th scope="col">Title</th>
                  <th scope="col">Status</th>
                  <th scope="col">Role</th>
                </tr>
              </thead>
              <tbody>
                @for (t of links(); track t.taskId) {
                  <tr [attr.data-task]="t.taskNumber">
                    <td class="pg-mono">{{ t.taskNumber }}</td>
                    <td>
                      <a class="pg-link" [routerLink]="['/tasks', t.taskId]">{{ t.title }}</a>
                    </td>
                    <td><mf-status-badge [code]="t.statusCode" /></td>
                    <td>{{ t.assetLinkRoleName ?? '-' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        }
      }
    }
  `,
})
export class AssetLinkedTasks {
  readonly assetId = input.required<number>();

  private readonly api = inject(AssetsClient);
  private readonly auth = inject(AuthStore);

  protected readonly canView = computed(() => this.auth.has('Task.View'));
  protected readonly state = signal<LoadState>('loading');
  protected readonly links = signal<AssetTaskLink[]>([]);

  constructor() {
    effect(() => {
      this.assetId();
      untracked(() => {
        if (this.canView()) void this.load();
      });
    });
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const result = await firstValueFrom(this.api.listAssetLinkedTasks(this.assetId()));
      this.links.set(result.items);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }
}
