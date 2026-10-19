import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { DynamicForm, FormDefinition } from 'form-engine';
import { ActionMenu, MenuAction } from '../../../shared/ui/action-menu';
import { Badge } from '../../../shared/ui/badge';
import { Dismissable } from '../../../shared/ui/dismissable';
import { FloatPanel } from '../../../shared/ui/float-position';

/** One step placement in the version being viewed or edited. */
export interface PlacementRow {
  stepId: number;
  title: string;
  description?: string;
  formVersionId?: number;
  isSkippable: boolean;
  skipCommentRequired: boolean;
  /** False when the library step has been deactivated since it was added. */
  active: boolean;
}

/** The inputs of a step as the person would see them (the Preview inputs panel). */
export interface PreviewState {
  state: 'loading' | 'ready' | 'none' | 'error';
  definition?: FormDefinition;
}

/** The one rule badge of a step row: Required, Skippable or Skippable - comment (icon and word, never colour alone). */
export function ruleBadge(row: Pick<PlacementRow, 'isSkippable' | 'skipCommentRequired'>): {
  label: string;
  tone: 'neutral' | 'info';
  icon: string;
} {
  if (!row.isSkippable) return { label: 'Required', tone: 'neutral', icon: 'pi-lock' };
  return row.skipCommentRequired
    ? { label: 'Skippable - comment', tone: 'info', icon: 'pi-comment' }
    : { label: 'Skippable', tone: 'info', icon: 'pi-forward' };
}

/**
 * A step of the version, one 44 px row (VP2, #394, #395): the number, the title on one line (two at most, the whole text is the
 * tooltip), the one rule badge and an overflow menu with Move up, Move down, Skip rules, Preview inputs and Remove. In a draft the
 * badge opens the Skip rules popover (the two checkboxes); a read-only version shows the badge and a Preview inputs button. The row has
 * two Tab stops in a draft (the badge and the overflow). Alt+Arrow on any control of the row is handled by the page.
 */
