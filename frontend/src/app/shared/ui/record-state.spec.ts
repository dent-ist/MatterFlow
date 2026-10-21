import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../testing/org-testing';
import { ApiError } from '../../core/http/api-error';
import {
  RecordKind,
  RecordLoadState,
  RecordState,
  recordFailureOf,
  recordStateText,
  recordStateTitle,
} from './record-state';

const apiError = (status: number) => ApiError.from(new HttpErrorResponse({ status, error: {} }));

describe('record load states (#246)', () => {
  it('maps the status to a state: 404 not found, 403 forbidden, everything else a failure to retry', () => {
    expect(recordFailureOf(apiError(404))).toBe('notFound');
    expect(recordFailureOf(apiError(403))).toBe('forbidden');
    expect(recordFailureOf(apiError(500))).toBe('error');
    expect(recordFailureOf(apiError(503))).toBe('error');
    expect(recordFailureOf(apiError(0))).toBe('error'); // lost connection
    expect(recordFailureOf(apiError(409))).toBe('error');
    expect(recordFailureOf(new Error('timeout'))).toBe('error');
    expect(recordFailureOf(undefined)).toBe('error');
  });

  it('has one wording per state for all three records', () => {
    const kinds: RecordKind[] = ['client', 'matter', 'project', 'task'];
    for (const kind of kinds) {
      expect(recordStateText(kind, 'notFound')).toBe(`We couldn't find that ${kind}.`);
      expect(recordStateText(kind, 'forbidden')).toBe(`You don't have access to this ${kind}.`);
      expect(recordStateText(kind, 'error')).toBe(`Couldn't load this ${kind}.`);
    }
  });
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RecordState],
  template: `<mf-record-state
    [kind]="kind()"
    recordId="99999"
    [state]="state()"
    [busy]="busy()"
    (retried)="retries = retries + 1"
  />`,
})
class Host {
  readonly kind = signal<RecordKind>('client');
  readonly state = signal<RecordLoadState>('notFound');
  readonly busy = signal(false);
  retries = 0;
}

describe('Administration record kinds (#353)', () => {
  it('words the three states for the four administration records and names the tab title', () => {
    const nouns: [RecordKind, string, string][] = [
      ['taskType', 'task type', 'Task type'],
      ['workflow', 'workflow', 'Workflow'],
      ['workflowVersion', 'workflow version', 'Workflow version'],
      ['step', 'step', 'Step'],
      ['assetType', 'asset type', 'Asset type'],
      ['customField', 'object', 'Object'],
    ];
    for (const [kind, noun, name] of nouns) {
      expect(recordStateText(kind, 'notFound')).toBe(`We couldn't find that ${noun}.`);
      expect(recordStateText(kind, 'forbidden')).toBe(`You don't have access to this ${noun}.`);
      expect(recordStateText(kind, 'error')).toBe(`Couldn't load this ${noun}.`);
      expect(recordStateTitle(kind, 'notFound')).toBe(`${name} not found`);
      expect(recordStateTitle(kind, 'forbidden')).toBe(`No access to this ${noun}`);
      expect(recordStateTitle(kind, 'error')).toBe(`${name} could not be loaded`);
    }
  });
});

