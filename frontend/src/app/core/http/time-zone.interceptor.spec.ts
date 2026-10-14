import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TIME_ZONE_HEADER, browserTimeZone, timeZoneInterceptor } from './time-zone.interceptor';

describe('timeZoneInterceptor', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([timeZoneInterceptor])),
        provideHttpClientTesting(),
      ],
    });
  });

  it('adds the browser IANA time zone header', () => {
    const http = TestBed.inject(HttpClient);
    const ctrl = TestBed.inject(HttpTestingController);
    http.get('/api/v1/system/ping').subscribe();
    const req = ctrl.expectOne('/api/v1/system/ping');
    expect(browserTimeZone()).toBeTruthy();
    expect(req.request.headers.get(TIME_ZONE_HEADER)).toBe(browserTimeZone() ?? null);
  });

  it('keeps an explicitly supplied header', () => {
    const http = TestBed.inject(HttpClient);
    const ctrl = TestBed.inject(HttpTestingController);
    http.get('/x', { headers: { [TIME_ZONE_HEADER]: 'America/Chicago' } }).subscribe();
    expect(ctrl.expectOne('/x').request.headers.get(TIME_ZONE_HEADER)).toBe('America/Chicago');
  });
});
