import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NoteTagResponse, NoteTagsClient } from '../../../api/generated/api-client';
import {
  FakeMeApi,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { NoteTagsPage } from './note-tags-page';

const tag = (id: number, name: string): NoteTagResponse => ({
  noteTagId: id,
  name,
  colourKey: 'blue',
  isActive: true,
  visibleNoteCount: 0,
  isInUse: false,
  rowVersion: `RV${id}`,
});

@Component({
  imports: [NoteTagsPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-note-tags-page [edit]="edit()" />`,
})
class Host {
  readonly edit = signal<string | undefined>(undefined);
}

describe('NoteTagsPage: ?edit= of the Lists address (#1339)', () => {
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);

  async function start(edit?: string) {
    document.body.querySelectorAll('.p-dialog-mask').forEach((e) => e.remove());
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions('StatusLabel.Manage'))),
        {
          provide: NoteTagsClient,
          useValue: {
            listNoteTags: vi.fn().mockReturnValue(ok([tag(1, 'Privileged'), tag(2, 'Draft')])),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Host);
    f.componentInstance.edit.set(edit);
    document.body.appendChild(f.nativeElement);
    await settle(f);
    return f;
  }

  it('?edit=new opens New Tag', async () => {
    await start('new');
    expect(q('[data-panel-title]')!.textContent).toContain('New Tag');
  });

  it('?edit=<id> opens Edit Tag with the name of that tag', async () => {
    await start('2');
    expect(q('[data-panel-title]')!.textContent).toContain('Edit Tag');
    expect((q('#nt-name') as HTMLInputElement).value).toBe('Draft');
  });

  it('an unknown id opens nothing and is taken off the address', async () => {
    const go = vi.spyOn(Router.prototype, 'navigate');
    await start('99');
    expect(q('[data-panel-title]')).toBeNull();
    expect(go).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { edit: null } }));
    go.mockRestore();
  });
});
