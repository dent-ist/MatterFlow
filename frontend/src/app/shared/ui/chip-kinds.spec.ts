import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Badge } from './badge';
import { CountChip } from './count-chip';
import { TagChip } from './tag-chip';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Badge, CountChip, TagChip],
  template: `
    <mf-badge tone="success">Current</mf-badge>
    <mf-badge tone="warning" icon="pi-pencil">Draft</mf-badge>
    <mf-count-chip data-count>{{ n() }}</mf-count-chip>
    <mf-tag-chip name="Privileged" [removable]="true" (remove)="removed.push('p')"
      >Privileged</mf-tag-chip
    >
    <mf-tag-chip name="Hot" removeLabel="Drop the Hot tag" [removable]="true">Hot</mf-tag-chip>
    <mf-tag-chip name="Plain">Plain</mf-tag-chip>
  `,
})
class Host {
  readonly n = signal(7);
  readonly removed: string[] = [];
}

describe('chip kinds (D-12, #1129)', () => {
  function create() {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }

  it('a status chip always has an icon: the tone icon when the page gives none, the page icon when it does', () => {
    const { el } = create();
    const [success, warning] = Array.from(el.querySelectorAll('mf-badge'));
    expect(success.querySelector('i.pi')!.classList).toContain('pi-check-circle');
    expect(warning.querySelector('i.pi')!.classList).toContain('pi-pencil');
  });

  it('a count chip shows the number only, with no icon', () => {
    const { f, el } = create();
    const chip = el.querySelector('[data-count]')!;
    expect(chip.textContent!.trim()).toBe('7');
    expect(chip.querySelector('i')).toBeNull();
    f.componentInstance.n.set(12);
    f.detectChanges();
    expect(chip.textContent!.trim()).toBe('12');
  });

  it('a removable tag chip has a remove button named "Remove <name>" (or the page label) that emits', () => {
    const { f, el } = create();
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('mf-tag-chip button'));
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remove Privileged',
      'Drop the Hot tag',
    ]);
    expect(buttons[0].querySelector('i.pi-times')).not.toBeNull();
    buttons[0].click();
    expect(f.componentInstance.removed).toEqual(['p']);
  });

  it('a tag chip that is not removable has no button', () => {
    const { el } = create();
    const plain = Array.from(el.querySelectorAll('mf-tag-chip')).at(-1)!;
    expect(plain.querySelector('button')).toBeNull();
  });
});
