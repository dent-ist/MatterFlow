import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { BrandingAdminView, SettingsBrandingClient } from '../../../api/generated/api-client';
import { BrandingService } from '../../../core/branding/branding.service';
import { Branding, DEFAULT_APP_NAME } from '../../../core/branding/branding';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { PageHeader } from '../../../shared/ui/page-header';
import { Tabs, MfTab } from '../../../shared/ui/tabs';
import { TextField } from '../../../shared/ui/text-field';

type LoadState = 'loading' | 'ready' | 'error';

/** The toast after a successful save (design section 3). */
export const BRANDING_SAVED_TEXT = 'Saved. Other users see it the next time they load the page.';

/** The one tab today; the strip is there so later settings sections slot in. */
const TABS: readonly MfTab[] = [{ key: 'branding', label: 'Branding' }];

/** The built-in header mark, shown for "reset" and while no custom icon exists. */
const BUILT_IN_MARK = 'favicon.svg';

/** `2 KB`, `256 KB`, `812 bytes`: the size line under the chosen file. */
export function fileSizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const kb = bytes / 1024;
  return `${kb >= 10 ? Math.round(kb) : Math.round(kb * 10) / 10} KB`;
}

/** The local type the application bar needs, from the administration view. */
export function brandingOf(view: BrandingAdminView): Branding {
  const kind = view.iconKind;
  return {
    appName: view.appName,
    iconUrl: view.iconUrl ?? null,
    iconKind: kind === 'png' || kind === 'svg' || kind === 'ico' ? kind : null,
    version: view.version,
  };
}

/**
 * Administration > Settings > Branding (epic #850, BR-05; design docs/ux/app-settings/README.md section 3). One form card: the application name
 * (counter, Reset to default), the application icon (file picker, file name and size, Reset to default), a live preview of the browser tab and
 * the header, and the last change. Nothing changes until Save; Reset to default only fills the form, and Save then sends the reset. The limits
 * come from the server. Errors sit under the field with `aria-describedby` and an error summary is announced and focused after a failed save.
 * Needs `Settings.Manage` (route guard); keyboard only works end to end; no shortcuts are added.
 */
