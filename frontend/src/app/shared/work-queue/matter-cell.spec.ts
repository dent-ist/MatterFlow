import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MatterCell, MatterCellRow, MatterNameCell } from './matter-cell';

const row = (overrides: Partial<MatterCellRow> = {}): MatterCellRow => ({
  matterId: 7,
  matterRef: '00343-00012',
  matterName: 'Merger Review',
  matterIsActive: true,
  clientName: 'Acme Corp',
  matterIsSensitive: true,
  ...overrides,
});

function mount<T>(type: new () => T, inputs: Record<string, unknown>): HTMLElement {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(type);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('Matter cells and the matter header of a sensitive matter (epic #788, mode H)', () => {
  it('links the reference and the name when the person may open matters', () => {
    expect(
      mount(MatterCell, { row: row(), link: true }).querySelector('a[href="/matters/7"]'),
    ).not.toBeNull();
    expect(
      mount(MatterNameCell, { row: row(), link: true }).querySelector('a[href="/matters/7"]'),
    ).not.toBeNull();
  });

  it('shows the header as plain text when the server says the matter cannot be opened', () => {
    const cell = mount(MatterCell, { row: row({ matterCanOpen: false }), link: true });
    expect(cell.textContent).toContain('00343-00012');
    expect(cell.querySelector('a')).toBeNull();
    const name = mount(MatterNameCell, { row: row({ matterCanOpen: false }), link: true });
    expect(name.textContent).toContain('Merger Review');
    expect(name.querySelector('a')).toBeNull();
  });

  it('treats an answer that is absent as "may open" (rows of other screens)', () => {
    expect(
      mount(MatterCell, { row: row({ matterCanOpen: undefined }), link: true }).querySelector('a'),
    ).not.toBeNull();
  });
});
