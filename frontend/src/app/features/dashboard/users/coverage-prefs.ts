import { Injectable, inject, signal } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  Scale,
  TypeOrder,
  TypeRowOrder,
  UserOrder,
  isOrder,
  isScale,
  isTypeRowOrder,
} from './coverage-model';

const PREFIX = 'mf.dashboard.coverage.v1.';

interface Stored {
  scale: Scale;
  typeOrder: TypeOrder;
  userOrder: UserOrder;
  rowOrder: TypeRowOrder;
}

const FALLBACK: Stored = {
  scale: 'relative',
  typeOrder: 'name',
  userOrder: 'name',
  rowOrder: 'fewest',
};

/** What the Coverage view remembers per user in this browser: the colour scale (the period is the page's shared one, see DashboardPrefs), the two matrix orders and the row order of the type view. Guarded storage. */
@Injectable({ providedIn: 'root' })
export class CoveragePrefs {
  private readonly auth = inject(AuthStore);
  private loadedFor: number | null = null;
  private stored: Stored = FALLBACK;

  readonly scale = signal<Scale>(FALLBACK.scale);
  readonly typeOrder = signal<TypeOrder>(FALLBACK.typeOrder);
  readonly userOrder = signal<UserOrder>(FALLBACK.userOrder);
  readonly rowOrder = signal<TypeRowOrder>(FALLBACK.rowOrder);

  ensureLoaded(): void {
    const userId = this.auth.profile()?.userId ?? 0;
    if (this.loadedFor === userId) return;
    this.loadedFor = userId;
    this.stored = this.read(userId);
    this.scale.set(this.stored.scale);
    this.typeOrder.set(this.stored.typeOrder);
    this.userOrder.set(this.stored.userOrder);
    this.rowOrder.set(this.stored.rowOrder);
  }

  remember(choice: Partial<Stored>): void {
    this.ensureLoaded();
    this.stored = { ...this.stored, ...choice };
    if (choice.scale) this.scale.set(choice.scale);
    if (choice.typeOrder) this.typeOrder.set(choice.typeOrder);
    if (choice.userOrder) this.userOrder.set(choice.userOrder);
    if (choice.rowOrder) this.rowOrder.set(choice.rowOrder);
    try {
      localStorage.setItem(PREFIX + (this.loadedFor ?? 0), JSON.stringify(this.stored));
    } catch {
      /* storage unavailable: the choice lasts until the page is closed */
    }
  }

  private read(userId: number): Stored {
    try {
      const raw = localStorage.getItem(PREFIX + userId);
      if (!raw) return FALLBACK;
      const p = JSON.parse(raw) as Partial<Stored>;
      return {
        scale: isScale(p.scale) ? p.scale : FALLBACK.scale,
        typeOrder: isOrder(p.typeOrder) ? p.typeOrder : FALLBACK.typeOrder,
        userOrder: isOrder(p.userOrder) ? p.userOrder : FALLBACK.userOrder,
        rowOrder: isTypeRowOrder(p.rowOrder) ? p.rowOrder : FALLBACK.rowOrder,
      };
    } catch {
      return FALLBACK;
    }
  }
}
