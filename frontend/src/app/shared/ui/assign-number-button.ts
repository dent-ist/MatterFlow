import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssetResponse, AssetsClient } from '../../api/generated/api-client';
import { ApiError } from '../../core/http/api-error';
import { NotificationService } from '../../core/notify/notification.service';

/**
 * "Assign Number" (#1297, spec 3.2): the one explicit way an old asset of a numbered type gets its number (never silently on an edit). The caller shows it only with
 * `Asset.Edit` for an asset whose type numbers its assets and that has no number. Success toasts the number and hands over the new asset; a stale row version or an
 * asset that was numbered meanwhile asks the caller to reload (`stale`); any other refusal is a toast.
 */
@Component({
  selector: 'mf-assign-number-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="mf-btn mf-btn--text"
      [disabled]="busy()"
      (click)="assign()"
      data-assign-number
    >
      Assign Number
    </button>
  `,
})
export class AssignNumberButton {
  readonly assetId = input.required<number>();
  readonly rowVersion = input.required<string>();
  readonly assigned = output<AssetResponse>();
  readonly stale = output<void>();

  private readonly api = inject(AssetsClient);
  private readonly notify = inject(NotificationService);
  protected readonly busy = signal(false);

  protected async assign(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const asset = await firstValueFrom(
        this.api.assignAssetNumber(this.assetId(), { rowVersion: this.rowVersion() }),
      );
      this.notify.success('Asset number assigned', asset.assetNumber ?? undefined);
      this.assigned.emit(asset);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === 'CONCURRENCY_CONFLICT' || code === 'ASSET_ALREADY_NUMBERED') {
        if (e instanceof Error) this.notify.error('Couldn’t assign a number.', e.message);
        this.stale.emit();
      } else {
        this.notify.error('Couldn’t assign a number.', e instanceof Error ? e.message : undefined);
      }
    } finally {
      this.busy.set(false);
    }
  }
}
