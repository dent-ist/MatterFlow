import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ViewStateService } from '../../core/views/view-state.service';
import { ViewState } from '../../core/views/view-state';
import { ViewsMenu } from './views-menu';

const view = (id: number, name: string, isDefault = false, state: ViewState = { q: name }) => ({
  id,
  surface: 'task-queue',
  name,
  isDefault,
  state,
  modifiedAtUtc: '2026-10-26T12:00:00Z',
  rowVersion: `rv${id}`,
});

@Component({
  imports: [ViewsMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-views-menu surface="task-queue" [capture]="capture" [apply]="apply" />`,
})
class Host {
  capture = (): ViewState => ({ query: { status: ['NEW'] } });
  apply = vi.fn();
}

describe('ViewsMenu (PV-29)', () => {
  const store = {
    listNamed: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    cacheDefault: vi.fn(),
  };

  async function mount() {
    TestBed.configureTestingModule({ providers: [{ provide: ViewStateService, useValue: store }] });
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const details = el.querySelector<HTMLDetailsElement>('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await f.whenStable();
    f.detectChanges();
    return { f, el };
  }
  const click = async (
    f: { detectChanges(): void; whenStable(): Promise<unknown> },
    e: Element,
  ) => {
    (e as HTMLElement).click();
    await f.whenStable();
    f.detectChanges();
  };
  const type = (el: HTMLElement, selector: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  beforeEach(() => {
    Object.values(store).forEach((m) => m.mockReset());
    store.listNamed.mockResolvedValue([view(1, 'Intake'), view(2, 'Production', true)]);
  });

  it('reads the views when it first opens, and marks the default', async () => {
    const { el } = await mount();
    expect(store.listNamed).toHaveBeenCalledWith('task-queue');
    expect(
      Array.from(el.querySelectorAll('[data-view-row]')).map((r) =>
        r.getAttribute('data-view-name'),
      ),
    ).toEqual(['Intake', 'Production']);
    expect(el.querySelectorAll('[data-view-default]')).toHaveLength(1);
    // The default's state is kept for the first paint of the list.
    expect(store.cacheDefault).toHaveBeenCalledWith('task-queue', { q: 'Production' });
  });

  it('applies a view and closes the menu', async () => {
    const { f, el } = await mount();
    await click(f, el.querySelector('[data-view-apply]')!);
    expect(f.componentInstance.apply).toHaveBeenCalledWith({ q: 'Intake' });
    expect(el.querySelector('details')!.open).toBe(false);
  });

  it('saves the current state under a name, and says why a name is refused', async () => {
    store.create.mockResolvedValueOnce(view(3, 'Open work'));
    const { f, el } = await mount();
    await click(f, el.querySelector('[data-view-save]')!);
    expect(el.querySelector('[data-view-form-error]')!.textContent).toContain('Enter a name');
    type(el, '[data-view-name-input]', 'Open work');
    await click(f, el.querySelector('[data-view-save]')!);
    expect(store.create).toHaveBeenCalledWith('task-queue', 'Open work', {
      query: { status: ['NEW'] },
    });
    expect(el.querySelectorAll('[data-view-row]')).toHaveLength(3);
    expect(el.querySelector('[data-views-status]')!.textContent).toContain(
      'Saved the view Open work',
    );
  });

  it('renames a view in place', async () => {
    store.update.mockResolvedValueOnce(view(1, 'Intake today'));
    const { f, el } = await mount();
    await click(f, el.querySelector('[data-view-rename]')!);
    type(el, '[data-view-rename-input]', 'Intake today');
    await click(f, el.querySelector('[data-view-rename-save]')!);
    expect(store.update).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), {
      name: 'Intake today',
    });
    expect(el.querySelector('[data-view-row]')!.getAttribute('data-view-name')).toBe(
      'Intake today',
    );
  });

  it('asks before it deletes', async () => {
    store.remove.mockResolvedValueOnce(undefined);
    const { f, el } = await mount();
    await click(f, el.querySelector('[data-view-delete]')!);
    expect(store.remove).not.toHaveBeenCalled();
    await click(f, el.querySelector('[data-view-delete-confirm]')!);
    expect(store.remove).toHaveBeenCalledTimes(1);
    expect(el.querySelectorAll('[data-view-row]')).toHaveLength(1);
  });

  it('sets a view as the default and reads the list again', async () => {
    store.update.mockResolvedValueOnce(view(1, 'Intake', true));
    store.listNamed.mockResolvedValueOnce([view(1, 'Intake'), view(2, 'Production', true)]);
    const { f, el } = await mount();
    store.listNamed.mockResolvedValueOnce([view(1, 'Intake', true), view(2, 'Production')]);
    await click(f, el.querySelector('[data-view-default-toggle]')!);
    expect(store.update).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), {
      isDefault: true,
    });
    expect(store.cacheDefault).toHaveBeenLastCalledWith('task-queue', { q: 'Intake' });
  });

  it('says so when the views cannot be read, and offers a retry', async () => {
    store.listNamed.mockRejectedValue(new Error('down'));
    const { f, el } = await mount();
    await new Promise((r) => setTimeout(r));
    f.detectChanges();
    expect(el.querySelector('[data-views-error]')).not.toBeNull();
  });
});