@Component({
  selector: 'mf-workflow-step-row',
  imports: [NgTemplateOutlet, Badge, ActionMenu, Dismissable, FloatPanel, DynamicForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workflow-step-row.scss',
  host: {
    class: 'wsr',
    '[class.wsr--unordered]': '!ordered()',
    '[attr.data-step-row]': 'row().title',
    '[attr.data-step-id]': 'row().stepId',
  },
  template: `
    <ng-template #badge>
      <mf-badge [tone]="rule().tone" [icon]="rule().icon">{{ rule().label }}</mf-badge>
    </ng-template>
    <div class="wsr__line">
      @if (ordered()) {
        <span class="wsr__no" aria-hidden="true">{{ index() + 1 }}</span>
      }
      <span class="wsr__title" data-step-title [attr.title]="row().title">{{ row().title }}</span>
      <span class="wsr__rules" data-skip-summary>
        @if (editable()) {
          <button
            #ruleBtn
            type="button"
            class="wsr__rule"
            data-rule
            aria-haspopup="dialog"
            [attr.aria-expanded]="rulesOpen()"
            [attr.aria-label]="'Skip rules of ' + row().title + ': ' + rule().label"
            (click)="rulesOpen.set(!rulesOpen())"
          >
            <ng-container *ngTemplateOutlet="badge" />
          </button>
          @if (rulesOpen()) {
            <div
              class="wsr__pop"
              role="dialog"
              data-rules-pop
              [attr.aria-label]="'Skip rules for ' + row().title"
              [mfDismissable]="ruleBtn"
              (dismissed)="rulesOpen.set(false)"
              [mfFloatPanel]="ruleBtn"
              (floatClose)="rulesOpen.set(false)"
              (placed)="firstBox.focus()"
            >
              <label class="wsr__opt">
                <input
                  #firstBox
                  type="checkbox"
                  [attr.data-skippable]="row().stepId"
                  [checked]="row().isSkippable"
                  (change)="skippable.emit($any($event.target).checked)"
                />
                Skippable
              </label>
              <label class="wsr__opt">
                <input
                  type="checkbox"
                  [attr.data-comment]="row().stepId"
                  [checked]="row().skipCommentRequired"
                  [disabled]="!row().isSkippable"
                  (change)="commentRequired.emit($any($event.target).checked)"
                />
                Comment required on skip
              </label>
              <p class="pg-reason wsr__hint">
                A skippable step can be marked skipped instead of completed.
              </p>
            </div>
          }
        } @else {
          <ng-container *ngTemplateOutlet="badge" />
        }
        @if (!row().active) {
          <mf-badge tone="danger" icon="pi-exclamation-triangle" data-inactive>
            Deactivated
          </mf-badge>
        }
      </span>
      @if (editable()) {
        <mf-action-menu [label]="'Actions for ' + row().title" [items]="menu()" [floating]="true" />
      } @else {
        <button
          type="button"
          class="mf-btn"
          [attr.data-preview]="row().stepId"
          [attr.aria-expanded]="previewOpen()"
          [attr.aria-label]="
            (previewOpen() ? 'Hide inputs of ' : 'Preview inputs of ') + row().title
          "
          (click)="togglePreview.emit()"
        >
          {{ previewOpen() ? 'Hide inputs' : 'Preview inputs' }}
        </button>
      }
    </div>
    @if (!row().active) {
      <p class="pg-reason wsr__note">
        This library step has been deactivated. Remove it or reactivate it in the step library.
      </p>
    }
    @if (previewOpen() && preview(); as p) {
      <div class="wsr__preview" [attr.data-preview-box]="row().stepId">
        @if (row().description) {
          <p class="pg-muted">{{ row().description }}</p>
        }
        @switch (p.state) {
          @case ('loading') {
            <p role="status">Loading inputs...</p>
          }
          @case ('error') {
            <p role="alert">We couldn't load the inputs for this step.</p>
          }
          @case ('none') {
            <p class="pg-muted">This step has no published inputs.</p>
          }
          @case ('ready') {
            <mf-dynamic-form [definition]="p.definition!" [readOnly]="true" />
          }
        }
      </div>
    }
  `,
})
export class WorkflowStepRow {
  readonly row = input.required<PlacementRow>();
  readonly index = input.required<number>();
  readonly last = input(false);
  readonly editable = input(false);
  readonly ordered = input(true);
  readonly previewOpen = input(false);
  readonly preview = input<PreviewState | undefined>(undefined);

  readonly move = output<-1 | 1>();
  readonly remove = output<void>();
  readonly skippable = output<boolean>();
  readonly commentRequired = output<boolean>();
  readonly togglePreview = output<void>();

  protected readonly rulesOpen = signal(false);
  protected readonly rule = computed(() => ruleBadge(this.row()));

  protected readonly menu = computed<MenuAction[]>(() => {
    const items: MenuAction[] = [];
    if (this.index() > 0) {
      items.push({
        id: 'up',
        label: 'Move up',
        icon: 'pi-arrow-up',
        run: () => this.move.emit(-1),
      });
    }
    if (!this.last()) {
      items.push({
        id: 'down',
        label: 'Move down',
        icon: 'pi-arrow-down',
        run: () => this.move.emit(1),
      });
    }
    items.push(
      {
        id: 'rules',
        label: 'Skip rules...',
        icon: 'pi-forward',
        run: () => this.rulesOpen.set(true),
      },
      {
        id: 'preview',
        label: this.previewOpen() ? 'Hide inputs' : 'Preview inputs',
        icon: this.previewOpen() ? 'pi-eye-slash' : 'pi-eye',
        run: () => this.togglePreview.emit(),
      },
      {
        id: 'remove',
        label: 'Remove',
        icon: 'pi-trash',
        danger: true,
        separated: true,
        run: () => this.remove.emit(),
      },
    );
    return items;
  });
}
