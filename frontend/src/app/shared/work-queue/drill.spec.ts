import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { DrillReturn, listUrl, parseFrom } from './drill';

describe('drill-in context (M7)', () => {
  it('whitelists the from values', () => {
    expect(parseFrom('my-work')).toBe('my-work');
    expect(parseFrom('task-queue')).toBe('task-queue');
    expect(parseFrom('pod-work')).toBe('pod-work');
    for (const bad of ['dashboard', '', null, undefined, 'constructor', '__proto__']) {
      expect(parseFrom(bad)).toBeNull();
    }
  });

  it('returns to the exact view only for an address on the list path', () => {
    expect(listUrl('my-work', '/my-work?view=closed&x=1')).toBe('/my-work?view=closed&x=1');
    expect(listUrl('my-work', undefined)).toBe('/my-work');
    expect(listUrl('my-work', '/admin/users')).toBe('/my-work');
    expect(listUrl('my-work', '//evil.example/my-work')).toBe('/my-work');
    expect(listUrl('pod-work', '/pods/work?podId=2')).toBe('/pods/work?podId=2');
  });

  describe('DrillReturn', () => {
    function setup(): { drill: DrillReturn; router: Router } {
      TestBed.configureTestingModule({
        providers: [provideRouter([{ path: 'a', children: [] }])],
      });
      return { drill: TestBed.inject(DrillReturn), router: TestBed.inject(Router) };
    }

    it('gives the row back once after a return, and not after any other visit', async () => {
      const { drill, router } = setup();
      drill.leave('my-work', 42);
      await router.navigateByUrl('/a');
      expect(drill.take('my-work')).toBeNull();

      await router.navigateByUrl('/a?x=1', { state: { restoreFocus: true } });
      expect(drill.take('task-queue')).toBeNull();
      expect(drill.take('my-work')).toBe(42);
      expect(drill.take('my-work')).toBeNull();
    });
  });
});
