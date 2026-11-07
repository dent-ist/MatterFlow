import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StateBlock } from '../../../shared/ui/state-block';

/**
 * My Matters for a person who manages no matter (issue #976: a Director holds `Matter.BeManager` and usually names managers rather than being one; a
 * new Project Manager has none yet). One calm block (D-51, `mf-state-block`), the sentence the Matters, Clients, Projects and Assets lists use for the same
 * situation, and one way on: the Matters list, where the matters are and where managers are named. No counts, no warning.
 */
@Component({
  selector: 'mf-mm-no-matters',
  imports: [StateBlock, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-state-block icon="pi-briefcase" data-no-matters>
      You do not manage any matter yet.
      <a mfStateAction class="mf-btn" routerLink="/matters" data-go-matters>Go to Matters</a>
    </mf-state-block>
  `,
})
export class MmNoMatters {}
