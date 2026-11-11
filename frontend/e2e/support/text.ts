/**
 * Case-tolerant text for locators and assertions (E2E #1359). The Title Case pass of the app (UI2) renamed "Reopen task" to "Reopen Task", "Skip to table" to
 * "Skip to Table", "Move up" to "Move Up" and so on, and every case-sensitive regular expression or exact name in a spec stopped matching. The wording itself did
 * not change, so a spec states the words and `ci` ignores only the letter case:
 *
 *   page.getByRole('button', { name: ci(/^Create new draft/) })        // regular expression: the same pattern, the `i` flag added
 *   page.getByRole('link', { name: ci('Skip to Table'), exact: true }) // text: the whole name, any case (a regular expression, so `exact` is not needed)
 *   page.getByRole('menuitem', { name: ci.part('Edit availability') }) // text: part of the name, any case
 *
 * Nothing else is loosened: the same words in the same order, the same element, anchors and alternatives of a pattern stay as written. `ciText` is the string
 * form for code that compares strings (`expect(ciText(a)).toBe(ciText(b))`).
 */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A regular expression with the `i` flag added (its other flags and its source are kept), or the text as the WHOLE accessible name in any case (spaces trimmed). */
export function ci(text: string | RegExp): RegExp {
  if (text instanceof RegExp) {
    return text.flags.includes('i') ? text : new RegExp(text.source, `${text.flags}i`);
  }
  return new RegExp(`^\\s*${escape(text)}\\s*$`, 'i');
}

/** The text as a part of a name, in any case (what a plain `name: 'text'` does, without an `exact` that would bring the case back). */
ci.part = (text: string): RegExp => new RegExp(escape(text), 'i');

/** The text with its spaces collapsed and its letters lower-cased, for comparing two strings that differ only in case. */
export const ciText = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** The list of texts in `ciText` form, to compare lists of labels (`expect(ciTexts(await tabs.allTextContents())).toEqual(ciTexts(['Due soon', ...]))`). */
export const ciTexts = (texts: readonly string[]): string[] => texts.map(ciText);
