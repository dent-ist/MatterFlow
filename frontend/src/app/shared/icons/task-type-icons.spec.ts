import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import contract from '../../../../../contracts/task-type-icons.json';
import {
  TASK_TYPE_ICON_CATALOG,
  TASK_TYPE_ICON_CATEGORIES,
  TASK_TYPE_ICON_DEFAULT_KEY,
} from './task-type-icon-catalog.generated';
import { TASK_TYPE_ICON_PATHS } from './task-type-icon-paths.generated';
import { DEFAULT_TASK_TYPE_ICON, TaskTypeIcon, TaskTypeIconSize } from './task-type-icon';
import { TaskTypeIconLibrary } from './task-type-icon-library';
import { iconMatches } from './task-type-icon-picker';

describe('Task type icon library data', () => {
  it('matches the shared contract the API validates against (keys, labels, categories, default)', () => {
    expect(TASK_TYPE_ICON_DEFAULT_KEY).toBe(contract.defaultKey);
    expect(DEFAULT_TASK_TYPE_ICON).toBe(contract.defaultKey);
    expect([...TASK_TYPE_ICON_CATEGORIES]).toEqual(contract.categories);
    const ours = TASK_TYPE_ICON_CATALOG.map((i) => `${i.key}|${i.label}|${i.category}`).sort();
    const theirs = contract.icons.map((i) => `${i.key}|${i.label}|${i.category}`).sort();
    expect(ours).toEqual(theirs);
  });

  it('has 250 to 300 icons with unique kebab-case keys, a drawing each, and every category filled', () => {
    const keys = TASK_TYPE_ICON_CATALOG.map((i) => i.key);
    expect(keys.length).toBeGreaterThanOrEqual(250);
    expect(keys.length).toBeLessThanOrEqual(300);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(key.length).toBeLessThanOrEqual(50);
      expect(TASK_TYPE_ICON_PATHS[key], key).toBeTruthy();
    }
    expect(Object.keys(TASK_TYPE_ICON_PATHS).sort()).toEqual([...keys].sort());
    for (const category of TASK_TYPE_ICON_CATEGORIES) {
      expect(
        TASK_TYPE_ICON_CATALOG.some((i) => i.category === category),
        category,
      ).toBe(true);
    }
    expect(keys).toContain(TASK_TYPE_ICON_DEFAULT_KEY);
  });

  it('bundles plain shapes only: no script, style, link or event handler can ride along', () => {
    for (const [key, markup] of Object.entries(TASK_TYPE_ICON_PATHS)) {
      expect(markup, key).toMatch(
        /^(<(path|circle|rect|line|polyline|polygon|ellipse)( [a-z-]+="[^"<>]*")*\/>)+$/,
      );
      expect(markup, key).not.toMatch(/\son[a-z]+=|javascript:|<script|<style|href/i);
    }
  });

  it('finds icons by label, key or keyword, all words required', () => {
    const icon = {
      key: 'user-search',
      label: 'Custodian search',
      category: 'Identification',
      keywords: 'identify find person',
    };
    expect(iconMatches(icon, '')).toBe(true);
    expect(iconMatches(icon, 'custodian')).toBe(true);
    expect(iconMatches(icon, 'USER SEARCH')).toBe(true);
    expect(iconMatches(icon, 'find person')).toBe(true);
    expect(iconMatches(icon, 'find email')).toBe(false);
  });
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TaskTypeIcon],
  template: `<mf-task-type-icon [iconKey]="key()" [size]="size()" />`,
})
class Host {
  readonly key = signal<string | null>('cpu-2');
  readonly size = signal<TaskTypeIconSize>('md');
}

describe('mf-task-type-icon', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await TestBed.inject(TaskTypeIconLibrary).ensurePaths();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
  }

  it('draws the icon decoratively in the current text colour', async () => {
    const { el } = await render();
    const svg = el.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(
      svg.querySelectorAll('path,circle,rect,line,polyline,polygon,ellipse').length,
    ).toBeGreaterThan(0);
    expect(svg.querySelector('script')).toBeNull();
    expect(el.querySelector('title')).toBeNull();
  });

  it('shows the default icon for an unknown or missing key', async () => {
    const { el, host, fixture } = await render();
    const drawing = () => el.querySelector('svg')!.innerHTML;
    host.key.set('no-such-icon');
    fixture.detectChanges();
    const unknown = drawing();
    host.key.set(null);
    fixture.detectChanges();
    expect(drawing()).toBe(unknown);
    host.key.set(DEFAULT_TASK_TYPE_ICON);
    fixture.detectChanges();
    expect(drawing()).toBe(unknown);
    host.key.set('cpu-2');
    fixture.detectChanges();
    expect(drawing()).not.toBe(unknown);
  });

  it('has the three sizes', async () => {
    const { el, host, fixture } = await render();
    const component = () => el.querySelector('mf-task-type-icon') as HTMLElement;
    expect(component().dataset['size']).toBe('md');
    host.size.set('sm');
    fixture.detectChanges();
    expect(component().dataset['size']).toBe('sm');
    host.size.set('lg');
    fixture.detectChanges();
    expect(component().dataset['size']).toBe('lg');
  });
});
