import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InlineMenu, MenuOption } from './inline-menu';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineMenu],
  template: `
    <mf-inline-menu
      label="Change priority"
      [options]="options"
      [busy]="busy()"
      (picked)="picked.push($event.id)"
      >High</mf-inline-menu
    >
  `,
})
class Host {
  readonly busy = signal(false);
  readonly options: MenuOption[] = [
    { id: 'a', label: 'Low' },
    { id: 'b', label: 'High' },
  ];
  readonly picked: string[] = [];
}

describe('InlineMenu focus (UXR2-05)', () => {
  it('keeps focus on the trigger after a pick, even while the change is being saved', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLButtonElement>('[data-inline-trigger]')!;
    document.body.appendChild(root);

    trigger.click();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.im-item[data-option="a"]')!.click();
    fixture.componentInstance.busy.set(true);
    fixture.detectChanges();

    expect(fixture.componentInstance.picked).toEqual(['a']);
    expect(trigger.disabled).toBe(false);
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    fixture.detectChanges();
    expect(root.querySelector('.im-pop')).toBeNull();
    root.remove();
  });
});

describe('InlineMenu Escape on the trigger', () => {
  it('lets Escape reach a dialog around a closed menu, and keeps other keys from the row', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    const seen: string[] = [];
    root.addEventListener('keydown', (e) => seen.push(e.key));
    const trigger = root.querySelector<HTMLButtonElement>('[data-inline-trigger]')!;
    const press = (key: string) =>
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    press('Escape');
    press('ArrowRight');
    expect(seen).toEqual(['Escape']);
    root.remove();
  });
});

describe('InlineMenu placement (DASH-11)', () => {
  const rect = (top: number, height: number): DOMRect =>
    ({
      top,
      bottom: top + height,
      left: 40,
      right: 140,
      width: 100,
      height,
      x: 40,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  async function open(triggerTop: number, popHeight: number) {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('im-pop') ? rect(0, popHeight) : rect(triggerTop, 28);
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('[data-inline-trigger]')!.click();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    return { root, pop: root.querySelector<HTMLElement>('.im-pop')! };
  }

  afterEach(() => vi.restoreAllMocks());

  it('opens below the trigger when the list fits there', async () => {
    const { root, pop } = await open(100, 120);
    expect(pop.style.top).toBe('132px'); // trigger bottom 128 + 4
    root.remove();
  });

  it('opens right above the trigger (not a fixed distance away) when it does not fit below', async () => {
    const { root, pop } = await open(742, 120);
    expect(pop.style.top).toBe('618px'); // trigger top 742 - 4 - the real height 120
    root.remove();
  });

  it('shrinks and scrolls inside the free space when neither side has room', async () => {
    const { root, pop } = await open(300, 600);
    expect(pop.style.maxHeight).not.toBe('');
    expect(parseInt(pop.style.maxHeight, 10)).toBeLessThanOrEqual(256);
    root.remove();
  });
});

describe('InlineMenu empty state (DASH3-05)', () => {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [InlineMenu],
    template: `<mf-inline-menu label="Assign" [options]="[]" emptyText="No people found."
      >Unassigned</mf-inline-menu
    >`,
  })
  class EmptyHost {}

  it('keeps the note out of role="menu" (a menu may only contain items) and still announces it', () => {
    const fixture = TestBed.createComponent(EmptyHost);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('[data-inline-trigger]')!.click();
    fixture.detectChanges();
    expect(root.querySelector('[role="menu"]')).toBeNull();
    const note = root.querySelector('.im-pop [role="status"]')!;
    expect(note.textContent!.trim()).toBe('No people found.');
    root.remove();
  });
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InlineMenu],
  template: `
    <mf-inline-menu label="Change assignee" [options]="options" (picked)="picked.push($event.id)"
      >Unassigned</mf-inline-menu
    >
  `,
})
class FlagHost {
  readonly options: MenuOption[] = [
    { id: '1', label: 'Dana Director', flag: 'Out of office until Oct 20' },
    { id: '2', label: 'Kim Admin' },
  ];
  readonly picked: string[] = [];
}

describe('InlineMenu option flag (availability)', () => {
  it('shows the flag with an icon under the label and still lets the option be chosen', () => {
    const fixture = TestBed.createComponent(FlagHost);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('[data-inline-trigger]')!.click();
    fixture.detectChanges();

    const flagged = root.querySelector<HTMLButtonElement>('.im-item[data-option="1"]')!;
    expect(flagged.querySelector('[data-option-flag]')?.textContent?.trim()).toBe(
      'Out of office until Oct 20',
    );
    expect(flagged.querySelector('.pi-calendar-minus')).not.toBeNull();
    expect(root.querySelector('.im-item[data-option="2"] [data-option-flag]')).toBeNull();
    expect(flagged.getAttribute('aria-disabled')).toBeNull();

    flagged.click();
    expect(fixture.componentInstance.picked).toEqual(['1']);
    root.remove();
  });
});
