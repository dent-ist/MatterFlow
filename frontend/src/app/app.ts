import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Type,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Toast } from 'primeng/toast';
import { LeaveConfirmService } from './shared/guards/unsaved-changes.guard';
import { DevAuthBanner } from './shared/layout/dev-auth-banner';
import { ToastNoAutofocus } from './shared/ui/toast-no-autofocus';
import { UndoToast } from './shared/ui/undo-toast';

/** Root: dev-auth banner (stub provider only), routed content, global toast host and the lazy "Leave without saving?" dialog. */
@Component({
  selector: 'mf-root',
  imports: [RouterOutlet, Toast, DevAuthBanner, NgComponentOutlet, UndoToast, ToastNoAutofocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-dev-auth-banner />
    <router-outlet />
    <p-toast position="bottom-right" mfToastNoAutofocus />
    <mf-undo-toast />
    @if (leaveHost(); as host) {
      <ng-container *ngComponentOutlet="host" />
    }
  `,
})
export class App {
  private readonly leaveConfirm = inject(LeaveConfirmService);
  protected readonly leaveHost = signal<Type<unknown> | null>(null);

  constructor() {
    // The dialog (PrimeNG dialog + button) loads the first time a screen asks to be left.
    effect(() => {
      if (!this.leaveConfirm.open() || untracked(this.leaveHost)) return;
      void import('./shared/guards/leave-confirm-host').then((m) =>
        this.leaveHost.set(m.LeaveConfirmHost),
      );
    });
  }
}
