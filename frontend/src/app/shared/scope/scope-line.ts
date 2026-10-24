import { Scope } from './scope.service';

/**
 * The count line under a scoped list's title (README 3.1): "Assets of matters you manage (63 of 1,204)" or "1,204 assets". The text states
 * the scope, colour is never the signal. `shown` and `all` are null until they are known.
 *
 *   scopeLine({ scope: 'mine', noun: 'assets', phrase: 'Assets of matters you manage', shown: 63, all: 1204 })
 */
export function scopeLine(options: {
  scope: Scope | null;
  noun: string;
  /** The line's start when the list is scoped ("Assets of matters you manage"). */
  phrase: string;
  shown: number | null;
  all: number | null;
}): string {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const { scope, noun, phrase, shown, all } = options;
  if (scope === null) return '';
  if (scope === 'mine') {
    if (shown === null) return phrase;
    return all === null ? `${phrase} (${fmt(shown)})` : `${phrase} (${fmt(shown)} of ${fmt(all)})`;
  }
  if (shown === null) return '';
  return `${fmt(shown)} ${noun}`;
}

/** What the polite live region says after the person changes the scope. */
export function scopeAnnouncement(scope: Scope, noun = 'matters'): string {
  return scope === 'mine' ? `Showing ${noun} you manage` : `Showing all ${noun}`;
}
