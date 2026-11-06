import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'critical' | 'danger';

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

/** The icon a badge shows when the page gives none: a chip of kind 1 always has an icon and the word (D-12, #1129). */
const TONE_ICONS: Readonly<Record<BadgeTone, string>> = {
  neutral: 'pi-minus-circle',
  info: 'pi-info-circle',
  success: 'pi-check-circle',
  warning: 'pi-exclamation-triangle',
  critical: 'pi-exclamation-circle',
  danger: 'pi-exclamation-circle',
};

/**
 * One badge family (UXR-15, UXR-27; TH-05 #987): a tone (a `--mf-sem-*` tint with its text colour, all at least 4.5:1) plus an optional icon, drawn as the same pill as `mf-status-chip`.
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
      @if (!ownIcon()) {
        <i class="pi" [class]="shownIcon()" aria-hidden="true"></i>
      }
      <ng-content select="[mfBadgeIcon]" />
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
      box-sizing: border-box;
      height: var(--mf-chip-h);
      padding: 0 var(--mf-s2);
      border: 1px solid var(--bd-line);
      border-radius: var(--mf-radius-pill);
      background: var(--bd-bg);
      color: var(--bd-fg);
      font-size: var(--mf-fs-chip);
      font-weight: var(--mf-fw-semibold);
      line-height: 1;
      white-space: nowrap;
    }
    .pi {
      flex: none;
      font-size: var(--mf-icon-sm);
    }
    /* The same pill as mf-status-chip: a tint, its text colour and a hairline (--mf-sem-* tokens, contrast checked). */
    [data-tone='neutral'] {
      --bd-bg: var(--mf-sem-neutral-bg);
      --bd-fg: var(--mf-sem-neutral-fg);
      --bd-line: var(--mf-sem-neutral-line);
    }
    [data-tone='info'] {
      --bd-bg: var(--mf-sem-info-bg);
      --bd-fg: var(--mf-sem-info-fg);
      --bd-line: var(--mf-sem-info-line);
    }
    [data-tone='success'] {
      --bd-bg: var(--mf-sem-healthy-bg);
      --bd-fg: var(--mf-sem-healthy-fg);
      --bd-line: var(--mf-sem-healthy-line);
    }
    [data-tone='warning'] {
      --bd-bg: var(--mf-sem-risk-bg);
      --bd-fg: var(--mf-sem-risk-fg);
      --bd-line: var(--mf-sem-risk-line);
    }
    [data-tone='critical'] {
      --bd-bg: var(--mf-sem-critical-bg);
      --bd-fg: var(--mf-sem-critical-fg);
      --bd-line: var(--mf-sem-critical-line);
    }
    [data-tone='danger'] {
      --bd-bg: var(--mf-sem-overdue-bg);
      --bd-fg: var(--mf-sem-overdue-fg);
      --bd-line: var(--mf-sem-overdue-line);
    }
  `,
})
export class Badge {
  readonly tone = input<BadgeTone>('neutral');
  /** PrimeIcons class, for example `pi-check-circle`; without one the tone's own icon is drawn (a status chip always has an icon). */
  readonly icon = input<string | null>(null);
  /** The id of an element that describes this badge (read out once with it). */
  readonly describedBy = input<string | null>(null);
  /** The page draws the icon itself (an element with the attribute `mfBadgeIcon`, for example an SVG state icon): the tone icon is left out. */
  readonly ownIcon = input(false);

  protected readonly shownIcon = computed(() => this.icon() || TONE_ICONS[this.tone()]);
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