describe('mf-record-state', () => {
  async function render(
    permissions: string[] = ['Client.View', 'Matter.View', 'Project.View', 'Task.View'],
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...(permissions as never[])))),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    };
    return { fixture, el, host: fixture.componentInstance, settle };
  }

  it('shows the Administration crumb with the parent workflow and never the id (#353)', async () => {
    const { el, host, settle } = await render(['Workflow.Manage']);
    host.kind.set('workflowVersion');
    await settle();
    const crumbs = Array.from(el.querySelectorAll('nav li')).map((li) => li.textContent!.trim());
    expect(crumbs).toEqual(['Administration', 'Task Types', 'Workflows', 'Version']);
    expect(el.textContent).not.toContain('99999');
    expect(el.querySelector('[data-back-link]')!.getAttribute('href')).toBe('/admin/workflows');
  });

  it('names the Asset Types and Custom Fields pages in the crumb and links back to them (#541)', async () => {
    const { el, host, settle } = await render(['AssetType.Manage', 'CustomField.Manage']);
    host.kind.set('assetType');
    await settle();
    const crumbs = () =>
      Array.from(el.querySelectorAll('nav li')).map((li) => li.textContent!.trim());
    expect(crumbs()).toEqual(['Administration', 'Asset Types', 'Asset type']);
    expect(el.querySelector('h1')!.textContent).toBe("We couldn't find that asset type.");
    expect(el.querySelector('[data-back-link]')!.getAttribute('href')).toBe('/admin/asset-types');
    expect(el.querySelector('[data-back-link]')!.textContent).toContain('Go to Asset Types');

    host.kind.set('customField');
    await settle();
    expect(crumbs()).toEqual(['Administration', 'Custom Fields', 'Object']);
    expect(el.querySelector('h1')!.textContent).toBe("We couldn't find that object.");
    expect(el.querySelector('[data-back-link]')!.getAttribute('href')).toBe('/admin/custom-fields');
    expect(el.textContent).not.toContain('99999');
  });

  it('shows the not-found text, the crumb and a link to the list, without Retry', async () => {
    const { el } = await render();
    expect(el.querySelector('h1')?.textContent).toContain("We couldn't find that client.");
    expect(el.querySelector('nav[aria-label=Breadcrumb]')?.textContent).toContain('Clients');
    expect(el.querySelector('nav[aria-label=Breadcrumb]')?.textContent).toContain('Client 99999');
    expect(el.querySelector('[data-back-link]')?.getAttribute('href')).toBe('/clients');
    expect(el.querySelector('[data-retry]')).toBeNull();
  });

  it('shows the access text without Retry for a 403', async () => {
    const { el, host, settle } = await render();
    host.kind.set('matter');
    host.state.set('forbidden');
    await settle();
    expect(el.querySelector('h1')?.textContent).toContain("You don't have access to this matter.");
    expect(el.querySelector('[data-back-link]')?.getAttribute('href')).toBe('/matters');
    expect(el.querySelector('[data-retry]')).toBeNull();
  });

  it('shows "Couldn\'t load" with Retry for a failure, and Retry asks the page to load again', async () => {
    const { el, host, settle } = await render();
    host.kind.set('project');
    host.state.set('error');
    await settle();
    expect(el.querySelector('h1')?.textContent).toContain("Couldn't load this project.");
    expect(el.querySelector('[data-back-link]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-retry] button, button[data-retry]')!.click();
    expect(host.retries).toBe(1);
  });

  it('ignores Retry while a retry is running and keeps the button where it is', async () => {
    const { el, host, settle } = await render();
    host.state.set('error');
    host.busy.set(true);
    await settle();
    const button = el.querySelector<HTMLButtonElement>('[data-retry] button, button[data-retry]')!;
    expect(button.disabled).toBe(false); // still focusable
    button.click();
    expect(host.retries).toBe(0);
  });

  it('task: names the task and goes back to the Task Queue', async () => {
    const { el, host, settle } = await render();
    host.kind.set('task');
    await settle();
    expect(el.querySelector('h1')?.textContent).toContain("We couldn't find that task.");
    expect(el.querySelector('nav[aria-label=Breadcrumb]')?.textContent).toContain('Task 99999');
    const link = el.querySelector('[data-back-link]')!;
    expect(link.getAttribute('href')).toBe('/tasks');
    expect(link.textContent).toContain('Go to Task Queue');
  });

  describe('the link of the 403 (BUG-4, #291)', () => {
    async function forbidden(permissions: string[]) {
      const r = await render(permissions);
      r.host.kind.set('task');
      r.host.state.set('forbidden');
      await r.settle();
      return r.el;
    }

    it("goes to the person's landing page, never to a page they cannot open (no Task.View)", async () => {
      const el = await forbidden(['Client.View', 'Matter.View']);
      const link = el.querySelector('[data-back-link]')!;
      expect(link.getAttribute('href')).toBe('/clients');
      expect(link.textContent).toContain('Go to Clients');
      expect(el.textContent).not.toContain('Go to Task Queue');
      expect(el.querySelector('nav[aria-label=Breadcrumb] a')).toBeNull();
    });

    it('takes the first page the landing rule finds: Matters when there is no Client.View', async () => {
      const el = await forbidden(['Matter.View']);
      expect(el.querySelector('[data-back-link]')?.getAttribute('href')).toBe('/matters');
    });

    it('shows no link when the person can open nothing', async () => {
      const el = await forbidden([]);
      expect(el.querySelector('[data-back-link]')).toBeNull();
      expect(el.querySelector('h1')?.textContent).toContain("You don't have access to this task.");
    });

    it('keeps the Task Queue for a person who may open it', async () => {
      const el = await forbidden(['Task.View']);
      expect(el.querySelector('[data-back-link]')?.getAttribute('href')).toBe('/tasks');
    });
  });
});
