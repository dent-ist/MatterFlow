import {
  BRANDING_STORAGE_KEY,
  DEFAULT_BRANDING,
  applyBranding,
  appName,
  currentBranding,
  loadBranding,
  parseBranding,
} from './branding';
import { documentTitle, pageTab } from '../title/page-title';

const CUSTOM = {
  appName: 'Smith & Co',
  iconUrl: '/api/v1/branding/icon?v=0123456789ab',
  iconKind: 'png',
  version: '0123456789ab',
};

const icons = (): HTMLLinkElement[] =>
  Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
const touch = (): HTMLLinkElement[] =>
  Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]'));

function resetHead(): void {
  document.head.querySelectorAll('link').forEach((l) => l.remove());
  for (const html of [
    '<link rel="icon" type="image/svg+xml" href="favicon.svg" />',
    '<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png" />',
    '<link rel="icon" type="image/x-icon" href="favicon.ico" sizes="16x16 32x32 48x48" />',
    '<link rel="apple-touch-icon" href="apple-touch-icon.png" />',
  ])
    document.head.insertAdjacentHTML('beforeend', html);
  document.title = 'MatterFlow';
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('branding (epic #850, BR-04)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetHead();
    applyBranding(DEFAULT_BRANDING);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
    applyBranding(DEFAULT_BRANDING);
    resetHead();
  });

  describe('parseBranding', () => {
    it('accepts the server answer and the default', () => {
      expect(parseBranding(CUSTOM)).toEqual(CUSTOM);
      expect(
        parseBranding({
          appName: 'MatterFlow',
          iconUrl: null,
          iconKind: null,
          version: 'abcdef012345',
        }),
      ).toEqual({ appName: 'MatterFlow', iconUrl: null, iconKind: null, version: 'abcdef012345' });
      expect(parseBranding({ ...CUSTOM, appName: '  Trim me ' })?.appName).toBe('Trim me');
    });

    it.each([
      ['null', null],
      ['a string', 'x'],
      ['an empty name', { ...CUSTOM, appName: '  ' }],
      ['a name over 40', { ...CUSTOM, appName: 'x'.repeat(41) }],
      ['markup in the name', { ...CUSTOM, appName: '<b>x</b>' }],
      ['a control character', { ...CUSTOM, appName: 'a\u0007b' }],
      ['a number as name', { ...CUSTOM, appName: 5 }],
      ['an icon address elsewhere', { ...CUSTOM, iconUrl: 'https://evil.example/x.png' }],
      ['a javascript address', { ...CUSTOM, iconUrl: 'javascript:alert(1)' }],
      ['an icon address without a version', { ...CUSTOM, iconUrl: '/api/v1/branding/icon' }],
      ['an unknown icon kind', { ...CUSTOM, iconKind: 'gif' }],
      ['an icon without a kind', { ...CUSTOM, iconKind: null }],
      ['a kind without an icon', { ...CUSTOM, iconUrl: null }],
    ])('rejects %s', (_label, value) => {
      expect(parseBranding(value)).toBeNull();
    });

    it('keeps an ampersand and accepts exactly 40 characters', () => {
      expect(parseBranding({ ...CUSTOM, appName: 'A & B' })?.appName).toBe('A & B');
      expect(parseBranding({ ...CUSTOM, appName: 'x'.repeat(40) })).not.toBeNull();
    });
  });

  describe('documentTitle uses the current name', () => {
    it('is a pure function of the page and the name', () => {
      expect(documentTitle('Clients', 'Acme')).toBe('Clients - Acme');
      expect(documentTitle('  ', 'Acme')).toBe('Acme');
      expect(documentTitle(pageTab('Settings', 'Branding'), 'Acme')).toBe(
        'Settings: Branding - Acme',
      );
    });

    it('reads the branding in force when no name is passed', () => {
      expect(documentTitle('Clients')).toBe('Clients - MatterFlow');
      applyBranding({ ...CUSTOM, iconUrl: null, iconKind: null });
      expect(appName()).toBe('Smith & Co');
      expect(documentTitle('Clients')).toBe('Clients - Smith & Co');
      expect(documentTitle(null)).toBe('Smith & Co');
    });
  });

  describe('applying a branding to the page', () => {
    it('swaps the name in a title the router already wrote', () => {
      document.title = 'Clients - MatterFlow';
      applyBranding({ ...CUSTOM, iconUrl: null, iconKind: null });
      expect(document.title).toBe('Clients - Smith & Co');
      applyBranding(DEFAULT_BRANDING);
      expect(document.title).toBe('Clients - MatterFlow');
    });

    it('sets the bare title and leaves a title of another page alone', () => {
      applyBranding({ ...CUSTOM, iconUrl: null, iconKind: null });
      expect(document.title).toBe('Smith & Co');
      document.title = 'Something else';
      applyBranding(DEFAULT_BRANDING);
      expect(document.title).toBe('Something else');
    });

    it('replaces the built-in icon links by one marked icon link and an apple-touch-icon for a PNG', () => {
      applyBranding(CUSTOM as never);
      expect(icons().map((l) => l.getAttribute('href'))).toEqual([CUSTOM.iconUrl]);
      expect(icons()[0].getAttribute('type')).toBe('image/png');
      expect(icons()[0].hasAttribute('data-mf-icon')).toBe(true);
      expect(touch().map((l) => l.getAttribute('href'))).toEqual([CUSTOM.iconUrl]);
      expect(touch()[0].hasAttribute('data-mf-icon')).toBe(true);
    });

    it('removes the apple-touch-icon for an SVG or an ICO (iOS cannot use them)', () => {
      applyBranding({ ...CUSTOM, iconKind: 'svg' } as never);
      expect(icons()[0].getAttribute('type')).toBe('image/svg+xml');
      expect(touch()).toEqual([]);
      applyBranding({
        ...CUSTOM,
        iconKind: 'ico',
        iconUrl: '/api/v1/branding/icon?v=aaaaaaaaaaaa',
      } as never);
      expect(icons()).toHaveLength(1);
      expect(icons()[0].getAttribute('type')).toBe('image/x-icon');
      expect(touch()).toEqual([]);
    });

    it('does not touch the page again for the same icon and restores the built-in links on reset', () => {
      applyBranding(CUSTOM as never);
      const link = icons()[0];
      applyBranding({ ...CUSTOM, appName: 'Other' } as never);
      expect(icons()[0]).toBe(link);

      applyBranding(DEFAULT_BRANDING);
      expect(icons().map((l) => l.getAttribute('href'))).toEqual([
        'favicon.svg',
        'favicon-32.png',
        'favicon.ico',
      ]);
      expect(touch().map((l) => l.getAttribute('href'))).toEqual(['apple-touch-icon.png']);
      expect(document.head.querySelector('[data-mf-icon]')).toBeNull();
    });

    it('leaves the static links alone while the default is in force', () => {
      const before = icons();
      applyBranding(DEFAULT_BRANDING);
      expect(icons()).toEqual(before);
    });
  });

  describe('loadBranding', () => {
    it('applies the fetched branding and remembers it', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CUSTOM));
      vi.stubGlobal('fetch', fetchMock);
      const result = await loadBranding();
      expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/branding');
      expect(fetchMock.mock.calls[0][1].cache).toBe('no-cache'); // revalidate on every page load
      expect(result).toEqual(CUSTOM);
      expect(currentBranding()).toEqual(CUSTOM);
      expect(document.title).toBe('Smith & Co');
      expect(JSON.parse(localStorage.getItem(BRANDING_STORAGE_KEY)!)).toEqual(CUSTOM);
    });

    it('applies the last known copy before the answer arrives, then the answer', async () => {
      localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(CUSTOM));
      let release!: (r: Response) => void;
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((r) => (release = r))));
      const pending = loadBranding();
      expect(appName()).toBe('Smith & Co'); // synchronous: no flash of the default
      expect(icons()[0].getAttribute('href')).toBe(CUSTOM.iconUrl);
      release(
        jsonResponse({ appName: 'Newer', iconUrl: null, iconKind: null, version: 'ffffffffffff' }),
      );
      await pending;
      expect(appName()).toBe('Newer');
      expect(icons()[0].getAttribute('href')).toBe('favicon.svg');
    });

    it('keeps the default when the API is down', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      await expect(loadBranding()).resolves.toEqual(DEFAULT_BRANDING);
      expect(document.title).toBe('MatterFlow');
    });

    it('keeps the remembered copy when the API is down', async () => {
      localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(CUSTOM));
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      expect((await loadBranding()).appName).toBe('Smith & Co');
    });

    it.each([
      ['a server error', () => jsonResponse({ code: 'INTERNAL_ERROR' }, 500)],
      ['a 401', () => jsonResponse({}, 401)],
      ['a body that is not JSON', () => new Response('<html>', { status: 200 })],
      [
        'a body with an unsafe icon address',
        () => jsonResponse({ ...CUSTOM, iconUrl: 'javascript:1' }),
      ],
      ['a body that is not an object', () => jsonResponse([1, 2])],
    ])('keeps the default after %s', async (_label, make) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(make()));
      await expect(loadBranding()).resolves.toEqual(DEFAULT_BRANDING);
      expect(localStorage.getItem(BRANDING_STORAGE_KEY)).toBeNull();
    });

    it('gives up after 1.5 seconds and never throws', async () => {
      vi.useFakeTimers();
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init.signal!.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              );
            }),
        ),
      );
      const pending = loadBranding();
      await vi.advanceTimersByTimeAsync(1499);
      let settled = false;
      void pending.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await expect(pending).resolves.toEqual(DEFAULT_BRANDING);
    });

    it('survives a localStorage that throws on read and on write', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(CUSTOM)));
      try {
        await expect(loadBranding()).resolves.toEqual(CUSTOM);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('ignores a damaged stored copy', async () => {
      localStorage.setItem(BRANDING_STORAGE_KEY, '{"appName":');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
      await expect(loadBranding()).resolves.toEqual(DEFAULT_BRANDING);
      localStorage.setItem(
        BRANDING_STORAGE_KEY,
        JSON.stringify({ ...CUSTOM, appName: '<img onerror=x>' }),
      );
      await expect(loadBranding()).resolves.toEqual(DEFAULT_BRANDING);
    });
  });
});
