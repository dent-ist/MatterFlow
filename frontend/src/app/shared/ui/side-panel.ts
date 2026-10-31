import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  model,
  output,
  Injector,
} from '@angular/core';
import { Tip } from './tip';

export interface SideSection {
  key: string;
  label: string;
  /** A PrimeIcons class. */
  icon: string;
  /** The badge on the rail button (the events of the next 14 days, the unread activity); not drawn for 0 or null. */
  count?: number | null;
  /** The badge is the alarm colour (overdue, unread) when set. */
  alert?: boolean;
}

/**
 * Collapsible side panel with a rail (`mf-side-panel`, epic #953 UI-10; the right panel of My Matters). Open, it is a column that holds the projected sections (cards that carry
 * `data-section="<key>"`); closed, it is a 48 px rail with a button for each section (tooltip on hover and focus, count badge) and a button that opens it. The header button is a
 * disclosure: `aria-expanded`, `aria-controls`, visible focus. A rail button opens the panel and moves focus to its section. The page owns the remembered state (`open` is a model)
 * and the turn-taking with the tree. The panel fills the height it is given; the sections scroll inside themselves.
 */
@Component({
  selector: 'mf-side-panel',
  imports: [Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.open]': 'open()', '[attr.data-open]': 'open()' },
  template: `
    @if (open()) {
      <div class="col" [id]="panelId" [attr.aria-label]="label()" role="region">
        <div class="hd">
          <button
            type="button"
            class="tgl"
            data-side-toggle
            [attr.aria-expanded]="true"
            [attr.aria-controls]="panelId"
            [attr.aria-label]="'Collapse ' + label()"
            [mfTip]="'Collapse ' + label()"
            (click)="setOpen(false)"
          >
            <i class="pi pi-angle-double-right" aria-hidden="true"></i>
          </button>
        </div>
        <div class="body"><ng-content /></div>
      </div>
    } @else {
      <div class="rail" role="group" [attr.aria-label]="label()">
        <button
          type="button"
          class="rbtn"
          data-side-toggle
          [attr.aria-expanded]="false"
          [attr.aria-controls]="panelId"
          [attr.aria-label]="'Expand ' + label()"
          [mfTip]="'Expand ' + label()"
          (click)="setOpen(true)"
        >
          <i class="pi pi-angle-double-left" aria-hidden="true"></i>
        </button>
        @for (s of sections(); track s.key) {
          <button
            type="button"
            class="rbtn"
            [attr.data-rail]="s.key"
            [attr.aria-label]="s.label + (s.count ? ', ' + s.count : '')"
            [mfTip]="s.label + (s.count ? ': ' + s.count : '')"
            (click)="openSection(s.key)"
          >
            <i class="pi" [class]="s.icon" aria-hidden="true"></i>
            @if (s.count) {
              <span class="badge" [class.alert]="s.alert" aria-hidden="true">{{ s.count }}</span>
            }
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      min-width: 0;
      min-height: 0;
    }
    :host(.open) {
      width: var(--mf-side-w, 340px);
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s2);
      height: 100%;
      min-height: 0;
    }
    /* The toggle sits in the first card's heading row (the cards keep their right edge free for it). */
    .hd {
      position: absolute;
      top: 6px;
      right: 8px;
      z-index: 2;
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
      flex: 1 1 0;
      min-height: 0;
    }
    .rail {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--mf-s3);
      width: 48px;
      height: 100%;
      padding: var(--mf-s2) 0;
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-card);
      box-sizing: border-box;
    }
    .tgl,
    .rbtn {
      position: relative;
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      color: var(--mf-text);
      cursor: pointer;
    }
    .tgl:hover,
    .rbtn:hover {
      background: var(--mf-surface-alt);
    }
    .badge {
      position: absolute;
      top: -7px;
      right: -7px;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      box-sizing: border-box;
      border: 2px solid var(--mf-surface);
      border-radius: 9px;
      background: var(--mf-primary);
      color: var(--mf-surface);
      font-size: 11px;
      font-weight: 700;
      line-height: 14px;
      text-align: center;
    }
    .badge.alert {
      background: var(--mf-danger);
    }
    @media (max-width: 767.98px) {
      :host(.open) {
        width: auto;
      }
      .hd {
        display: none;
      }
      .tgl,
      .rbtn {
        width: 44px;
        height: 44px;
      }
    }
  `,
})
export class SidePanel {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  readonly open = model(true);
  readonly sections = input<readonly SideSection[]>([]);
  readonly label = input('Events and activity');
  /** The user chose a section on the rail (the page may react: the panel opens and focus moves to the section). */
  readonly sectionOpened = output<string>();
  /** The user opened or closed the panel with its own button (not by the page). */
  readonly toggled = output<boolean>();
  protected readonly panelId = `mf-side-${Math.random().toString(36).slice(2, 8)}`;

  protected setOpen(value: boolean): void {
    this.open.set(value);
    this.toggled.emit(value);
    // Keep the keyboard where it was: the toggle button exists in both states, so focus moves to the new one.
    afterNextRender(() => this.host.querySelector<HTMLElement>('[data-side-toggle]')?.focus(), {
      injector: this.injector,
    });
  }

  protected openSection(key: string): void {
    this.open.set(true);
    this.sectionOpened.emit(key);
    afterNextRender(
      () => {
        const target = this.host.querySelector<HTMLElement>(`[data-section="${key}"]`);
        const focusable = target?.matches('[tabindex],button,a,input')
          ? target
          : target?.querySelector<HTMLElement>('[data-section-focus],button,a,[tabindex]');
        focusable?.focus();
      },
      { injector: this.injector },
    );
  }
}
