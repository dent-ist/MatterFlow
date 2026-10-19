/** Most characters of a Task Type description on its chooser card; three lines of the narrowest card hold about this much (CT1, #323). */
export const CARD_TEXT_MAX = 110;

/**
 * `text` for a chooser card: when it is longer than `max`, it is cut after the last whole word that fits and ends in an ellipsis, so a
 * word is never cut in half ("Add 6..."). The full text stays in the card's tooltip. Text that fits is returned as it is.
 */
export function cardText(text: string | null | undefined, max = CARD_TEXT_MAX): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const room = clean.slice(0, max);
  // Cut at the last space inside the room; a single word longer than the room is the only case that has to be cut inside a word.
  const space = room.lastIndexOf(' ');
  const cut = space > 0 ? room.slice(0, space) : room;
  return cut.replace(/[\s.,;:!?-]+$/, '') + '…';
}