@Component({
  selector: 'mf-settings-page',
  imports: [Button, ErrorReference, MfDatePipe, PageHeader, Tabs, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-page-header
      heading="Settings"
      [crumbs]="crumbs"
      description="Application settings for everyone who uses this system."
    >
      <mf-tabs
        [tabs]="tabs"
        selected="branding"
        label="Settings sections"
        idPrefix="settings"
        data-settings-tabs
      />
    </mf-page-header>

    <div id="settings-panel" role="tabpanel" aria-labelledby="settings-tab-branding">
      @if (state() === 'loading') {
        <div class="pg-state" role="status" aria-busy="true">Loading...</div>
      } @else if (state() === 'error') {
        <div class="pg-alert" role="alert" data-load-error>
          We couldn't load the settings.
          <mf-error-reference />
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      } @else if (view(); as v) {
        @if (conflict()) {
          <div class="pg-alert st__wide" role="alert" data-conflict>
            Someone else changed the branding while you were editing. Reload to see the latest
            values; your changes on this page are not saved.
            <p-button label="Reload latest" severity="secondary" (onClick)="load()" />
          </div>
        }
        @if (summary().length > 0) {
          <div #summaryBox class="pg-summary st__wide" role="alert" tabindex="-1" data-summary>
            Fix the following to save:
            <ul>
              @for (message of summary(); track message) {
                <li>{{ message }}</li>
              }
            </ul>
          </div>
        }

        <form class="pg-form st__form" novalidate (submit)="$event.preventDefault(); save()">
          <section class="st__section" aria-labelledby="st-h-name" data-section="name">
            <h2 id="st-h-name" class="st__h">Application name</h2>
            <div class="st__row">
              <div class="st__grow">
                <mf-text-field
                  inputId="st-name"
                  label="Application name"
                  [required]="true"
                  [maxLength]="v.limits.appNameMaxLength"
                  [counter]="true"
                  help="Shown in the header, the browser tab and the sign-in page."
                  [error]="nameError()"
                  [value]="name()"
                  (valueChange)="onName($event)"
                />
              </div>
              <p-button
                type="button"
                label="Reset to default"
                severity="secondary"
                [outlined]="true"
                class="st__reset"
                data-reset-name
                [disabled]="busy() || !canResetName()"
                (onClick)="resetName()"
              />
            </div>
          </section>

          <section class="st__section" aria-labelledby="st-h-icon" data-section="icon">
            <h2 id="st-h-icon" class="st__h">Application icon</h2>
            <div class="st__icon">
              <div class="st__thumb" aria-hidden="true">
                <img [src]="iconPreview()" alt="" width="64" height="64" data-icon-thumb />
              </div>
              <div class="st__icon-body">
                <p class="mf-field__help" id="st-icon-help" data-icon-help>
                  PNG, SVG or ICO, square, at least {{ v.limits.iconMinPixels }} x
                  {{ v.limits.iconMinPixels }} pixels, up to {{ maxKb() }} KB.
                </p>
                <div class="st__buttons">
                  <p-button
                    type="button"
                    label="Choose file..."
                    severity="secondary"
                    data-choose-icon
                    aria-describedby="st-icon-help st-icon-file"
                    [disabled]="busy()"
                    (onClick)="picker.click()"
                  />
                  <p-button
                    type="button"
                    label="Reset to default"
                    severity="secondary"
                    [outlined]="true"
                    class="st__reset"
                    data-reset-icon
                    [disabled]="busy() || !canResetIcon()"
                    (onClick)="resetIcon()"
                  />
                </div>
                <input
                  #picker
                  id="st-icon"
                  class="st__file"
                  type="file"
                  tabindex="-1"
                  aria-hidden="true"
                  accept=".png,.svg,.ico,image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
                  data-icon-input
                  (change)="onFile($event)"
                />
                <p class="st__file-line" id="st-icon-file" data-icon-file>{{ iconLine() }}</p>
                @if (iconError(); as e) {
                  <p class="mf-field__error" role="alert" id="st-icon-error" data-icon-error>
                    <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
                  </p>
                }
              </div>
            </div>
          </section>

          <section class="st__section" aria-labelledby="st-h-preview" data-section="preview">
            <h2 id="st-h-preview" class="st__h">Preview</h2>
            <p class="mf-sr-only" data-preview-text>Header will read: {{ previewName() }}</p>
            <div class="st__preview" aria-hidden="true">
              <div class="st__prow">
                <span class="st__plabel">Browser tab:</span>
                <span class="st__tab" data-preview-tab>
                  <img [src]="iconPreview()" alt="" width="16" height="16" />
                  <span class="st__tab-text">Matters: Overview - {{ previewName() }}</span>
                </span>
              </div>
              <div class="st__prow">
                <span class="st__plabel">Header:</span>
                <span class="st__head" data-preview-header>
                  <img [src]="iconPreview()" alt="" width="28" height="28" />
                  <span class="st__head-text">{{ previewName() }}</span>
                </span>
              </div>
            </div>
          </section>

          @if (v.updatedAtUtc) {
            <p class="st__last" data-last-changed>
              Last changed {{ v.updatedAtUtc | mfDate }}
              @if (v.updatedBy) {
                by {{ v.updatedBy }}
              }
            </p>
          }

          <div class="pg-actions mf-form-actions--sticky st__actions">
            <p-button
              type="submit"
              [label]="busy() ? 'Saving...' : 'Save changes'"
              data-save
              [disabled]="busy() || !dirty()"
            />
            <p-button
              type="button"
              label="Cancel"
              severity="secondary"
              data-cancel
              [disabled]="busy() || !dirty()"
              (onClick)="cancel()"
            />
          </div>
        </form>
      }
    </div>
    <p class="mf-sr-only" role="status" aria-live="polite" data-settings-live>
      {{ announcement() }}
    </p>
  `,
  styles: `
    :host {
      display: block;
    }
    .st__form {
      max-width: 720px;
      min-width: 0;
    }
    .st__wide {
      max-width: 720px;
    }
    .st__section {
      display: grid;
      gap: var(--mf-s3);
      min-width: 0;
      padding-bottom: var(--mf-s4);
      border-bottom: 1px solid var(--mf-border);
    }
    .st__h {
      margin: 0;
      font-size: var(--mf-fs-h3);
    }
    .st__row {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s3);
      min-width: 0;
    }
    .st__grow {
      flex: 1 1 auto;
      min-width: 0;
    }
    .st__reset {
      flex: none;
      margin-top: 1.6rem;
    }
    .st__icon {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s4);
      min-width: 0;
    }
    .st__thumb {
      display: grid;
      flex: none;
      place-items: center;
      width: 72px;
      height: 72px;
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }
    .st__thumb img {
      width: 64px;
      height: 64px;
      object-fit: contain;
    }
    .st__icon-body {
      display: grid;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .st__buttons {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
    }
    .st__buttons .st__reset {
      margin-top: 0;
    }
    .st__file {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
    }
    .st__file-line {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      overflow-wrap: anywhere;
    }
    .st__preview {
      display: grid;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .st__prow {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
      min-width: 0;
    }
    .st__plabel {
      flex: none;
      min-width: 6.5rem;
      color: var(--mf-text-muted);
    }
    .st__tab,
    .st__head {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      max-width: 100%;
    }
    .st__tab {
      padding: var(--mf-s1) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius) var(--mf-radius) 0 0;
      background: var(--mf-surface);
      font-size: var(--mf-fs-sm);
    }
    .st__head {
      color: var(--mf-primary);
      font-size: var(--mf-fs-h3);
      font-weight: 600;
    }
    .st__tab img {
      flex: none;
      width: 16px;
      height: 16px;
      object-fit: contain;
    }
    .st__head img {
      flex: none;
      width: 28px;
      height: 28px;
      object-fit: contain;
    }
    .st__tab-text,
    .st__head-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .st__last {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    @media (max-width: 639.98px) {
      .st__row {
        flex-direction: column;
        align-items: stretch;
      }
      .st__reset {
        margin-top: 0;
      }
      .st__icon {
        flex-direction: column;
      }
      .st__icon-body {
        width: 100%;
      }
      .st__actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }
      .st__buttons ::ng-deep .p-button {
        width: 100%;
      }
      .st__buttons {
        display: grid;
      }
    }
  `,
})
export class SettingsPage implements OnInit, HasUnsavedChanges {
  private readonly api = inject(SettingsBrandingClient);
  private readonly notify = inject(NotificationService);
  private readonly brand = inject(BrandingService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly summaryBox = viewChild<ElementRef<HTMLElement>>('summaryBox');

  protected readonly crumbs = [{ label: 'Administration' }, { label: 'Settings' }];
  protected readonly tabs = TABS;

  protected readonly state = signal<LoadState>('loading');
  protected readonly view = signal<BrandingAdminView | null>(null);
  protected readonly busy = signal(false);
  protected readonly conflict = signal(false);
  protected readonly announcement = signal('');

  // ---- the draft (nothing is saved until Save)

  protected readonly name = signal('');
  private readonly nameReset = signal(false);
  private readonly file = signal<File | null>(null);
  private readonly iconReset = signal(false);
  private objectUrl: string | null = null;
  private readonly previewUrl = signal<string | null>(null);

  protected readonly nameError = signal('');
  protected readonly iconError = signal('');
  protected readonly summary = signal<readonly string[]>([]);

  protected readonly maxKb = computed(() =>
    Math.round((this.view()?.limits.iconMaxBytes ?? 0) / 1024),
  );

  protected readonly previewName = computed(() => this.name().trim() || DEFAULT_APP_NAME);

  /** The icon the preview shows: the chosen file, the built-in one after a reset, else what is saved. */
  protected readonly iconPreview = computed(() => {
    if (this.previewUrl()) return this.previewUrl()!;
    if (this.iconReset()) return BUILT_IN_MARK;
    return this.view()?.iconUrl ?? BUILT_IN_MARK;
  });

  protected readonly iconLine = computed(() => {
    const f = this.file();
    if (f) return `${f.name}, ${fileSizeText(f.size)}`;
    if (this.iconReset()) return 'Built-in icon (after Save).';
    const v = this.view();
    return v?.iconUrl ? `Custom icon, ${fileSizeText(v.iconBytes ?? 0)}` : 'Built-in icon.';
  });

  private readonly nameChanged = computed(() => {
    const v = this.view();
    if (!v) return false;
    return this.nameReset() ? v.appNameIsCustom : this.name().trim() !== v.appName;
  });
  private readonly iconChanged = computed(
    () => this.file() !== null || (this.iconReset() && !!this.view()?.iconUrl),
  );
  protected readonly dirty = computed(() => this.nameChanged() || this.iconChanged());

  protected readonly canResetName = computed(() => {
    const v = this.view();
    return (
      !!v && !this.nameReset() && (v.appNameIsCustom || this.name().trim() !== v.defaultAppName)
    );
  });
  protected readonly canResetIcon = computed(
    () => this.file() !== null || (!this.iconReset() && !!this.view()?.iconUrl),
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.revoke());
  }

  ngOnInit(): void {
    void this.load();
  }

  hasUnsavedChanges(): boolean {
    return this.state() === 'ready' && this.dirty();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    this.conflict.set(false);
    try {
      this.show(await firstValueFrom(this.api.getBrandingSettings()));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  /** Makes `v` the saved state and the draft equal to it. */
  private show(v: BrandingAdminView): void {
    this.view.set(v);
    this.draftFromView(v);
  }

  private draftFromView(v: BrandingAdminView): void {
    this.name.set(v.appName);
    this.nameReset.set(false);
    this.file.set(null);
    this.iconReset.set(false);
    this.setPreview(null);
    this.clearErrors();
  }

  private clearErrors(): void {
    this.nameError.set('');
    this.iconError.set('');
    this.summary.set([]);
  }

  private setPreview(next: string | null): void {
    this.revoke();
    this.objectUrl = next;
    this.previewUrl.set(next);
  }

  private revoke(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  // ---- editing

  protected onName(value: string): void {
    this.name.set(value);
    this.nameReset.set(false);
    this.nameError.set('');
  }

  protected resetName(): void {
    const v = this.view();
    if (!v) return;
    this.name.set(v.defaultAppName);
    this.nameReset.set(v.appNameIsCustom);
    this.nameError.set('');
    this.announcement.set(`Name reset to ${v.defaultAppName}. Save to apply.`);
  }

  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const chosen = input.files?.[0] ?? null;
    input.value = ''; // choosing the same file again must fire a change
    if (!chosen) return;
    this.iconError.set('');
    const max = this.view()?.limits.iconMaxBytes ?? Infinity;
    if (chosen.size > max) {
      // A courtesy before any upload; the server checks again (and decides by content, never by this size or the file name).
      this.iconError.set(`The icon is larger than ${this.maxKb()} KB.`);
      this.announcement.set(this.iconError());
      return;
    }
    this.file.set(chosen);
    this.iconReset.set(false);
    this.setPreview(URL.createObjectURL(chosen));
    this.announcement.set(`Icon chosen: ${chosen.name}. Save to apply.`);
  }

  protected resetIcon(): void {
    this.iconError.set('');
    this.file.set(null);
    this.setPreview(null);
    this.iconReset.set(!!this.view()?.iconUrl);
    this.announcement.set('Icon reset to the built-in icon. Save to apply.');
  }

  protected cancel(): void {
    const v = this.view();
    if (v) this.draftFromView(v);
    this.announcement.set('Changes discarded.');
  }

  // ---- saving

  protected async save(): Promise<void> {
    const start = this.view();
    if (!start || this.busy() || !this.dirty()) return;
    this.clearErrors();

    const name = this.name().trim();
    if (!this.nameReset() && name.length === 0) {
      this.fail('name', 'Enter an application name.');
      return;
    }

    this.busy.set(true);
    let latest = start;
    let failed = false;
    try {
      if (this.nameChanged()) {
        try {
          latest = this.nameReset()
            ? await firstValueFrom(this.api.resetBrandingName(latest.appNameRowVersion))
            : await firstValueFrom(
                this.api.setBrandingName({ appName: name, rowVersion: latest.appNameRowVersion }),
              );
          this.view.set(latest);
          this.name.set(latest.appName);
          this.nameReset.set(false);
        } catch (e) {
          failed = true;
          if (this.handleError(e, 'name')) return;
        }
      }

      const chosen = this.file();
      if (this.iconChanged() && !failed) {
        try {
          latest = chosen
            ? await firstValueFrom(
                this.api.setBrandingIcon(
                  { data: chosen, fileName: chosen.name },
                  latest.iconRowVersion,
                ),
              )
            : await firstValueFrom(this.api.resetBrandingIcon(latest.iconRowVersion));
          this.view.set(latest);
          this.file.set(null);
          this.iconReset.set(false);
          this.setPreview(null);
        } catch (e) {
          failed = true;
          if (this.handleError(e, 'file')) return;
        }
      }
    } finally {
      this.busy.set(false);
    }

    if (failed) {
      this.announceSummary();
      return;
    }

    this.brand.apply(brandingOf(latest));
    this.announcement.set(BRANDING_SAVED_TEXT);
    this.notify.success(BRANDING_SAVED_TEXT);
  }

  /** Shows a validation message under its field. Returns true when the whole save must stop (a conflict). */
  private handleError(e: unknown, field: 'name' | 'file'): boolean {
    if (!(e instanceof ApiError)) {
      this.addProblem(field, 'Couldn’t save. Try again.');
      return false;
    }
    if (e.code === 'CONCURRENCY_CONFLICT') {
      this.conflict.set(true);
      this.announcement.set('Someone else changed the branding. Reload to see the latest values.');
      return true;
    }
    const apiField = field === 'name' ? 'appName' : 'file';
    this.addProblem(field, e.problem?.errors?.[apiField]?.[0]?.message ?? e.message);
    return false;
  }

  private addProblem(field: 'name' | 'file', message: string): void {
    if (field === 'name') this.nameError.set(message);
    else this.iconError.set(message);
    this.summary.update((list) => [...list, message]);
  }

  private fail(field: 'name' | 'file', message: string): void {
    this.addProblem(field, message);
    this.announceSummary();
  }

  private announceSummary(): void {
    setTimeout(() => this.summaryBox()?.nativeElement.focus());
  }
}
