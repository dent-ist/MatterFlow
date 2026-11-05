import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { MatterAiAllowed } from '../../../api/generated/api-client';
import { ConfirmDialog } from '../confirm-dialog';
import { SlidePanel } from '../slide-panel';

/** Why the button is off, shown next to it and read out with it. */
export const AI_OFF_MESSAGE = "AI can't be used on this matter";

/**
 * The AI button of the Notes editor toolbar (MD-16, #1017; owner decision AQ.10). With AI allowed = On-prem only or Company-approved it is a violet button
 * marked "soon" that opens the "coming soon" panel; with AI allowed = No it is `aria-disabled` (still focusable) and says "AI can't be used on this matter".
 * It has no other function in release 1.
 */
@Component({
  selector: 'mf-ai-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="mf-btn ai"
      [class.ai--off]="off()"
      data-ai-button
      [attr.aria-disabled]="off() ? 'true' : null"
      [attr.aria-describedby]="off() ? 'ai-off-note' : null"
      [attr.title]="off() ? offMessage : null"
      (click)="off() || pressed.emit()"
    >
      <i class="pi pi-sparkles" aria-hidden="true"></i>
      AI
      @if (!off()) {
        <span class="ai__soon">soon</span>
      }
    </button>
    @if (off()) {
      <span class="ai__note" [class.mf-sr-only]="!showNote()" id="ai-off-note" data-ai-off-note>{{
        offMessage
      }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .ai {
      border-color: var(--mf-sem-person-line);
      background: var(--mf-sem-person-bg);
      color: var(--mf-sem-person-fg);
    }
    .ai__soon {
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-surface);
      font-size: var(--mf-fs-xs);
    }
    .ai--off {
      border-color: var(--mf-border);
      background: var(--mf-surface);
      color: var(--mf-text-muted);
      cursor: not-allowed;
    }
    .ai__note {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
})
export class AiButton {
  /** The matter's setting; a missing value counts as No. */
  readonly allowed = input<MatterAiAllowed | null | undefined>(MatterAiAllowed.No);
  readonly pressed = output<void>();
  /** Show "AI can't be used on this matter" beside the button; off where space is tight (the message is then the tooltip and the button's description). */
  readonly showNote = input(true);
  protected readonly offMessage = AI_OFF_MESSAGE;
  protected readonly off = computed(
    () => (this.allowed() ?? MatterAiAllowed.No) === MatterAiAllowed.No,
  );
}

/** The side panel the AI button opens in release 1: it only says that the assistant is coming. No function behind it. */
@Component({
  selector: 'mf-ai-coming-soon',
  imports: [SlidePanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-slide-panel title="AI Assistant" [showFooter]="false" [(visible)]="visible">
      <p data-ai-soon>AI assistant is coming soon.</p>
      <p class="ai__hint">When it arrives it will follow the AI allowed setting of this matter.</p>
    </mf-slide-panel>
  `,
  styles: `
    .ai__hint {
      color: var(--mf-text-muted);
    }
  `,
})
export class AiComingSoon {
  readonly visible = model(false);
}

/**
 * The warning a future AI policy check shows when a note is saved (MD-16, #1017): the reasons, and the choices **Edit** (go back, left) and **Save anyway**
 * (right). The page that owns the note records "Saved after an AI warning" in the note history when it saves anyway. In release 1 only this component exists;
 * nothing opens it while the `aiPolicyCheck` flag (`AI_FLAGS`) is off.
 */
@Component({
  selector: 'mf-ai-warning-dialog',
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-confirm-dialog
      title="Save Note Anyway"
      confirmLabel="Save Note Anyway"
      [(visible)]="visible"
      (confirmed)="saveAnyway.emit()"
    >
      <p data-ai-warning-lead>
        This note may conflict with company policy or the matter's specifications:
      </p>
      <ul data-ai-warning-reasons>
        @for (r of reasons(); track $index) {
          <li>{{ r }}</li>
        }
      </ul>
    </mf-confirm-dialog>
  `,
})
export class AiWarningDialog {
  readonly reasons = input<readonly string[]>([]);
  readonly visible = model(false);
  /** Save anyway was chosen. */
  readonly saveAnyway = output<void>();
}
