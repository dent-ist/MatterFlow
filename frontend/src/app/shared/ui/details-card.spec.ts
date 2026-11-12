import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DetailField, DetailsCard, DetailsGroup } from './details-card';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DetailsCard, DetailField, DetailsGroup],
  template: `
    <mf-details-card title="Details">
      <div mfDetailField label="Status">Active</div>
      <div mfDetailField label="Description" wide>Long text</div>
    </mf-details-card>
    <mf-details-card title="Relativity Workspace Fields" [count]="8">
      <p data-extra>Body</p>
    </mf-details-card>
    <mf-details-card title="Details" threeColumns scrollLabel="Matter details, scrollable">
      <div mfDetailField label="Client">Acme</div>
    </mf-details-card>
    <mf-details-card title="Details" data-grouped>
      <section mfDetailsGroup heading="Matter">
        <div mfDetailField label="CM Number">1-2</div>
        <div mfDetailField label="Matter Name" wide>Acme v. Beta</div>
      </section>
      <section mfDetailsGroup heading="Paths">
        <div mfDetailField label="DMS Path" wide>\\fs01</div>
      </section>
      <p mfDetailsFoot data-foot>Created 10/05</p>
    </mf-details-card>
  `,
})
class Host {}

describe('DetailsCard (D-44f)', () => {
  function render(): HTMLElement {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  it('is one mf-card with an h2 title, valid dl > div > dt + dd markup and the label above the value', () => {
    const el = render();
    const card = el.querySelector('mf-details-card')!;
    expect(card.querySelectorAll('section.mf-card')).toHaveLength(1);
    const title = card.querySelector('h2.mf-card__title')!;
    expect(title.textContent).toBe('Details');
    expect(card.querySelector('section')?.getAttribute('aria-labelledby')).toBe(title.id);
    const fields = card.querySelectorAll('dl > div[mfDetailField]');
    expect(fields).toHaveLength(2);
    expect(fields[0].querySelector('dt')?.textContent).toBe('Status');
    expect(fields[0].querySelector('dd')?.textContent?.trim()).toBe('Active');
    expect(card.querySelector('mf-count-chip')).toBeNull();
  });

  it('a wide field spans both columns', () => {
    const el = render();
    const fields = el.querySelectorAll('mf-details-card:first-of-type [mfDetailField]');
    expect(fields[0].classList.contains('df--wide')).toBe(false);
    expect(fields[1].classList.contains('df--wide')).toBe(true);
  });

  it('shows the count chip beside the title and puts other content below the fields', () => {
    const el = render();
    const second = el.querySelectorAll('mf-details-card')[1];
    expect(second.querySelector('mf-count-chip')?.textContent?.trim()).toBe('8');
    expect(second.querySelector('[data-extra]')?.textContent).toBe('Body');
    expect(second.querySelector('dl [data-extra]')).toBeNull();
  });

  it('the Matter Summary options: three columns and a focusable scroll region with its own name (#1253)', () => {
    const el = render();
    const cards = el.querySelectorAll('mf-details-card');
    expect(cards[0].classList.contains('dc--cols3')).toBe(false);
    expect(cards[0].querySelector('[role=region]')).toBeNull();
    expect(cards[2].classList.contains('dc--cols3')).toBe(true);
    expect(cards[2].classList.contains('dc--scroll')).toBe(true);
    const region = cards[2].querySelector('[role=region]')!;
    expect(region.getAttribute('aria-label')).toBe('Matter details, scrollable');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.querySelector('dl')).not.toBeNull();
  });

  it('a group is a section with an h3 sub-heading and its own dl; the foot slot is below the body, outside the scroll region (#1376)', () => {
    const el = render();
    const card = el.querySelector('mf-details-card[data-grouped]')!;
    const groups = card.querySelectorAll('section[mfDetailsGroup]');
    expect(groups).toHaveLength(2);
    const heading = groups[0].querySelector('h3[data-details-group]')!;
    expect(heading.textContent).toBe('Matter');
    expect(groups[0].getAttribute('aria-labelledby')).toBe(heading.id);
    expect(groups[0].querySelectorAll('dl > div[mfDetailField]')).toHaveLength(2);
    expect(groups[0].querySelectorAll('.df--wide')).toHaveLength(1);
    expect(card.querySelector('[data-foot]')!.closest('.dc__body')).toBeNull();
    expect(card.querySelector('.dc__body')!.contains(groups[1])).toBe(true);
  });
});
