import { Injectable, computed, signal } from '@angular/core';

/** The width budget of the docked tree and the side panel (mockup r2): the grid never gets less than GRID_MIN. */
export const GRID_MIN = 560;
export const TREE_W = 280;
export const SIDE_W = 340;
export const RAIL_W = 48;
export const GAP = 12;
/** The docked tree is not used below this window width; the same tree opens as a panel from Browse. */
export const DOCK_MIN = 1100;
/** Up to this width the page scrolls as a whole and the side sections stack under the list (phone and small tablet). */
export const STACK_MAX = 768;

const KEY = 'mf-mm-ui';

export interface LayoutMemory {
  treePref: 'open' | 'rail' | null;
  treePin: boolean;
  sidePref: 'open' | 'closed' | null;
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Where the docked tree and the side panel stand (My Matters, epic #953 UI-11 and UI-12). Below about 1510 px the two cannot both be wide and still leave the grid 560 px, so they
 * take turns: opening one collapses the other to its rail and the one used last stays wide. Choosing a matter collapses the tree (unless it is pinned) and the side panel
 * opens in the room that was freed (unless the person closed it). The states the person chose are remembered in the browser (a convenience; the address does not carry them).
 */
@Injectable()
export class MmLayout {
  /** The window width and the width of the whole work area (tree dock + content), set by the page. */
  readonly windowWidth = signal(typeof window === 'undefined' ? 1366 : window.innerWidth);
  readonly workWidth = signal(1000);
  /** The person has no matter or one only: there is nothing to browse, so the tree is not drawn. */
  readonly browsable = signal(true);

  readonly treeOpen = signal(true);
  readonly treePin = signal(false);
  readonly sideOpen = signal(true);
  private treePref: 'open' | 'rail' | null = null;
  private sidePref: 'open' | 'closed' | null = null;
  private sideAuto = false;
  private wide: 'tree' | 'side' | null = null;
  /** A message for a polite live region when the layout moved something the person did not ask for. */
  readonly announcement = signal('');

  readonly stacked = computed(() => this.windowWidth() <= STACK_MAX);
  readonly docked = computed(() => this.windowWidth() >= DOCK_MIN && this.browsable());
  readonly treeWide = computed(() => this.treeOpen() && this.docked());

  constructor() {
    this.load();
    this.wide = this.sidePref === 'open' && this.treePref !== 'open' ? 'side' : 'tree';
  }

  private sideFits(treeWide: boolean): boolean {
    const tree = this.docked() ? (treeWide ? TREE_W : RAIL_W) + GAP : 0;
    return this.workWidth() - tree - (SIDE_W + GAP) >= GRID_MIN;
  }

  /** Brings the two panels into the budget of the current width (call after any change of width or state). */
  reconcile(): void {
    if (this.stacked()) return;
    if (!this.docked() && this.treeOpen()) this.treeOpen.set(false);
    if (this.sideOpen() && this.treeWide() && !this.sideFits(true)) {
      if (this.wide === 'side') this.treeOpen.set(false);
      else {
        this.sideOpen.set(false);
        this.sideAuto = true;
      }
    }
    if (this.sideOpen() && !this.treeWide() && !this.sideFits(false) && this.sidePref !== 'open') {
      this.sideOpen.set(false);
      this.sideAuto = true;
    }
    if (
      !this.sideOpen() &&
      this.sideAuto &&
      this.sidePref !== 'closed' &&
      this.sideFits(this.treeWide())
    ) {
      this.sideOpen.set(true);
      this.sideAuto = false;
    }
  }

  setWidths(windowWidth: number, workWidth: number): void {
    this.windowWidth.set(windowWidth);
    this.workWidth.set(workWidth);
    this.reconcile();
  }

  expandTree(): void {
    const sideWas = this.sideOpen();
    this.treeOpen.set(true);
    this.treePref = 'open';
    this.wide = 'tree';
    this.reconcile();
    if (sideWas && !this.sideOpen())
      this.announcement.set('The side panel was collapsed to a rail to make room for the tree.');
    this.save();
  }

  collapseTree(): void {
    const sideWas = this.sideOpen();
    this.treeOpen.set(false);
    this.treePref = 'rail';
    this.reconcile();
    if (!sideWas && this.sideOpen())
      this.announcement.set('The side panel opened in the room the tree freed.');
    this.save();
  }

  setPin(on: boolean): void {
    this.treePin.set(on);
    this.save();
  }

  expandSide(): void {
    const treeWas = this.treeWide();
    this.sideOpen.set(true);
    this.sidePref = 'open';
    this.sideAuto = false;
    this.wide = 'side';
    this.reconcile();
    if (treeWas && !this.treeWide())
      this.announcement.set('The tree was collapsed to a rail to make room for the side panel.');
    this.save();
  }

  collapseSide(): void {
    this.sideOpen.set(false);
    this.sidePref = 'closed';
    this.sideAuto = false;
    this.announcement.set(
      'Side panel collapsed. Upcoming events and recent activity are on the rail.',
    );
    this.save();
  }

  /** A client or a matter was chosen: the tree goes to its rail unless pinned (or unless it is the only way to choose, below the dock width), and the freed room goes to the side panel. */
  chosen(): void {
    if (this.docked() && this.treeOpen() && !this.treePin()) {
      const sideWas = this.sideOpen();
      this.treeOpen.set(false);
      this.reconcile();
      if (!sideWas && this.sideOpen())
        this.announcement.set('The side panel opened in the room the tree freed.');
    } else this.reconcile();
  }

  private save(): void {
    try {
      const o: LayoutMemory = {
        treePref: this.treePref,
        treePin: this.treePin(),
        sidePref: this.sidePref,
      };
      store()?.setItem(KEY, JSON.stringify(o));
    } catch {
      // Not remembering is fine.
    }
  }

  private load(): void {
    try {
      const raw = store()?.getItem(KEY);
      if (!raw) return;
      const o = JSON.parse(raw) as Partial<LayoutMemory>;
      this.treePref = o.treePref === 'open' || o.treePref === 'rail' ? o.treePref : null;
      this.sidePref = o.sidePref === 'open' || o.sidePref === 'closed' ? o.sidePref : null;
      this.treePin.set(o.treePin === true);
      if (this.treePref === 'rail') this.treeOpen.set(false);
      if (this.sidePref === 'closed') this.sideOpen.set(false);
    } catch {
      // A broken value is ignored.
    }
  }
}
