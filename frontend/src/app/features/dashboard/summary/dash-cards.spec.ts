import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CardKey, DashCards } from './dash-cards';

describe('DashCards (decision AS item 1)', () => {
  let fixture: ComponentFixture<DashCards>;
  const picks: (CardKey | null)[] = [];
  const el = () => fixture.nativeElement as HTMLElement;
  const card = (key: string) => el().querySelector(`[data-card="${key}"]`) as HTMLButtonElement;

  function create(
    selected: CardKey | null = null,
    counts = { overdue: 12, unassigned: 7, onHold: 0 },
  ) {
    picks.length = 0;
    fixture = TestBed.createComponent(DashCards);
    fixture.componentRef.setInput('counts', counts);
    fixture.componentRef.setInput('selected', selected);
    fixture.componentInstance.pick.subscribe((k) => picks.push(k));
    fixture.detectChanges();
  }

  it('draws exactly three cards, Overdue, Unassigned, On hold (no ASAP card)', () => {
    create();
    const names = Array.from(el().querySelectorAll('[data-card]')).map((b) =>
      b.querySelector('.l')?.textContent?.trim(),
    );
    expect(names).toEqual(['Overdue', 'Unassigned', 'On hold']);
    expect(el().textContent).not.toContain('ASAP open');
    expect(el().querySelector('[data-card="asap"]')).toBeNull();
  });

  it('shows the counts and a calm zero', () => {
    create();
    expect(card('overdue').querySelector('[data-card-count]')?.textContent).toBe('12');
    expect(card('onHold').classList.contains('zero')).toBe(true);
    expect(card('onHold').textContent).toContain('Nothing here');
    expect(card('overdue').getAttribute('aria-label')).toContain('12 tasks');
  });

  it('is a toggle: a click picks the card, a second click on the pressed card clears it', () => {
    create();
    card('unassigned').click();
    expect(picks).toEqual(['unassigned']);
    fixture.componentRef.setInput('selected', 'unassigned');
    fixture.detectChanges();
    expect(card('unassigned').getAttribute('aria-pressed')).toBe('true');
    expect(card('overdue').getAttribute('aria-pressed')).toBe('false');
    card('unassigned').click();
    expect(picks).toEqual(['unassigned', null]);
  });

  it('has one Tab stop (the pressed card, else the first) and Left/Right move between cards', () => {
    create();
    expect(
      Array.from(el().querySelectorAll('[data-card]')).map((b) => b.getAttribute('tabindex')),
    ).toEqual(['0', '-1', '-1']);
    card('overdue').focus();
    card('overdue').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    expect(document.activeElement).toBe(card('unassigned'));
    card('unassigned').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    expect(document.activeElement).toBe(card('overdue'));
    create('onHold');
    expect(card('onHold').getAttribute('tabindex')).toBe('0');
    expect(card('overdue').getAttribute('tabindex')).toBe('-1');
  });
});
