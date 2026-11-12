import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { MatterResponse, MattersClient } from '../../../api/generated/api-client';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { PageHeader } from '../../../shared/ui/page-header';
import { MatterForm } from '../ui/matter-form';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * New Matter and Edit Matter as full pages (epic #1368: #1371 made New a page, #1381 made Edit one too, like the Client pages). One component, two routes: `/matters/new`
 * (`?clientId=5` preselects the client) and `/matters/:matterId/edit`. The fields, their order, labels, help texts and validation are the matter form (`MatterForm`), the same
 * for both. Cancel and a successful Edit go back to the page the person came from (the Matter page, the Matters list with its filters, a Client page), the page of the matter
 * (Edit) or the Matters list (New) when the page was opened directly; a created matter opens its own page. After a confirmed loss of access (marking a matter sensitive) the
 * Matters list opens, because the matter page would answer "not found". Leaving with typed values asks first (the unsaved-changes guard of the route).
 */
@Component({
  selector: 'mf-matter-form-page',
  imports: [Button, PageHeader, MatterForm, ErrorReference],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-page-header
      [crumbs]="[
        { label: 'Matters', link: '/matters' },
        { label: isEdit() ? original()?.name || 'Edit' : 'New' },
      ]"
      [heading]="isEdit() ? 'Edit Matter' : 'New Matter'"
    />
    @if (state() === 'loading') {
      <div class="pg-state" role="status" aria-busy="true">Loading matter...</div>
    } @else if (state() === 'error') {
      <div class="pg-alert" role="alert">
        We couldn't load that.
        <mf-error-reference />
        <p-button label="Retry" severity="secondary" (onClick)="load()" />
      </div>
    } @else {
      <div class="pg-form" data-matter-form>
        @if (form()?.error(); as problem) {
          <div class="pg-alert" role="alert" data-form-error>{{ problem }}</div>
        }
        <mf-matter-form
          [matter]="original()"
          [clientId]="preselectedClient()"
          (saved)="done($event)"
          (lostAccess)="lost()"
        />
        <div class="pg-actions mf-form-actions--sticky">
          <p-button label="Cancel" severity="secondary" data-cancel (onClick)="cancel()" />
          <p-button
            type="button"
            data-save
            [label]="form()?.busy() ? 'Saving...' : isEdit() ? 'Save Changes' : 'Create Matter'"
            [disabled]="form()?.busy() ?? false"
            (onClick)="form()?.save()"
          />
        </div>
      </div>
    }
  `,
})
export class MatterFormPage implements HasUnsavedChanges {
  /** Route parameter; absent when creating. */
  readonly matterId = input<string>();
  /** Query parameter: preselects the Client when creating from a Client page. */
  readonly clientId = input<string>();

  private readonly api = inject(MattersClient);
  private readonly router = inject(Router);
  protected readonly form = viewChild(MatterForm);
  protected readonly isEdit = computed(() => this.matterId() !== undefined);
  protected readonly state = signal<LoadState>('ready');
  protected readonly original = signal<MatterResponse | null>(null);
  protected readonly preselectedClient = computed(() => {
    const id = Number(this.clientId());
    return !this.isEdit() && Number.isInteger(id) && id > 0 ? id : null;
  });
  /** Where the person came from (the page before this navigation); read once, while the navigation that opens this page is still running. */
  private readonly previous = this.router
    .currentNavigation()
    ?.previousNavigation?.finalUrl?.toString();
  private finished = false;

  constructor() {
    effect(() => {
      if (this.matterId() !== undefined) untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      this.original.set(await firstValueFrom(this.api.getMatter(Number(this.matterId()))));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  hasUnsavedChanges(): boolean {
    return !this.finished && (this.form()?.dirty() ?? false);
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  /** Created: the new matter's page. Saved: back to where the person came from. */
  protected done(matter: MatterResponse): void {
    this.finished = true;
    if (this.isEdit()) void this.router.navigateByUrl(this.origin());
    else void this.router.navigate(['/matters', matter.matterId]);
  }

  /** The editor marked the matter sensitive and no longer sees it: the Matters list. */
  protected lost(): void {
    this.finished = true;
    void this.router.navigateByUrl('/matters');
  }

  protected cancel(): void {
    void this.router.navigateByUrl(this.origin());
  }

  /** The address of the previous page when it was one of this app's pages other than a Matter form page; else the matter's page (Edit) or the Matters list (New). */
  private origin(): string {
    const own = /^\/matters\/(new|\d+\/edit)(\?|$)/;
    if (this.previous && this.previous.startsWith('/') && !own.test(this.previous))
      return this.previous;
    const id = this.matterId();
    return id !== undefined ? `/matters/${id}` : '/matters';
  }
}
