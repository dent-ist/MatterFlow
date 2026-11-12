import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { MatterResponse } from '../../../api/generated/api-client';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { PageHeader } from '../../../shared/ui/page-header';
import { MatterForm } from '../ui/matter-form';

/**
 * New Matter as a full page (epic #1368, issue #1371): the pop-up of the Matters list became a page of its own (`/matters/new`) because the matter keeps getting more fields.
 * The fields, their order, labels, help texts and validation are the matter form (`MatterForm`), the same one the Edit Matter pop-up holds. `?clientId=5` preselects the client
 * (the New Matter links of the Client pages). Cancel goes back to the page the person came from (the Matters list with its filters, a Client page), the Matters list when
 * the page was opened directly; a created matter opens its own page. Leaving with typed values asks first (the unsaved-changes guard of the route).
 */
@Component({
  selector: 'mf-matter-create-page',
  imports: [Button, PageHeader, MatterForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-page-header
      [crumbs]="[{ label: 'Matters', link: '/matters' }, { label: 'New' }]"
      heading="New Matter"
    />
    <div class="pg-form" data-matter-create>
      @if (form()?.error(); as problem) {
        <div class="pg-alert" role="alert" data-form-error>{{ problem }}</div>
      }
      <mf-matter-form [clientId]="preselectedClient()" (saved)="created($event)" />
      <div class="pg-actions mf-form-actions--sticky">
        <p-button label="Cancel" severity="secondary" data-cancel (onClick)="cancel()" />
        <p-button
          type="button"
          data-create
          [label]="form()?.busy() ? 'Saving...' : 'Create Matter'"
          [disabled]="form()?.busy() ?? false"
          (onClick)="form()?.save()"
        />
      </div>
    </div>
  `,
})
export class MatterCreatePage implements HasUnsavedChanges {
  /** Query parameter: preselects the Client when creating from a Client page. */
  readonly clientId = input<string>();

  private readonly router = inject(Router);
  protected readonly form = viewChild(MatterForm);
  protected readonly preselectedClient = computed(() => {
    const id = Number(this.clientId());
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  /** Where the person came from (the page before this navigation); read once, while the navigation that opens this page is still running. */
  private readonly origin = this.cameFrom();
  private done = false;

  hasUnsavedChanges(): boolean {
    return !this.done && (this.form()?.dirty() ?? false);
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  protected created(matter: MatterResponse): void {
    this.done = true;
    void this.router.navigate(['/matters', matter.matterId]);
  }

  protected cancel(): void {
    void this.router.navigateByUrl(this.origin);
  }

  /** The address of the previous page when it was one of this app's pages other than a New Matter page; else the Matters list. */
  private cameFrom(): string {
    const previous = this.router.currentNavigation()?.previousNavigation?.finalUrl?.toString();
    return previous && previous.startsWith('/') && !previous.startsWith('/matters/new')
      ? previous
      : '/matters';
  }
}
