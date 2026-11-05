import { Tip } from '../../../shared/ui/tip';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
} from '@angular/core';

/** The three Needs attention cards, in display order (decision AS item 1: no ASAP card). The value is the `card=` address parameter. */
export const CARD_KEYS = ['overdue', 'unassigned', 'onHold'] as const;
export type CardKey = (typeof CARD_KEYS)[number];

export function isCardKey(value: unknown): value is CardKey {
  return typeof value === 'string' && (CARD_KEYS as readonly string[]).includes(value);
}

export interface CardCounts {
  overdue: number;
  unassigned: number;
  onHold: number;
}

interface CardSpec {
  key: CardKey;
  label: string;
  icon: string;
  tone: 'red' | 'violet' | 'slate';
  hint: string;
}

const CARDS: readonly CardSpec[] = [
  {
    key: 'overdue',
    label: 'Overdue',
    icon: 'pi-exclamation-circle',
    tone: 'red',
    hint: 'Excludes ASAP tasks',
  },
  {
    key: 'unassigned',
    label: 'Unassigned',
    icon: 'pi-user-minus',
    tone: 'violet',
    hint: 'No person assigned',
  },
  {
    key: 'onHold',
    label: 'On Hold',
    icon: 'pi-pause-circle',
    tone: 'slate',
    hint: 'Waiting on client, custodian or internal',
  },
];

/**
 * The Needs attention cards of the Dashboard Summary (epic #1063, DB-03). Each is a toggle button (`aria-pressed`): a click filters the grid to that card and a second click
 * clears it; one card or none is on. The cards are one Tab stop (the pressed card, else the first) and Left and Right move between them (roving focus; no new shortcut, #420).
 * The count is the server's, scope-wide, and does not shrink when the person types in Search or sets a filter; a card at zero is calm (teal check, "Nothing here").
 */
@Component({
  selector: 'mf-dash-cards',
  imports: [Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cards" role="group" aria-label="Needs attention" data-dash-cards>
      @for (c of cards; track c.key) {
        <button
          type="button"
          class="card"
          [class]="'card t-' + c.tone"
          [class.zero]="countOf(c.key) === 0"
          [attr.aria-pressed]="selected() === c.key"
          [attr.tabindex]="tabStop() === c.key ? 0 : -1"
          [attr.data-card]="c.key"
          [attr.aria-label]="nameOf(c)"
          [mfTip]="hintOf(c)"
          (click)="toggle(c.key)"
          (keydown)="onKey($event, c.key)"
        >
          <span class="ci" aria-hidden="true"
            ><i class="pi" [class]="countOf(c.key) === 0 ? 'pi-check' : c.icon"></i
          ></span>
          <span class="txt" aria-hidden="true">
            <span class="n" data-card-count>{{ countOf(c.key) }}</span>
            <span class="l">{{ c.label }}</span>
          </span>
          <span class="chk" aria-hidden="true"><i class="pi pi-check"></i></span>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      flex: none;
    }
    /* Three cards of one width, sized to their content with some air, left aligned under the tab names; the explanation is a tooltip (hover and keyboard focus). */
    .cards {
      display: grid;
      grid-template-columns: repeat(3, minmax(11rem, 14rem));
      justify-content: start;
      gap: var(--mf-s3);
    }
    .card {
      position: relative;
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      width: 100%;
      min-height: 64px;
      padding: var(--mf-s2) var(--mf-s4);
      text-align: left;
      color: var(--mf-text);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-soft, var(--mf-border));
      border-radius: var(--mf-radius-xl, 12px);
      font: inherit;
      cursor: pointer;
    }
    .t-red {
      --tone: var(--mf-p-red-solid);
      --tbg: var(--mf-p-red-bg);
    }
    .t-violet {
      --tone: var(--mf-p-violet-solid);
      --tbg: var(--mf-p-violet-bg);
    }
    .t-slate {
      --tone: var(--mf-p-slate-solid);
      --tbg: var(--mf-p-slate-bg);
    }
    .card:hover {
      background: var(--mf-row-hover);
    }
    .card:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .ci {
      display: grid;
      flex: none;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: var(--mf-radius-lg);
      color: var(--mf-white);
      background: var(--tone);
      font-size: 1.1rem;
    }
    .txt {
      display: flex;
      min-width: 0;
      flex-direction: column;
    }
    .n {
      font-variant-numeric: tabular-nums;
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
    }
    .l {
      font-weight: 600;
      line-height: 1.2;
    }
    .chk {
      position: absolute;
      top: var(--mf-s2);
      right: var(--mf-s2);
      display: none;
      place-items: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      color: var(--mf-white);
      background: var(--tone);
      font-size: 0.7rem;
    }
    .card[aria-pressed='true'] {
      background: var(--tbg);
      border-color: transparent;
      box-shadow: 0 0 0 2px var(--tone);
    }
    .card[aria-pressed='true'] .chk {
      display: grid;
    }
    .card.zero .ci {
      background: var(--mf-p-teal-solid);
    }
    /* A phone: the three cards stay in one compact row. */
    @media (max-width: 767.98px) {
      .cards {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--mf-s2);
      }
      .card {
        min-height: 64px;
        padding: var(--mf-s2);
        gap: var(--mf-s2);
      }
      .ci {
        width: 28px;
        height: 28px;
        font-size: 0.9rem;
      }
      .n {
        font-variant-numeric: tabular-nums;
        font-size: 22px;
      }
      .chk {
        top: 4px;
        right: 4px;
      }
    }
    /* A small phone: the three cards share 100 px each, so the icon box gives way to the count and the name (the words carry the meaning). */
    @media (max-width: 420px) {
      .ci {
        display: none;
      }
      .card {
        justify-content: center;
        padding: var(--mf-s2) var(--mf-s1);
      }
      .txt {
        align-items: center;
        text-align: center;
      }
    }
    @media (max-width: 359.98px) {
      .cards {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class DashCards {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly counts = input.required<CardCounts>();
  readonly selected = input<CardKey | null>(null);
  readonly pick = output<CardKey | null>();

  protected readonly cards = CARDS;
  /** The one Tab stop: the pressed card, else the first. */
  protected readonly tabStop = computed<CardKey>(() => this.selected() ?? CARD_KEYS[0]);

  protected countOf(key: CardKey): number {
    return this.counts()[key];
  }

  /** The tooltip: the explanation, or "Nothing here" at zero. */
  protected hintOf(c: CardSpec): string {
    return this.countOf(c.key) === 0 ? 'Nothing here' : c.hint;
  }

  /** The name carries the explanation too, so a screen reader hears it without hovering. */
  protected nameOf(c: CardSpec): string {
    const n = this.countOf(c.key);
    return `${c.label}, ${n} ${n === 1 ? 'task' : 'tasks'}. ${c.hint}`;
  }

  protected toggle(key: CardKey): void {
    this.pick.emit(this.selected() === key ? null : key);
  }

  /** Left and Right move between the cards (no wrap); Home and End jump to the first and last. */
  protected onKey(event: KeyboardEvent, key: CardKey): void {
    const at = CARD_KEYS.indexOf(key);
    const next =
      event.key === 'ArrowRight'
        ? at + 1
        : event.key === 'ArrowLeft'
          ? at - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? CARD_KEYS.length - 1
              : -1;
    if (next < 0 || next >= CARD_KEYS.length) return;
    event.preventDefault();
    this.host.nativeElement.querySelector<HTMLElement>(`[data-card="${CARD_KEYS[next]}"]`)?.focus();
  }
}
