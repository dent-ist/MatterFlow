import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { FormStatusCell } from './form-status-cell';

@Component({
  imports: [FormStatusCell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-form-status-cell
    [publishedVersion]="pub()"
    [fieldCount]="fields()"
    [publishedAtUtc]="at()"
    [draftVersion]="draft()"
  />`,
})
class Host {
  readonly pub = signal<number | null>(3);
  readonly fields = signal<number | null>(8);
  readonly at = signal<string | null>('2026-10-12T15:00:00Z');
  readonly draft = signal<number | null>(null);
}

describe('FormStatusCell (#631)', () => {
  function create() {
    TestBed.configureTestingModule({
      providers: [
        { provide: Clock, useValue: { now: () => new Date('2026-10-20T12:00:00Z') } },
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
      ],
    });
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }
  const text = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ').trim();

  it('published: the badge, the field count and the month and day', () => {
    const { el } = create();
    expect(el.querySelector('[data-published]')!.textContent!.trim()).toBe('Published v3');
    expect(el.querySelector('[data-facts]')!.textContent).toBe('8 fields · Updated Oct 12');
    expect(el.querySelector('[data-draft], [data-none]')).toBeNull();
    expect(el.querySelector('mf-form-status-cell')!.getAttribute('title')).toBe(
      'Published version 3, 8 fields, updated Oct 12, 2026.',
    );
  });

  it('a draft next to the published version uses the amber Draft badge with its icon', () => {
    const { f, el } = create();
    f.componentInstance.draft.set(4);
    f.detectChanges();
    const draft = el.querySelector('[data-draft]')!;
    expect(draft.textContent!.trim()).toBe('Draft v4');
    expect(draft.querySelector('[data-tone=warning]')).not.toBeNull();
    expect(draft.querySelector('.pi')).not.toBeNull();
    expect(text(el)).toContain('Published v3');
  });

  it('nothing published: a neutral "No published fields" badge with an icon, no count or date; a draft may follow', () => {
    const { f, el } = create();
    f.componentInstance.pub.set(null);
    f.componentInstance.draft.set(1);
    f.detectChanges();
    const none = el.querySelector('[data-none]')!;
    expect(none.textContent!.trim()).toBe('No published fields');
    expect(none.querySelector('[data-tone=neutral]')).not.toBeNull();
    expect(none.querySelector('.pi')).not.toBeNull();
    expect(el.querySelector('[data-facts]')).toBeNull();
    expect(Array.from(el.querySelectorAll('mf-badge')).map((b) => b.textContent!.trim())).toEqual([
      'No published fields',
      'Draft v1',
    ]);
  });

  it('one field is singular; a number or date the API did not return leaves its words out; another year shows the year', () => {
    const { f, el } = create();
    f.componentInstance.fields.set(1);
    f.componentInstance.at.set('2025-03-02T15:00:00Z');
    f.detectChanges();
    expect(el.querySelector('[data-facts]')!.textContent).toBe('1 field · Updated Mar 2, 2025');
    f.componentInstance.fields.set(null);
    f.componentInstance.at.set(null);
    f.detectChanges();
    expect(el.querySelector('[data-facts]')).toBeNull();
    expect(text(el)).toBe('Published v3');
  });
});
