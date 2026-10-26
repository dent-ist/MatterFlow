import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  NotificationPreferenceItem,
  NotificationPreferencesClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { retryWhenBackOnline } from '../../core/http/connectivity';
import { QuietRequests } from '../../core/http/interceptors';

interface Group {
  key: string;
  heading: string;
  items: readonly NotificationPreferenceItem[];
}

const HEADINGS: Record<string, string> = {
  Technician: 'Technician',
  ProjectManager: 'Project manager',
  PodLead: 'Pod Lead',
};

/**
 * The "Notifications" section of My profile (NT-D5, #749, README 4.5): one switch per event type, all on by default, saved at once with a
 * polite "Saved.", reverted with an inline message when the save fails (no toast). Groups for a role the person does not hold sit under
 * "Other events" so no switch is ever out of reach. Switches change future notifications only; nothing is sent by email.
 */
@Component({
  selector: 'mf-notification-preferences',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="np" aria-labelledby="np-heading" data-notification-preferences>
      <h2 class="np__title" id="np-heading">Notifications</h2>
      <p class="np__help">
        Choose which events create a notification for you. Notifications appear in the bell; nothing
        is sent by email. A change applies to future notifications only: existing ones stay, and
        turning a switch on does not bring back earlier ones.
      </p>
      <div
        class="mf-sr-only"
        role="status"
        aria-live="polite"
        data-prefs-status
        [textContent]="status()"
      ></div>
      @if (error(); as message) {
        <p class="np__error" role="alert" data-prefs-error>{{ message }}</p>
      }
      @switch (state()) {
        @case ('error') {
          <p class="np__muted" data-prefs-load-error>
            Couldn't load your notification settings.
            <button type="button" class="mf-btn mf-btn--text" data-prefs-retry (click)="load()">
              Retry
            </button>
          </p>
        }
        @case ('ready') {
          @for (group of mine(); track group.key) {
            <ng-container *ngTemplateOutlet="groupTpl; context: { $implicit: group }" />
          }
          @if (others().length > 0) {
            <details class="np__other" data-prefs-other>
              <summary>Other events</summary>
              <p class="np__muted">
                For roles you do not hold today. They are on by default, so you are covered if that
                changes.
              </p>
              @for (group of others(); track group.key) {
                <ng-container *ngTemplateOutlet="groupTpl; context: { $implicit: group }" />
              }
            </details>
          }
        }
        @default {
          <p class="np__muted" data-prefs-loading>Loading...</p>
        }
      }
    </section>

    <ng-template #groupTpl let-group>
      <fieldset class="np__group" [attr.data-prefs-group]="group.key">
        <legend class="np__legend">{{ group.heading }}</legend>
        @for (item of group.items; track item.eventType) {
          <label class="np__switch">
            <input
              type="checkbox"
              role="switch"
              [attr.data-event]="item.eventType"
              [checked]="item.enabled"
              (change)="toggle(item, $any($event.target))"
            />
            <span>{{ item.label }}</span>
          </label>
        }
      </fieldset>
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }
    /* One card style on My profile (#529): the bordered 8 px card of the Account card. */
    .np {
      padding: var(--mf-s4) var(--mf-s5);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
    }
    .np__title {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-h3);
    }
    .np__help,
    .np__muted {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
    }
    .np__error {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-danger);
    }
    .np__group {
      margin: 0 0 var(--mf-s3);
      padding: 0;
      border: 0;
    }
    .np__legend {
      padding: 0;
      margin-bottom: var(--mf-s1);
      font-weight: 700;
    }
    .np__switch {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 44px;
    }
    .np__other summary {
      min-height: 32px;
      cursor: pointer;
      font-weight: 600;
    }
  `,
  imports: [NgTemplateOutlet],
})
export class NotificationPreferences {
  private readonly client = inject(NotificationPreferencesClient);
  private readonly quiet = inject(QuietRequests);
  private readonly auth = inject(AuthStore);

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly items = signal<readonly NotificationPreferenceItem[]>([]);
  protected readonly status = signal('');
  protected readonly error = signal('');

  private readonly groups = computed<Group[]>(() => {
    const out: Group[] = [];
    for (const item of this.items()) {
      let g = out.find((x) => x.key === item.group);
      if (!g) {
        g = { key: item.group, heading: HEADINGS[item.group] ?? item.group, items: [] };
        out.push(g);
      }
      (g.items as NotificationPreferenceItem[]).push(item);
    }
    return out;
  });
  /** Roles the person holds: a Project manager can be named a matter's manager; Pod leads are approximated by the Pod permissions. */
  private readonly held = computed(() => {
    const keys = new Set(['Technician']);
    if (this.auth.has('Matter.BeManager')) keys.add('ProjectManager');
    if (this.auth.has('Pod.ManageMembers') || this.auth.has('Pod.Manage')) keys.add('PodLead');
    return keys;
  });
  protected readonly mine = computed(() => this.groups().filter((g) => this.held().has(g.key)));
  protected readonly others = computed(() => this.groups().filter((g) => !this.held().has(g.key)));

  constructor() {
    void this.load();
    retryWhenBackOnline(
      () => this.state() === 'error',
      () => void this.load(),
    );
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      const res = await this.quiet.run(() =>
        firstValueFrom(this.client.getNotificationPreferences()),
      );
      this.items.set(res.items);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  /** Saves at once. The switch shows the new value straight away; a failed save puts it back and says so inline. */
  protected async toggle(item: NotificationPreferenceItem, input: HTMLInputElement): Promise<void> {
    const enabled = input.checked;
    this.error.set('');
    this.status.set('');
    this.set(item.eventType, enabled);
    try {
      await this.quiet.run(() =>
        firstValueFrom(
          this.client.updateNotificationPreferences({
            items: [{ eventType: item.eventType, enabled }],
          }),
        ),
      );
      this.status.set('Saved.');
    } catch {
      this.set(item.eventType, !enabled);
      // The binding may not have changed between the two sets, so put the control back by hand.
      input.checked = !enabled;
      this.error.set(
        `Couldn't save "${item.label}". The switch is back to its earlier setting. Try again.`,
      );
    }
  }

  private set(eventType: string, enabled: boolean): void {
    this.items.update((list) =>
      list.map((i) => (i.eventType === eventType ? { ...i, enabled } : i)),
    );
  }
}
