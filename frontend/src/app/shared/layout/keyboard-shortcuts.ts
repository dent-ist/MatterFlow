import { Injectable, Injector, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import {
  GO_SEQUENCE_MS,
  GO_START,
  GO_TARGETS,
  GoTarget,
  ShortcutRegistry,
  goShortcut,
  isShortcut,
} from './shortcut-registry';

const key = (userId: number | null) => `mf.keyboard-shortcuts.v1.${userId ?? 'anon'}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** True for a control the person types into (and for anything that takes the letter keys for itself). */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return true;
  const role = el.getAttribute?.('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

/** A dialog or an open inline menu has the keyboard: the single-key shortcuts stay quiet (WCAG 2.1.4 and the popover rules, #140). */
export function overlayOpen(): boolean {
  return !!document.querySelector('.p-dialog, [role="dialog"], .im-pop, [data-search-panel]');
}

/**
 * The single-character keyboard shortcuts of the work pages (#181): the per-user on/off switch (WCAG 2.1.4, kept in `localStorage` per
 * user; storage that is blocked only means the choice lasts until the page closes) and the `g` then `m` / `t` / `p` sequences.
 * Row shortcuts (J, K, S, P in the grid) are handled by the grid and ask `enabled()`.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardShortcuts {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly registry = inject(ShortcutRegistry);
  private readonly injector = inject(Injector);

  private readonly userId = computed(() => this.auth.profile()?.userId ?? null);
  private readonly memory = new Map<string, boolean>();
  private readonly revision = signal(0);
  private readonly armed = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Whether the single-key shortcuts act. On unless this user switched them off. */
  readonly enabled = computed(() => {
    this.revision();
    const k = key(this.userId());
    const mem = this.memory.get(k);
    if (mem !== undefined) return mem;
    try {
      return storage()?.getItem(k) !== '0';
    } catch {
      return true;
    }
  });

  /** True between `g` and the second key. The grid leaves its own keys alone meanwhile (`g` then `p` is Pod Work, not the Priority menu). */
  readonly sequencePending = this.armed.asReadonly();

  /** Lists the sequences this user may use in the shortcut help (Pod Work only with Pod.View). Call once, from the app shell. */
  listGoShortcuts(): void {
    effect(
      (onCleanup) => {
        const offs = this.allowedTargets().map((t) => this.registry.register(goShortcut(t)));
        onCleanup(() => offs.forEach((off) => off()));
      },
      { injector: this.injector },
    );
  }

  setEnabled(on: boolean): void {
    const k = key(this.userId());
    this.memory.set(k, on);
    try {
      storage()?.setItem(k, on ? '1' : '0');
    } catch {
      // Kept for this session only.
    }
    this.revision.update((n) => n + 1);
    if (!on) this.cancel();
  }

  private allowedTargets(): readonly GoTarget[] {
    return GO_TARGETS.filter((t) => this.auth.has(t.permission));
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.armed.set(false);
  }

  /** The document's key handler calls this first; true means the key was part of a sequence and nothing else should act on it. */
  handleGo(event: KeyboardEvent): boolean {
    if (event.repeat || event.defaultPrevented) return false;
    if (!this.enabled()) {
      this.cancel();
      return false;
    }
    if (this.armed()) {
      this.cancel();
      const plainKey = !event.ctrlKey && !event.metaKey && !event.altKey;
      const target = plainKey
        ? this.allowedTargets().find((t) => t.key === event.key.toLowerCase())
        : undefined;
      if (!target || isEditable(event.target) || overlayOpen()) return false;
      event.preventDefault();
      void this.router.navigate([target.path]);
      return true;
    }
    if (isShortcut(GO_START.id, event) && !isEditable(event.target) && !overlayOpen()) {
      this.armed.set(true);
      this.timer = setTimeout(() => this.cancel(), GO_SEQUENCE_MS);
      return true;
    }
    return false;
  }
}
