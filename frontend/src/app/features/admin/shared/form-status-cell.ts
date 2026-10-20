import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone, formatInstantDate } from '../../../core/time/time';
import { Badge } from '../../../shared/ui/badge';

/**
 * What a form (an asset type's, a custom-field object's) looks like in a list cell (#631): the same words in Asset Types and Custom Fields.
 *
 *   <td class="mf-cell-badge"><mf-form-status-cell [publishedVersion]="t.publishedVersionNo" [fieldCount]="t.fieldCount"
 *        [publishedAtUtc]="t.publishedAtUtc" [draftVersion]="t.draftVersionNo" /></td>
 *
 *   Published v3 (green, check)   then "8 fields" and "Updated Oct 12" in muted text (the year only when it is not this year)
 *   Draft v4 (the app-wide Draft amber)   an open draft, next to the published badge when there is one
 *   No published fields (neutral, info icon)   when nothing is published; the draft badge may follow it
 *
 * Every state is text plus an icon, never colour alone. A number the API did not return (`null`) leaves its words out. The full sentence is the
 * tooltip of the cell, so a clipped cell loses nothing.
 */
@Component({
  selector: 'mf-form-status-cell',
  imports: [Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.title]': 'sentence()' },
  template: `
    <span class="fsc" data-form-status>
      @if (publishedVersion() !== null) {
        <mf-badge tone="success" icon="pi-check-circle" data-published
          >Published v{{ publishedVersion() }}</mf-badge
        >
      } @else {
        <mf-badge tone="neutral" icon="pi-info-circle" data-none>No published fields</mf-badge>
      }
      @if (draftVersion() !== null) {
        <mf-badge tone="warning" icon="pi-file-edit" data-draft
          >Draft v{{ draftVersion() }}</mf-badge
        >
      }
      @if (facts(); as text) {
        <span class="fsc-facts" data-facts>{{ text }}</span>
      }
    </span>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .fsc {
      display: flex;
      flex-wrap: nowrap;
      gap: var(--mf-s2);
      align-items: center;
      min-width: 0;
      white-space: nowrap;
    }
    mf-badge {
      flex: none;
    }
    .fsc-facts {
      overflow: hidden;
      min-width: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      text-overflow: ellipsis;
    }
  `,
})
export class FormStatusCell {
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  /** The published version number, or `null` when nothing is published. */
  readonly publishedVersion = input<number | null | undefined>(null);
  /** Fields of the published form; `null` when the API did not say. */
  readonly fieldCount = input<number | null | undefined>(null);
  readonly publishedAtUtc = input<string | null | undefined>(null);
  /** The open draft's version number, or `null` when there is none. */
  readonly draftVersion = input<number | null | undefined>(null);

  /** "8 fields · Updated Oct 12", or empty. Only a published form has fields and a date. */
  protected readonly facts = computed(() => {
    if (this.publishedVersion() == null) return '';
    const parts: string[] = [];
    const n = this.fieldCount();
    if (n != null) parts.push(n === 1 ? '1 field' : `${n} fields`);
    const at = this.publishedAtUtc();
    if (at) parts.push(`Updated ${this.shortDate(at)}`);
    return parts.join(' · ');
  });

  /** The whole cell as a sentence: the tooltip. */
  protected readonly sentence = computed(() => {
    const parts: string[] = [];
    parts.push(
      this.publishedVersion() != null
        ? `Published version ${this.publishedVersion()}`
        : 'No published fields',
    );
    if (this.draftVersion() != null) parts.push(`draft version ${this.draftVersion()}`);
    const n = this.fieldCount();
    if (this.publishedVersion() != null && n != null)
      parts.push(n === 1 ? '1 field' : `${n} fields`);
    const at = this.publishedAtUtc();
    if (this.publishedVersion() != null && at)
      parts.push(`updated ${formatInstantDate(at, this.zone)}`);
    const text = parts.join(', ');
    return text.charAt(0).toUpperCase() + text.slice(1) + '.';
  });

  /** "Oct 12"; with the year ("Oct 12, 2025") when it is not this year. */
  private shortDate(at: string): string {
    const full = formatInstantDate(at, this.zone);
    const year = calendarDayInZone(this.clock.now(), this.zone).year;
    return full.replace(new RegExp(`, ${year}$`), '');
  }
}
