import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormDialog } from './form-dialog';

@Component({
  imports: [FormDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button id="opener" type="button">Open</button>
    <mf-form-dialog
      title="New project"
      primaryLabel="Create project"
      [dirty]="dirty()"
      [busy]="busy()"
      [error]="error()"
      [(visible)]="open"
      (submitted)="log.push('save')"
    >
      <input id="first" />
    </mf-form-dialog>`,
})
class Host {
  readonly open = signal(true);
  readonly dirty = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly log: string[] = [];
}

describe('FormDialog (MD-22, #1026)', () => {
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  async function start() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('puts Cancel on the left and the primary action on the right', async () => {
    await start();
    const names = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-panel-footer] button'),
    ).map((b) => b.textContent?.trim());
    expect(names).toEqual(['Cancel', 'Create project']);
  });

  it('submits from the primary button and ignores it while busy', async () => {
    const f = await start();
    q('[data-panel-primary] button')!.click();
    expect(f.componentInstance.log).toEqual(['save']);
    f.componentInstance.busy.set(true);
    f.detectChanges();
    q('[data-panel-primary] button')!.click();
    expect(f.componentInstance.log).toEqual(['save']);
  });

  it('closes at once when nothing changed', async () => {
    const f = await start();
    q('[data-panel-cancel] button')!.click();
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('asks before it discards unsaved changes', async () => {
    const f = await start();
    f.componentInstance.dirty.set(true);
    f.detectChanges();
    q('[data-panel-cancel] button')!.click();
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
    expect(q('[data-panel-guard]')).not.toBeNull();
    q('[data-guard-keep] button')!.click();
    f.detectChanges();
    expect(q('[data-panel-guard]')).toBeNull();
    q('[data-panel-close]')!.click();
    f.detectChanges();
    q('[data-guard-discard] button')!.click();
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('closes on Esc when clean and shows the guard on Esc when dirty', async () => {
    const f = await start();
    f.componentInstance.dirty.set(true);
    f.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(q('[data-panel-guard]')).not.toBeNull();
    expect(f.componentInstance.open()).toBe(true);
  });

  it('closes on Esc when nothing changed', async () => {
    const f = await start();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('leaves an Esc alone that closed a dropdown list inside the dialog', async () => {
    const f = await start();
    const list = document.createElement('div');
    list.setAttribute('role', 'listbox');
    document.body.appendChild(list);
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
    list.remove();
  });

  it('shows a save error as an alert', async () => {
    const f = await start();
    f.componentInstance.error.set('Could not save');
    f.detectChanges();
    expect(q('[data-panel-error]')?.getAttribute('role')).toBe('alert');
  });

  it('is a centred dialog, not a side panel, and has a size', async () => {
    await start();
    const dlg = q('.mf-formdlg');
    expect(dlg).not.toBeNull();
    expect(q('.mf-slide')).toBeNull();
    expect(q('.p-dialog-right')).toBeNull();
    expect(dlg?.style.width).toBe('var(--mf-dialog-w)');
  });

  it('uses the shared anatomy: close icon button, Keep Editing / Discard Changes, error with icon', async () => {
    const f = await start();
    expect(q('.mf-dlg')).not.toBeNull();
    expect(q('[data-panel-close]')?.classList.contains('mf-dlg__x')).toBe(true);
    expect(q('[data-panel-close] .pi-times')).not.toBeNull();
    f.componentInstance.error.set('Could not save');
    f.componentInstance.dirty.set(true);
    f.detectChanges();
    expect(q('[data-panel-error] .pi-exclamation-circle')).not.toBeNull();
    q('[data-panel-cancel] button')!.click();
    f.detectChanges();
    expect(q('[data-panel-guard]')?.textContent).toContain(
      'You have unsaved changes. Discard them?',
    );
    expect(q('[data-guard-keep] button')?.textContent?.trim()).toBe('Keep Editing');
    expect(q('[data-guard-discard] button')?.textContent?.trim()).toBe('Discard Changes');
  });

  it('is a modal dialog with an accessible name', async () => {
    await start();
    const dlg = q('.mf-formdlg');
    expect(dlg?.getAttribute('role')).toBe('dialog');
    expect(dlg?.getAttribute('aria-modal')).toBe('true');
  });
});

@Component({
  imports: [FormDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-form-dialog
    title="Assign Work"
    [secondaryLabel]="actions() ? 'Cancel' : 'Close'"
    [showPrimary]="false"
    [footerActions]="actions()"
    [visible]="true"
  >
    <p>Body</p>
    @if (actions()) {
      <span mfFooterActions class="mf-dlg__buttons-main">
        <button type="button" class="mf-btn" data-first>Assign 0 selected</button>
        <button type="button" class="mf-btn mf-btn--primary" data-second>Assign the next 3</button>
      </span>
    }
  </mf-form-dialog>`,
})
class ActionsHost {
  readonly actions = signal(true);
}

describe('FormDialog footer actions and the leave-over (#1217)', () => {
  const footer = () =>
    document.body.querySelector<HTMLElement>('[data-panel-footer] .mf-dlg__buttons')!;
  const names = () =>
    Array.from(footer().querySelectorAll('button')).map((b) => b.textContent?.trim());

  it('with its own actions: [Cancel] at the left, the actions at the right end (space-between)', async () => {
    const f = TestBed.createComponent(ActionsHost);
    await f.whenStable();
    f.detectChanges();
    expect(names()).toEqual(['Cancel', 'Assign 0 selected', 'Assign the next 3']);
    expect(footer().classList.contains('mf-dlg__buttons--end')).toBe(false);
  });

  it('without a primary and without actions: only [Close], right aligned', async () => {
    const f = TestBed.createComponent(ActionsHost);
    f.componentInstance.actions.set(false);
    await f.whenStable();
    f.detectChanges();
    expect(names()).toEqual(['Close']);
    expect(footer().classList.contains('mf-dlg__buttons--end')).toBe(true);
  });
});

describe('one dialog (D-31, #1217)', () => {
  it('no <p-dialog> is left outside the shared dialog components', () => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|html)$/.test(name) && !name.endsWith('.spec.ts')) {
          if (readFileSync(path, 'utf8').includes('<p-dialog'))
            found.push(path.replace(/\\/g, '/'));
        }
      }
    };
    walk(join(process.cwd(), 'src', 'app'));
    expect(found.map((f) => f.slice(f.indexOf('src/app/') + 8)).sort()).toEqual([
      'shared/ui/confirm-dialog.ts',
      'shared/ui/dialog-focus.ts',
      'shared/ui/form-dialog.ts',
      'shared/ui/lookup-dialog.ts',
      'shared/ui/slide-panel.ts',
    ]);
  });
});
