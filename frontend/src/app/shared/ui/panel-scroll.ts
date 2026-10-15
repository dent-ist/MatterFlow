import { Directive, computed, input } from '@angular/core';

/**
 * An independent scroll area inside a page that otherwise scrolls normally (the Comments and Assets panels of the Task page): a focusable
 * `role="region"` named "<label>, scrollable" so keyboard users can scroll it, with a maximum height of `--mf-panel-max` (the page sets
 * it per breakpoint; without it the area simply grows and the page scrolls).
 *
 *   <div mfPanelScroll="Linked assets">...</div>
 */
@Directive({
  selector: '[mfPanelScroll]',
  host: {
    class: 'mf-panel-scroll',
    role: 'region',
    tabindex: '0',
    '[attr.aria-label]': 'name()',
  },
})
export class PanelScroll {
  /** What the area holds ("Linked assets"): the region is named "<label>, scrollable". */
  readonly mfPanelScroll = input('Panel');
  protected readonly name = computed(() => `${this.mfPanelScroll() || 'Panel'}, scrollable`);
}
