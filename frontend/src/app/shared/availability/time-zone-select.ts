import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { FRIENDLY_ZONES, localTimeIn } from '../../core/availability/availability-edit';
import { Clock, browserTimeZoneOrNull } from '../../core/time/clock';

const OTHER = '__other__';

/**
 * The Time zone field of My profile (epic #520, P9, #540 and #567): a select of the zones the firm uses (Eastern, Central, Mountain,
 * Pacific, Alaska, Hawaii, Arizona), each with its IANA id as secondary text, then "Other zones..." which reveals the searchable list of
 * all IANA zones (the old input). The browser's zone and the saved zone are always selectable, as extra first options when they are not US
 * zones, so a legacy value is never overwritten silently. The value is the IANA id string; validation stays with the form.
 * Under it: the local time there ("It is 9:41 AM there now.", refreshed each minute, not announced on every tick) and one sentence about
 * the zone the rest of MatterFlow uses (the browser's, addendum M).
 */
@Component({
  selector: 'mf-time-zone-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="tz__label" for="av-tz">Time zone</label>
    <select
      id="av-tz"
      class="mf-control tz__select"
      data-tz-select
      [attr.aria-describedby]="'av-tz-time av-tz-note'"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      (change)="choose($any($event.target).value)"
    >
      @for (o of extras(); track o.id) {
        <option [value]="o.id" [selected]="!other() && value() === o.id">{{ o.label }}</option>
      }
      @for (o of friendly; track o.id) {
        <option [value]="o.id" [selected]="!other() && value() === o.id">
          {{ o.label }} ({{ o.id }})
        </option>
      }
      <option value="${OTHER}" [selected]="other()">Other zones...</option>
    </select>
    @if (other()) {
      <input
        id="av-tz-other"
        class="mf-control"
        type="text"
        list="av-tz-list"
        autocomplete="off"
        spellcheck="false"
        aria-label="Other time zone, start typing for example New_York"
        placeholder="Start typing, for example New_York"
        data-tz-other
        [attr.aria-invalid]="invalid() ? 'true' : null"
        [value]="value()"
        (input)="value.set($any($event.target).value.trim())"
      />
      <datalist id="av-tz-list">
        @for (z of zones(); track z) {
          <option [value]="z"></option>
        }
      </datalist>
    }
    <p class="tz__help" id="av-tz-time" data-tz-time>
      @if (localTime(); as t) {
        It is {{ t }} there now.
      }
      Work hours and out-of-office days follow this time zone.
    </p>
    <p class="tz__help" id="av-tz-note" data-tz-note>
      @if (isBrowser()) {
        It is your browser's time zone, the one dates and times elsewhere in MatterFlow use.
      } @else {
        Dates and times elsewhere in MatterFlow use your browser's time zone ({{ browser }}).
      }
    </p>
    <p class="mf-sr-only" role="status" aria-live="polite" data-tz-live>{{ announce() }}</p>
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--mf-s1);
      min-width: 0;
    }
    .tz__label {
      font-weight: 600;
    }
    .tz__select {
      width: 100%;
    }
    .tz__help {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
})
export class TimeZoneSelect {
  /** The IANA id. */
  readonly value = model('');
  /** Every IANA zone, for the searchable list behind "Other zones...". */
  readonly zones = input<readonly string[]>([]);
  /** The zone the person had saved (kept selectable when it is not a US zone). */
  readonly saved = input<string | null>(null);
  readonly invalid = input(false);

  private readonly clock = inject(Clock);
  protected readonly friendly = FRIENDLY_ZONES;
  protected readonly browser = browserTimeZoneOrNull() ?? 'UTC';
  /** The person asked for "Other zones...", or the value is a zone the select does not list. */
  private readonly forcedOther = signal(false);
  private readonly now = signal(this.clock.now());
  protected readonly announce = signal('');

  /** The saved zone and the browser zone, when they are not one of the friendly zones: always the first options. */
  protected readonly extras = computed(() => {
    const ids = new Set(FRIENDLY_ZONES.map((z) => z.id));
    const out: { id: string; label: string }[] = [];
    const add = (id: string | null | undefined, note: string): void => {
      if (id && !ids.has(id) && !out.some((o) => o.id === id))
        out.push({ id, label: `${id} (${note})` });
    };
    add(this.saved(), 'saved');
    add(this.browser, "your browser's time zone");
    return out;
  });

  protected readonly other = computed(() => {
    if (this.forcedOther()) return true;
    const v = this.value();
    return !FRIENDLY_ZONES.some((z) => z.id === v) && !this.extras().some((o) => o.id === v);
  });

  protected readonly localTime = computed(() => localTimeIn(this.value(), this.now()));
  protected readonly isBrowser = computed(() => this.value() === this.browser);

  constructor() {
    const timer = setInterval(() => this.now.set(this.clock.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected choose(id: string): void {
    if (id === OTHER) {
      this.forcedOther.set(true);
      return;
    }
    this.forcedOther.set(false);
    this.value.set(id);
    const time = localTimeIn(id, this.clock.now());
    this.announce.set(time ? `Time zone set. It is ${time} there now.` : '');
  }
}
