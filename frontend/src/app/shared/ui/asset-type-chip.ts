import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TaskTypeChip } from './task-type-chip';

/** A stable default icon for an asset type with none set: by a word of its name, else by its id (always the same one). */
export function defaultAssetTypeIcon(
  name: string | null | undefined,
  id: number | null | undefined,
): string {
  const n = (name ?? '').toLowerCase();
  const by: [RegExp, string][] = [
    [/mail|email/, 'mail-down'],
    [/chat|message|slack|teams/, 'message-search'],
    [/share|network|drive|file/, 'folder-share'],
    [/production|volume/, 'package-export'],
    [/mobile|phone|device/, 'device-mobile-down'],
    [/cloud|workspace|tenant/, 'cloud-download'],
    [/database|data/, 'database'],
  ];
  const hit = by.find(([re]) => re.test(n));
  if (hit) return hit[1];
  const fallback = [
    'database',
    'device-desktop-down',
    'archive',
    'package-import',
    'folder-share',
    'file-zip',
  ];
  return fallback[Math.abs(id ?? 0) % fallback.length];
}

/**
 * The asset type chip (`mf-asset-type-chip`, epic #953 UI-21): the same solid chip as the task type chip (32 px, white glyph on the type's colour) for an asset type. The icon and colour come
 * from the asset type (admin page, UI-22) and fall back to a stable default derived from the type's name and id, from the same ten `--mf-tt-*` colours, so a type is always the same chip.
 */
@Component({
  selector: 'mf-asset-type-chip',
  imports: [TaskTypeChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-task-type-chip
    kindLabel="Asset type"
    [iconKey]="icon()"
    [colourKey]="colourKey()"
    [typeId]="typeId() ?? 0"
    [name]="name()"
    [size]="size()"
    [decorative]="decorative()"
  />`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
  `,
})
export class AssetTypeChip {
  readonly iconKey = input<string | null | undefined>(undefined);
  readonly colourKey = input<string | null | undefined>(undefined);
  readonly typeId = input<number | null | undefined>(undefined);
  readonly name = input('');
  readonly size = input<'md' | 'sm'>('md');
  readonly decorative = input(false);
  protected readonly icon = computed(
    () => this.iconKey() || defaultAssetTypeIcon(this.name(), this.typeId()),
  );
}
