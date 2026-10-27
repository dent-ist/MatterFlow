import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { BrandingAdminView, SettingsBrandingClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { DEFAULT_BRANDING, applyBranding, currentBranding } from '../../../core/branding/branding';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { BRANDING_SAVED_TEXT, SettingsPage, brandingOf, fileSizeText } from './settings-page';

const view = (patch: Partial<BrandingAdminView> = {}): BrandingAdminView => ({
  appName: 'MatterFlow',
  defaultAppName: 'MatterFlow',
  appNameIsCustom: false,
  appNameRowVersion: '',
  iconUrl: undefined,
  iconKind: undefined,
  iconContentType: undefined,
  iconBytes: undefined,
  iconRowVersion: '',
  version: 'aaaaaaaaaaaa',
  updatedAtUtc: undefined,
  updatedBy: undefined,
  limits: {
    appNameMaxLength: 40,
    iconMaxBytes: 262144,
    iconMinPixels: 64,
    iconMaxPngPixels: 1024,
    iconTypes: ['png', 'svg', 'ico'],
  },
  ...patch,
});

function apiError(status: number, code: string, errors?: Record<string, string>): ApiError {
  const problem = {
    code,
    detail: errors ? Object.values(errors)[0] : code,
    errors: errors
      ? Object.fromEntries(Object.entries(errors).map(([k, m]) => [k, [{ code, message: m }]]))
      : undefined,
  };
  return new ApiError(
    status,
    code,
    problem.detail,
    problem,
    new HttpErrorResponse({ status, error: problem }),
  );
}

describe('SettingsPage: Administration > Settings > Branding (epic #850, BR-05)', () => {
  let api: Record<
    | 'getBrandingSettings'
    | 'setBrandingName'
    | 'setBrandingIcon'
    | 'resetBrandingName'
    | 'resetBrandingIcon',
    ReturnType<typeof vi.fn>
  >;
  let fixture: ComponentFixture<SettingsPage>;
  let toasts: string[];
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T | null =>
    el().querySelector<T>(sel);
  const text = (sel: string): string => q(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
    await fixture.whenStable();
  }

  async function open(initial = view()): Promise<void> {
    api = {
      getBrandingSettings: vi.fn().mockReturnValue(of(initial)),
      setBrandingName: vi.fn(),
      setBrandingIcon: vi.fn(),
      resetBrandingName: vi.fn(),
      resetBrandingIcon: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideFakeMe(new FakeMeApi(withPermissions('Settings.Manage'))),
        { provide: SettingsBrandingClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    toasts = [];
    vi.spyOn(TestBed.inject(NotificationService), 'success').mockImplementation((s) => {
      toasts.push(s);
    });
    fixture = TestBed.createComponent(SettingsPage);
    await settle();
  }

  async function typeName(value: string): Promise<void> {
    const input = q<HTMLInputElement>('#st-name')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  async function chooseFile(file: File): Promise<void> {
    const input = q<HTMLInputElement>('[data-icon-input]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle();
  }

  const click = async (sel: string): Promise<void> => {
    q<HTMLElement>(`${sel} button, button${sel}`)?.click();
    await settle();
  };

  const submit = async (): Promise<void> => {
    q<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();
  };

  beforeEach(() => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:preview-1');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    applyBranding(DEFAULT_BRANDING);
    vi.restoreAllMocks();
  });

  it('shows the header with the Administration crumb, the one Branding tab and the form', async () => {
    await open();
    expect(text('h1')).toContain('Settings');
    expect(text('nav[aria-label="Breadcrumb"]')).toContain('Administration');
    expect(text('nav[aria-label="Breadcrumb"]')).toContain('Settings');
    expect(el().querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(text('[role="tab"]')).toBe('Branding');
    expect(q<HTMLInputElement>('#st-name')!.value).toBe('MatterFlow');
    expect(text('#st-name-count')).toBe('10 / 40');
    expect(q('#st-name')!.getAttribute('maxlength')).toBe('40');
    expect(text('[data-icon-help]')).toContain('up to 256 KB');
    expect(text('[data-icon-help]')).toContain('at least 64 x 64 pixels');
    expect(text('[data-icon-file]')).toBe('Built-in icon.');
    expect(q('[data-last-changed]')).toBeNull();
  });

  it('shows the last change when there is one', async () => {
    await open(view({ updatedAtUtc: '2026-10-27T09:14:00Z', updatedBy: 'Dana Reyes' }));
    expect(text('[data-last-changed]')).toContain('Last changed');
    expect(text('[data-last-changed]')).toContain('by Dana Reyes');
  });

  it('shows a retry when the settings cannot be loaded', async () => {
    api = undefined as never;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideFakeMe(new FakeMeApi(withPermissions('Settings.Manage'))),
        {
          provide: SettingsBrandingClient,
          useValue: {
            getBrandingSettings: vi.fn().mockReturnValue(throwError(() => new Error('x'))),
          },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(SettingsPage);
    await settle();
    expect(q('[data-load-error]')).not.toBeNull();
    expect(q('form')).toBeNull();
  });

  it('keeps Save and Cancel off until something changes, and the preview follows the name as text', async () => {
    await open();
    expect(q<HTMLButtonElement>('[data-save] button, button[data-save]')?.disabled).toBe(true);
    await typeName('Smith & Co');
    expect(text('[data-preview-tab]')).toContain('Matters: Overview - Smith & Co');
    expect(text('[data-preview-header]')).toBe('Smith & Co');
    expect(text('[data-preview-text]')).toBe('Header will read: Smith & Co');
    expect(q('[data-save] button, button[data-save]')?.hasAttribute('disabled')).toBe(false);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    await typeName('MatterFlow');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('shows markup typed into the name as text in the preview', async () => {
    await open();
    await typeName('<img src=x onerror=alert(1)>');
    expect(text('[data-preview-header]')).toBe('<img src=x onerror=alert(1)>');
    expect(q('[data-preview-header] img[src="x"]')).toBeNull();
  });

  it('saves a changed name with its row version, toasts, and applies it to this tab at once', async () => {
    await open(view({ appNameIsCustom: true, appName: 'Old', appNameRowVersion: 'rv-1' }));
    api['setBrandingName'].mockReturnValue(
      of(
        view({
          appName: 'Smith & Co',
          appNameIsCustom: true,
          appNameRowVersion: 'rv-2',
          version: 'bbbbbbbbbbbb',
        }),
      ),
    );
    await typeName('  Smith & Co ');
    await submit();
    expect(api['setBrandingName']).toHaveBeenCalledWith({
      appName: 'Smith & Co',
      rowVersion: 'rv-1',
    });
    expect(api['setBrandingIcon']).not.toHaveBeenCalled();
    expect(toasts).toEqual([BRANDING_SAVED_TEXT]);
    expect(currentBranding().appName).toBe('Smith & Co');
    expect(q<HTMLInputElement>('#st-name')!.value).toBe('Smith & Co');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    expect(text('[data-settings-live]')).toBe(BRANDING_SAVED_TEXT);
  });

  it('keeps the document title in step when the name is saved', async () => {
    await open();
    TestBed.inject(Title).setTitle('Settings: Branding - MatterFlow');
    api['setBrandingName'].mockReturnValue(
      of(view({ appName: 'Acme', appNameIsCustom: true, appNameRowVersion: 'r' })),
    );
    await typeName('Acme');
    await submit();
    expect(document.title).toBe('Settings: Branding - Acme');
  });

  it('refuses an empty name before any request and puts the message under the field', async () => {
    await open();
    await typeName('   ');
    await submit();
    expect(api['setBrandingName']).not.toHaveBeenCalled();
    expect(text('#st-name-error')).toContain('Enter an application name.');
    expect(q('#st-name')!.getAttribute('aria-describedby')).toContain('st-name-error');
    expect(q('#st-name')!.getAttribute('aria-invalid')).toBe('true');
    expect(text('[data-summary]')).toContain('Enter an application name.');
    expect(q('[data-summary]')!.getAttribute('role')).toBe('alert');
  });

  it('shows the server message under the name field and in the summary, and saves nothing', async () => {
    await open();
    api['setBrandingName'].mockReturnValue(
      throwError(() =>
        apiError(400, 'BRANDING_NAME_INVALID_CHARS', {
          appName: 'The name cannot contain < or >.',
        }),
      ),
    );
    await typeName('a>b');
    await submit();
    expect(text('#st-name-error')).toContain('The name cannot contain < or >.');
    expect(text('[data-summary]')).toContain('The name cannot contain < or >.');
    expect(toasts).toEqual([]);
    expect(currentBranding().appName).toBe('MatterFlow');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
  });

  it('Reset to default fills the form, saves nothing until Save, and then sends the reset', async () => {
    await open(view({ appName: 'Acme', appNameIsCustom: true, appNameRowVersion: 'rv-9' }));
    api['resetBrandingName'].mockReturnValue(of(view()));
    await click('[data-reset-name]');
    expect(api['resetBrandingName']).not.toHaveBeenCalled();
    expect(q<HTMLInputElement>('#st-name')!.value).toBe('MatterFlow');
    expect(text('[data-preview-header]')).toBe('MatterFlow');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    await submit();
    expect(api['resetBrandingName']).toHaveBeenCalledWith('rv-9');
    expect(api['setBrandingName']).not.toHaveBeenCalled();
    expect(toasts).toEqual([BRANDING_SAVED_TEXT]);
    expect(currentBranding().appName).toBe('MatterFlow');
  });

  it('turns Reset to default off for a name that already is the default', async () => {
    await open();
    expect(
      q<HTMLButtonElement>('[data-reset-name] button, button[data-reset-name]')?.disabled,
    ).toBe(true);
    await typeName('Other');
    expect(
      q<HTMLButtonElement>('[data-reset-name] button, button[data-reset-name]')?.disabled,
    ).toBe(false);
  });

  it('previews a chosen file, shows its name and size, and uploads it with the icon row version on Save', async () => {
    await open(view({ iconRowVersion: 'ic-1' }));
    api['setBrandingIcon'].mockReturnValue(
      of(
        view({
          iconUrl: '/api/v1/branding/icon?v=cccccccccccc',
          iconKind: 'svg',
          iconContentType: 'image/svg+xml',
          iconBytes: 2048,
          iconRowVersion: 'ic-2',
          version: 'cccccccccccc',
        }),
      ),
    );
    const file = new File(['<svg/>'.repeat(300)], 'mf-logo.svg', { type: 'image/svg+xml' });
    await chooseFile(file);
    expect(text('[data-icon-file]')).toContain('mf-logo.svg, ');
    expect(q('[data-icon-thumb]')!.getAttribute('src')).toBe('blob:preview-1');
    expect(q('[data-preview-header] img')!.getAttribute('src')).toBe('blob:preview-1');
    await submit();
    const [param, version] = api['setBrandingIcon'].mock.calls[0];
    expect(param.fileName).toBe('mf-logo.svg');
    expect(param.data).toBe(file);
    expect(version).toBe('ic-1');
    expect(toasts).toEqual([BRANDING_SAVED_TEXT]);
    expect(currentBranding().iconUrl).toBe('/api/v1/branding/icon?v=cccccccccccc');
    expect(q('[data-icon-thumb]')!.getAttribute('src')).toBe(
      '/api/v1/branding/icon?v=cccccccccccc',
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });

  it('shows the server message under the file field and keeps the chosen file when the icon is refused', async () => {
    await open();
    api['setBrandingIcon'].mockReturnValue(
      throwError(() =>
        apiError(400, 'BRANDING_ICON_UNSAFE', {
          file: 'This SVG cannot be used: it contains a script.',
        }),
      ),
    );
    await chooseFile(new File(['x'], 'bad.svg', { type: 'image/svg+xml' }));
    await submit();
    expect(text('[data-icon-error]')).toContain('This SVG cannot be used');
    expect(text('[data-summary]')).toContain('This SVG cannot be used');
    expect(text('[data-icon-file]')).toContain('bad.svg');
    expect(toasts).toEqual([]);
    expect(currentBranding().iconUrl).toBeNull();
  });

  it('refuses a file over the server limit before uploading and keeps the earlier choice', async () => {
    await open();
    await chooseFile(new File([new Uint8Array(300 * 1024)], 'huge.png', { type: 'image/png' }));
    expect(text('[data-icon-error]')).toContain('larger than 256 KB');
    expect(text('[data-icon-file]')).toBe('Built-in icon.');
    expect(api['setBrandingIcon']).not.toHaveBeenCalled();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('Reset to default for the icon previews the built-in icon and sends the reset on Save', async () => {
    await open(
      view({
        iconUrl: '/api/v1/branding/icon?v=dddddddddddd',
        iconKind: 'png',
        iconBytes: 4096,
        iconRowVersion: 'ic-5',
      }),
    );
    api['resetBrandingIcon'].mockReturnValue(of(view()));
    expect(text('[data-icon-file]')).toContain('Custom icon, 4 KB');
    await click('[data-reset-icon]');
    expect(api['resetBrandingIcon']).not.toHaveBeenCalled();
    expect(q('[data-icon-thumb]')!.getAttribute('src')).toBe('favicon.svg');
    expect(text('[data-icon-file]')).toContain('Built-in icon');
    await submit();
    expect(api['resetBrandingIcon']).toHaveBeenCalledWith('ic-5');
    expect(currentBranding().iconUrl).toBeNull();
    expect(toasts).toEqual([BRANDING_SAVED_TEXT]);
  });

  it('saves the name and the icon in one Save, name first', async () => {
    await open(view({ appNameRowVersion: '', iconRowVersion: '' }));
    const afterName = view({
      appName: 'Acme',
      appNameIsCustom: true,
      appNameRowVersion: 'n2',
      iconRowVersion: 'i1',
    });
    api['setBrandingName'].mockReturnValue(of(afterName));
    api['setBrandingIcon'].mockReturnValue(
      of({
        ...afterName,
        iconUrl: '/api/v1/branding/icon?v=eeeeeeeeeeee',
        iconKind: 'png',
        iconRowVersion: 'i2',
      }),
    );
    await typeName('Acme');
    await chooseFile(new File(['x'], 'a.png', { type: 'image/png' }));
    await submit();
    expect(api['setBrandingName']).toHaveBeenCalledTimes(1);
    expect(api['setBrandingIcon'].mock.calls[0][1]).toBe('i1'); // the row version returned by the name save
    expect(toasts).toEqual([BRANDING_SAVED_TEXT]);
  });

  it('a conflict stops the save, says so, and Reload latest loads the current values', async () => {
    await open();
    api['setBrandingName'].mockReturnValue(throwError(() => apiError(409, 'CONCURRENCY_CONFLICT')));
    await typeName('Mine');
    await submit();
    expect(q('[data-conflict]')).not.toBeNull();
    expect(toasts).toEqual([]);
    api['getBrandingSettings'].mockReturnValue(
      of(view({ appName: 'Theirs', appNameIsCustom: true, appNameRowVersion: 'x' })),
    );
    await click('[data-conflict] p-button');
    expect(q('[data-conflict]')).toBeNull();
    expect(q<HTMLInputElement>('#st-name')!.value).toBe('Theirs');
  });

  it('Cancel puts the saved values back', async () => {
    await open();
    await typeName('Changed');
    await chooseFile(new File(['x'], 'a.png', { type: 'image/png' }));
    await click('[data-cancel]');
    expect(q<HTMLInputElement>('#st-name')!.value).toBe('MatterFlow');
    expect(text('[data-icon-file]')).toBe('Built-in icon.');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('turns the file picker into a keyboard-reachable button', async () => {
    await open();
    const choose = q<HTMLButtonElement>('[data-choose-icon] button, button[data-choose-icon]')!;
    expect(choose.textContent).toContain('Choose file');
    expect(choose.tabIndex).toBeGreaterThanOrEqual(0);
    expect(q('[data-icon-input]')!.getAttribute('tabindex')).toBe('-1');
  });
});

describe('helpers', () => {
  it('formats file sizes', () => {
    expect(fileSizeText(1)).toBe('1 byte');
    expect(fileSizeText(812)).toBe('812 bytes');
    expect(fileSizeText(2048)).toBe('2 KB');
    expect(fileSizeText(1536)).toBe('1.5 KB');
    expect(fileSizeText(262144)).toBe('256 KB');
  });

  it('maps the administration view to the branding the shell uses', () => {
    expect(
      brandingOf(
        view({
          appName: 'A',
          iconUrl: '/api/v1/branding/icon?v=aaaaaaaaaaaa',
          iconKind: 'ico',
          version: 'aaaaaaaaaaaa',
        }),
      ),
    ).toEqual({
      appName: 'A',
      iconUrl: '/api/v1/branding/icon?v=aaaaaaaaaaaa',
      iconKind: 'ico',
      version: 'aaaaaaaaaaaa',
    });
    expect(brandingOf(view())).toEqual({
      appName: 'MatterFlow',
      iconUrl: null,
      iconKind: null,
      version: 'aaaaaaaaaaaa',
    });
  });
});
