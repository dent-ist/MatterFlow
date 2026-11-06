import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GridFrame } from './grid-frame';

@Component({
  selector: 'mf-test-grid',
  imports: [GridFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-grid-frame scrollLabel="Test list">
      <table class="tt">
        <thead>
          <tr>
            <th>Name</th>
            <th>Roles</th>
            <th>Status</th>
          </tr>
          <tr class="mf-filter-row">
            <td></td>
            <td></td>
            <td></td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>One</td>
            <td>Two</td>
            <td>Three</td>
          </tr>
        </tbody>
      </table>
    </mf-grid-frame>
  `,
})
class Host {}

/**
 * The two header bands of the shared grid (#1259): every heading cell sticks at the top, every filter cell right under it, the pinned first
 * column of both bands one layer above the pinned row cells, so nothing but the rows scrolls. (The browser check of the real lists, including
 * the global `.mf-rz` rule that once beat this one, is e2e/tests/grid-sticky-bands.spec.ts.)
 */
describe('GridFrame header bands', () => {
  function cells(selector: string): HTMLElement[] {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    return [...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];
  }

  it('every heading cell is sticky at the top, opaque', () => {
    const heads = cells('.tt thead tr:first-child th');
    expect(heads.length).toBe(3);
    for (const th of heads) {
      const style = getComputedStyle(th);
      expect(style.position).toBe('sticky');
      expect(style.top).toBe('0px');
      expect(style.background).toContain('--mf-surface-alt');
    }
  });

  it('every filter cell, the first included, is sticky under the headings', () => {
    const filters = cells('.tt thead .mf-filter-row td');
    expect(filters.length).toBe(3);
    for (const td of filters) {
      const style = getComputedStyle(td);
      expect(style.position).toBe('sticky');
      expect(style.top).toContain('--mf-head-h');
      expect(style.background).toContain('--mf-surface-alt');
    }
  });

  it('the pinned first cell of both bands is above the pinned row cell', () => {
    const [head] = cells('.tt thead tr:first-child th');
    const [filter] = cells('.tt thead .mf-filter-row td');
    const [row] = cells('.tt tbody td');
    expect(getComputedStyle(head).left).toBe('0px');
    expect(getComputedStyle(filter).left).toBe('0px');
    const rowLayer = Number(getComputedStyle(row).zIndex);
    expect(Number(getComputedStyle(head).zIndex)).toBeGreaterThan(rowLayer);
    expect(Number(getComputedStyle(filter).zIndex)).toBeGreaterThan(rowLayer);
  });
});
