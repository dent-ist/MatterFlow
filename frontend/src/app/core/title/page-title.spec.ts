import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { MfTitleStrategy, PageTitle, documentTitle, recordTitle } from './page-title';

@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class Blank {}

describe('document title (UXR-01)', () => {
  it('formats "<page> - MatterFlow" and falls back to the app name', () => {
    expect(documentTitle('Clients')).toBe('Clients - MatterFlow');
    expect(documentTitle('  ')).toBe('MatterFlow');
    expect(documentTitle(undefined)).toBe('MatterFlow');
  });

  it('names the record and the tab, cutting a long record text at 60 characters (#248)', () => {
    expect(recordTitle('00107 Hartwell & Bryce LLP', 'Matters')).toBe(
      '00107 Hartwell & Bryce LLP: Matters',
    );
    expect(documentTitle(recordTitle('00107-00001 Merger', 'Tasks'))).toBe(
      '00107-00001 Merger: Tasks - MatterFlow',
    );
    const long = 'M'.repeat(150);
    const title = recordTitle(`00107-00001 ${long}`, 'Details');
    expect(title).toBe(`${('00107-00001 ' + long).slice(0, 60)}…: Details`);
    expect(recordTitle('x'.repeat(60), 'Details')).toBe(`${'x'.repeat(60)}: Details`); // exactly 60 is kept
  });

  it('sets the title from the route and lets a detail page refine it', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'clients', title: 'Clients', component: Blank },
          { path: 'tasks/:id', title: 'Task', component: Blank },
        ]),
        { provide: TitleStrategy, useExisting: MfTitleStrategy },
      ],
    });
    const router = TestBed.inject(Router);
    const title = TestBed.inject(Title);

    await router.navigateByUrl('/clients');
    expect(title.getTitle()).toBe('Clients - MatterFlow');

    await router.navigateByUrl('/tasks/12');
    expect(title.getTitle()).toBe('Task - MatterFlow');
    TestBed.inject(PageTitle).set('TSK-12 Load Jones mailbox');
    expect(title.getTitle()).toBe('TSK-12 Load Jones mailbox - MatterFlow');

    await router.navigateByUrl('/clients');
    expect(title.getTitle()).toBe('Clients - MatterFlow');
  });

  it('keeps a pinned list-page name through query-parameter navigations until the page unpins it', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'my-work', title: 'My Work', component: Blank },
          { path: 'clients', title: 'Clients', component: Blank },
        ]),
        { provide: TitleStrategy, useExisting: MfTitleStrategy },
      ],
    });
    const router = TestBed.inject(Router);
    const title = TestBed.inject(Title);
    const page = TestBed.inject(PageTitle);

    await router.navigateByUrl('/my-work');
    page.pin('My Work: Closed');
    expect(title.getTitle()).toBe('My Work: Closed - MatterFlow');
    await router.navigateByUrl('/my-work?view=completed');
    expect(title.getTitle()).toBe('My Work: Closed - MatterFlow');

    page.unpin();
    await router.navigateByUrl('/clients');
    expect(title.getTitle()).toBe('Clients - MatterFlow');
  });
});
