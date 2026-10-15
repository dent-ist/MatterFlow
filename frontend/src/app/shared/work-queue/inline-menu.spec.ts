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
