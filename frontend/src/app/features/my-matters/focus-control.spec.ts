import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FocusControl } from './focus-control';
import { MyMattersFocus } from './focus';
import { SectionTypes } from './section-types';

describe('FocusControl (Options > Focus on task types, #1252)', () => {
  it('lists every task type with its coloured tile and its name', () => {
    const options = signal([
      { id: 1, name: 'Intake', iconKey: 'mail', colourKey: 'teal', active: true },
      { id: 2, name: 'Production', iconKey: 'mail', colourKey: 'blue', active: true },
    ]);
    TestBed.configureTestingModule({
      providers: [
        { provide: SectionTypes, useValue: { options, ensure: () => undefined } },
        {
          provide: MyMattersFocus,
          useValue: { types: signal<number[]>([]), ensure: () => undefined },
        },
      ],
    });
    const fixture = TestBed.createComponent(FocusControl);
    fixture.detectChanges();
    const rows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('label.fc__opt'),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.querySelector('[data-type-name]')?.textContent?.trim())).toEqual([
      'Intake',
      'Production',
    ]);
    expect(rows.every((r) => r.querySelector('[data-type-chip]') !== null)).toBe(true);
  });
});
