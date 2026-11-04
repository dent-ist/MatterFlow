import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

/** The six states of a person on the Dashboard Users views (Idle, Light, Normal, Heavy, Out of office, Off hours). */
export type UserStateKey = 'idle' | 'light' | 'normal' | 'heavy' | 'out' | 'off';

export type UserStateIconSize = 'sm' | 'lg';

const HEAD = '<path d="M9 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/>';
const BODY_PART = '<path d="M3 21v-2a4 4 0 0 1 4 -4h4"/>';
const HEAD_LEFT = '<path d="M5 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/>';

/**
 * Inner markup of a 24x24 outline SVG (stroke = currentColor, width 2, round caps), in the style of the Tabler outline set used for the Task Type icons (MIT, see
 * TABLER-ICONS-LICENSE.txt). The SHAPE says the state, the colour only supports it: Idle = person with a check, Light = one person, Normal = two people, Heavy = person with an
 * exclamation mark, Out of office = person with a minus, Off hours = person with a moon.
 */
const PATHS: Readonly<Record<UserStateKey, string>> = {
  idle: `${HEAD}${BODY_PART}<path d="M15 19l2 2l4 -4"/>`,
  light:
    '<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/>',
  normal: `${HEAD_LEFT}<path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0 -3 -3.85"/>`,
  heavy: `${HEAD}${BODY_PART}<path d="M19 16v3"/><path d="M19 22v.01"/>`,
  out: `${HEAD}${BODY_PART}<path d="M16 19h6"/>`,
  off: `${HEAD}${BODY_PART}<path d="M21 15.5a3.5 3.5 0 1 0 0 6.5a4.5 4.5 0 0 1 0 -6.5z"/>`,
};

/** The accessible word of each state (the icon is decorative where the word is shown beside it). */
export const USER_STATE_WORDS: Readonly<Record<UserStateKey, string>> = {
  idle: 'Idle',
  light: 'Light',
  normal: 'Normal',
  heavy: 'Heavy',
  out: 'Out of office',
  off: 'Off hours',
};

/**
 * The one person-state icon (`mf-user-state-icon`, US-11 #1102): the shape of the state in the state's colour (tokens: Idle `--mf-success`, Light `--mf-info`, Normal and Off
 * hours `--mf-text-muted`, Heavy `--mf-danger`, Out of office `--mf-warning`), on a soft circle of the matching background when `circle` is set. Decorative (`aria-hidden`): the
 * state is always written next to it (card name, dropdown row, legend). `lg` is a 28 px icon in a 44 px circle (the card), `sm` an 18 px icon (menus, legend).
 */
@Component({
  selector: 'mf-user-state-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    [innerHTML]="markup()"
  ></svg>`,
  host: {
    '[attr.data-state-icon]': 'state()',
    '[attr.data-size]': 'size()',
    '[attr.data-circle]': 'circle() ? "" : null',
  },
  styles: `
    :host {
      --usi-fg: var(--mf-text-muted);
      --usi-bg: var(--mf-surface-alt);
      display: inline-grid;
      flex: none;
      place-items: center;
      width: var(--mf-icon-md);
      height: var(--mf-icon-md);
      color: var(--usi-fg);
    }
    :host([data-state-icon='idle']) {
      --usi-fg: var(--mf-success);
      --usi-bg: var(--mf-success-bg);
    }
    :host([data-state-icon='light']) {
      --usi-fg: var(--mf-info);
      --usi-bg: var(--mf-info-bg);
    }
    :host([data-state-icon='heavy']) {
      --usi-fg: var(--mf-danger);
      --usi-bg: var(--mf-danger-bg);
    }
    :host([data-state-icon='out']) {
      --usi-fg: var(--mf-warning);
      --usi-bg: var(--mf-warning-bg);
    }
    :host([data-size='lg']) {
      width: 1.75rem;
      height: 1.75rem;
    }
    :host([data-circle]) {
      box-sizing: content-box;
      padding: var(--mf-s1);
      background: var(--usi-bg);
      border-radius: 50%;
    }
    :host([data-circle][data-size='lg']) {
      padding: var(--mf-s2);
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `,
})
export class UserStateIcon {
  readonly state = input.required<UserStateKey>();
  readonly size = input<UserStateIconSize>('sm');
  readonly circle = input(false);

  private readonly sanitizer = inject(DomSanitizer);
  /** Our own constant shapes (no user input), so they are trusted here as for the Task Type icons. */
  protected readonly markup = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(PATHS[this.state()]),
  );
}
