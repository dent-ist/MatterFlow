import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';

/** Thin toast facade (UX `mf-toast`); the `<p-toast>` host lives in the app shell. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly messages = inject(MessageService);

  success(summary: string, detail?: string): void {
    this.messages.add({ severity: 'success', summary, detail, life: 4000 });
  }

  info(summary: string, detail?: string): void {
    this.messages.add({ severity: 'info', summary, detail, life: 4000 });
  }

  error(summary: string, detail?: string): void {
    this.messages.add({ severity: 'error', summary, detail, life: 8000 });
  }
}
