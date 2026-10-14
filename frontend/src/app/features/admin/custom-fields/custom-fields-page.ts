import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { FormVersionStatus, FormsClient } from '../../../api/generated/api-client';
import { CUSTOM_FIELD_OBJECTS } from './custom-field-form-designer-api';
import { ErrorReference } from '../../../shared/ui/error-reference';

type LoadState = 'loading' | 'ready' | 'error';
type FormStatus = 'none' | 'draft' | 'published';

interface Row {
  key: string;
  label: string;
  status: FormStatus;
  /** Number of the published version, if any. */
  publishedNo?: number;
  /** True when a draft is open next to the published version. */
  hasDraft: boolean;
}

/**
 * Admin: Custom Fields (UX S18). Lists the objects that carry custom fields (Client, Matter, Project) with the state of each form;
 * `Edit fields` opens the shared form designer on the object's form. Needs `CustomField.Manage`.
 */
@Component({
  selector: 'mf-custom-fields-page',
  imports: [ErrorReference, RouterLink, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <header class="pg-head">
      <div>
        <h1 class="pg-title">Custom fields</h1>
        <p class="pg-muted">
          Extra fields for Clients, Matters and Projects. Fields are versioned: publishing a new
          version never changes values already saved, and existing records stay editable.
        </p>
      </div>
    </header>

    @switch (state()) {
      @case ('loading') {
        <div class="pg-state" role="status" aria-busy="true">Loading custom fields...</div>
      }
      @case ('error') {
        <div class="pg-alert" role="alert">
          We couldn't load the custom field forms.
          <mf-error-reference />
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }
      @case ('ready') {
        <table class="pg-table" data-objects>
          <caption class="pg-sr">
            Objects with custom fields
          </caption>
          <thead>
            <tr>
              <th scope="col">Object</th>
              <th scope="col">Form</th>
              <th scope="col"><span class="pg-sr">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.key) {
              <tr [attr.data-row]="r.label">
                <td>
                  <strong>{{ r.label }}</strong>
                </td>
                <td data-status>
                  @switch (r.status) {
                    @case ('published') {
                      <span class="pg-chip">Published v{{ r.publishedNo }}</span>
                      @if (r.hasDraft) {
                        <span class="pg-muted"> (draft in progress)</span>
                      }
                    }
                    @case ('draft') {
                      <span class="pg-chip pg-chip--inactive">Draft, not published</span>
                    }
                    @default {
                      <span class="pg-muted">No custom fields</span>
                    }
                  }
                </td>
                <td>
                  <a
                    class="pg-link"
                    [routerLink]="['/admin/custom-fields', r.key, 'form']"
                    [attr.aria-label]="'Edit fields of ' + r.label"
                    >Edit fields</a
                  >
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    }
  `,
})
export class CustomFieldsPage implements OnInit {
  private readonly forms = inject(FormsClient);

  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<Row[]>([]);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const rows = await Promise.all(
        CUSTOM_FIELD_OBJECTS.map(async (o): Promise<Row> => {
          // Idempotent: provisions the (empty) singleton definition the first time an admin looks at it.
          const definition = await firstValueFrom(
            this.forms.ensureFormDefinition({ ownerKind: o.kind }),
          );
          const published = definition.versions.find(
            (v) => v.status === FormVersionStatus.Published,
          );
          const hasDraft = definition.draftVersionId != null;
          return {
            key: o.key,
            label: o.label,
            status: published ? 'published' : hasDraft ? 'draft' : 'none',
            publishedNo: published?.versionNo,
            hasDraft: !!published && hasDraft,
          };
        }),
      );
      this.rows.set(rows);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }
}
