import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Tone of a workflow version status: Draft amber, Published green, Retired grey. */
export function workflowStatusTone(status: string | null | undefined): BadgeTone {
  switch (status?.toLowerCase()) {
    case 'published':
      return 'success';
    case 'draft':
      return 'warning';
    default:
      return 'neutral';
  }
}

/**
 * One badge family (UXR-15, UXR-27): a tone (colour pair from the design tokens, all at least 4.5:1) plus an optional icon.
 * Lifecycle task status and priority keep their own components (`mf-status-badge`, `mf-priority-badge`) and look the same.
 * Never rely on colour alone: the text always states the meaning.
 *
 *   <mf-badge tone="success" icon="pi-check-circle">Active</mf-badge>
 */
@Component({
  selector: 'mf-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="badge" [attr.data-tone]="tone()" [attr.aria-describedby]="describedBy()">
      @if (icon()) {
        <i class="pi" [class]="icon()" aria-hidden="true"></i>
      }
      <ng-content />
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      vertical-align: middle;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 2px var(--mf-s2);
      border: 1px solid currentColor;
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      line-height: 1.5;
      white-space: nowrap;
    }
    .pi {
      font-size: var(--mf-fs-xs);
    }
    [data-tone='neutral'] {
      background: var(--mf-st-cancel-bg);
      color: var(--mf-st-cancel-fg);
    }
    [data-tone='info'] {
      background: var(--mf-info-bg);
      color: var(--mf-info);
    }
    [data-tone='success'] {
      background: var(--mf-success-bg);
      color: var(--mf-success);
    }
    [data-tone='warning'] {
      background: var(--mf-warning-bg);
      color: var(--mf-warning);
    }
    [data-tone='danger'] {
      background: var(--mf-danger-bg);
      color: var(--mf-danger);
    }
  `,
})
export class Badge {
  readonly tone = input<BadgeTone>('neutral');
  /** PrimeIcons class, for example `pi-check-circle`. */
  readonly icon = input<string | null>(null);
  /** The id of an element that describes this badge (read out once with it). */
  readonly describedBy = input<string | null>(null);
}

/** Active / Inactive state of a record (clients, matters, assets, steps...): green with a check, or grey. */
@Component({
  selector: 'mf-active-badge',
  imports: [Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-badge [tone]="tone()" [icon]="icon()">{{ label() }}</mf-badge>`,
})
export class ActiveBadge {
  readonly active = input.required<boolean | null | undefined>();
  /** Overrides the words, for example `Archived` for a project. */
  readonly activeLabel = input('Active');
  readonly inactiveLabel = input('Inactive');

  protected readonly tone = computed<BadgeTone>(() => (this.active() ? 'success' : 'neutral'));
  protected readonly icon = computed(() => (this.active() ? 'pi-check-circle' : 'pi-minus-circle'));
  protected readonly label = computed(() =>
    this.active() ? this.activeLabel() : this.inactiveLabel(),
  );
}

/** The Sensitive-matter marker (addendum O): amber with a lock. */
@Component({
  selector: 'mf-sensitive-badge',
  imports: [Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-badge
    tone="warning"
    icon="pi-lock"
    title="Sensitive matter"
    [describedBy]="describedBy()"
    ><span [class.mf-sr-only]="compact()">Sensitive</span></mf-badge
  >`,
})
export class SensitiveBadge {
  /** The lock alone, with the word for assistive technology and the tooltip: for a name cell that has no room for the text (the Matters list, PM v2 #881). */
  readonly compact = input(false);
  /** The id of the sentence that explains the flag (the header's note), so a screen reader hears it with the badge. */
  readonly describedBy = input<string | null>(null);
}
