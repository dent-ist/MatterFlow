/**
 * Spec helper for the shared dropdown (`mf-dropdown`, TH-17 #999): finds the button of a dropdown by its label, reads the chosen value and text, and chooses an
 * option by value or text (the list is drawn in the body, so options are found on the document). Same idea as `e2e/support/dropdown.ts`.
 */
const norm = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();

/** The button whose accessible name is "<label>: <chosen text>". */
export function ddButton(root: ParentNode, label?: string): HTMLButtonElement {
  if (label === undefined) {
    const first = root.querySelector<HTMLButtonElement>('mf-dropdown button');
    if (!first) throw new Error('No dropdown here');
    return first;
  }
  const found = Array.from(root.querySelectorAll<HTMLButtonElement>('mf-dropdown button')).find(
    (b) => (b.getAttribute('aria-label') ?? '').startsWith(`${label}:`),
  );
  if (!found) throw new Error(`No dropdown labelled "${label}"`);
  return found;
}

export const hasDd = (root: ParentNode, label?: string): boolean =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('mf-dropdown button')).some((b) =>
    (b.getAttribute('aria-label') ?? '').startsWith(`${label}:`),
  );

/** The chosen value (the option's data-value). */
export const ddValue = (root: ParentNode, label?: string): string =>
  ddButton(root, label).getAttribute('data-value') ?? '';

/** The chosen text as the button shows it. */
export const ddText = (root: ParentNode, label?: string): string =>
  norm(ddButton(root, label).querySelector('.val')?.textContent);

function options(): HTMLElement[] {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>(
      '.dd-panel [role="option"]:not([aria-disabled="true"])',
    ),
  );
}

/** Opens the list and returns the texts of its options (then closes it). */
export function ddOptionTexts(root: ParentNode, label?: string): string[] {
  ddButton(root, label).click();
  const texts = options().map((o) => norm(o.textContent));
  document.body
    .querySelector<HTMLElement>('.dd-panel [role="listbox"]')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return texts;
}

/** Opens the list and returns the values of its options (then closes it). */
export function ddOptionValues(root: ParentNode, label?: string): string[] {
  ddButton(root, label).click();
  const values = options().map((o) => o.getAttribute('data-value') ?? '');
  document.body
    .querySelector<HTMLElement>('.dd-panel [role="listbox"]')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return values;
}

/** Chooses an option by its value (data-value) or, failing that, by its text (a count after the text is ignored). */
export function ddChoose(root: ParentNode, label: string | undefined, choice: string): void {
  ddButton(root, label).click();
  const all = options();
  const target =
    all.find((o) => o.getAttribute('data-value') === choice) ??
    all.find((o) => norm(o.textContent).replace(/\s\d+$/, '') === choice);
  if (!target) {
    throw new Error(
      `No option "${choice}" in "${label}": ${all.map((o) => norm(o.textContent)).join(' | ')}`,
    );
  }
  target.click();
}

/** The options of a dropdown as `{ value, textContent }` (opens the list and closes it again). */
export function ddOptions(
  root: ParentNode,
  label?: string,
): { value: string; textContent: string }[] {
  const values = ddOptionValues(root, label);
  const texts = ddOptionTexts(root, label);
  return values.map((value, i) => ({ value, textContent: texts[i] }));
}

/**
 * A dropdown that answers like the native select it replaced, so a spec that read `.value`, listed `.options`, or set `.value` and fired `change` keeps its shape:
 * `ddSelect(el, 'Filter by Status')`. Setting `value` and dispatching `change` chooses that option in the open list.
 */
export function ddSelect(root: ParentNode, label?: string) {
  let pending = '';
  return {
    get value(): string {
      return ddValue(root, label);
    },
    set value(v: string) {
      pending = v;
    },
    get options(): { value: string; textContent: string }[] {
      return ddOptions(root, label);
    },
    get textContent(): string {
      return ddText(root, label);
    },
    get button(): HTMLButtonElement {
      return ddButton(root, label);
    },
    dispatchEvent(event: Event): boolean {
      if (event.type === 'change') ddChoose(root, label, pending);
      return true;
    },
  };
}
