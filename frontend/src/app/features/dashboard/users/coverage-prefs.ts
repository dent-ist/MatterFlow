import { Injectable, inject, signal } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  PeriodKey,
  Scale,
  TypeOrder,
  UserOrder,
  isOrder,
  isPeriodKey,
  isScale,
} from './coverage-model';

const PREFIX = 'mf.dashboard.coverage.v1.';

interface Stored {
  period: PeriodKey;
  scale: Scale;
  typeOrder: TypeOrder;
  userOrder: UserOrder;
}

const FALLBACK: Stored = { period: '30', scale: 'relative', typeOrder: 'name', userOrder: 'name' };

/** What the Coverage view remembers per user in this browser: the period (not a custom range), the colour scale and the two orders. Guarded storage. */
@Injectable({ providedIn: 'root' })
export class CoveragePrefs {
  private readonly auth = inject(AuthStore);
  private loadedFor: number | null = null;
  private stored: Stored = FALLBACK;

  readonly period = signal<PeriodKey>(FALLBACK.period);
  readonly scale = signal<Scale>(FALLBACK.scale);
  readonly typeOrder = signal<TypeOrder>(FALLBACK.typeOrder);
  readonly userOrder = signal<UserOrder>(FALLBACK.userOrder);

  ensureLoaded(): void {
    const userId = this.auth.profile()?.userId ?? 0;
    if (this.loadedFor === userId) return;
    this.loadedFor = userId;
    this.stored = this.read(userId);
    this.period.set(this.stored.period);
    this.scale.set(this.stored.scale);
    this.typeOrder.set(this.stored.typeOrder);
    this.userOrder.set(this.stored.userOrder);
  }

  remember(choice: Partial<Stored>): void {
    this.ensureLoaded();
    this.stored = { ...this.stored, ...choice };
    if (choice.period) this.period.set(choice.period);
    if (choice.scale) this.scale.set(choice.scale);
    if (choice.typeOrder) this.typeOrder.set(choice.typeOrder);
    if (choice.userOrder) this.userOrder.set(choice.userOrder);
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
        period: isPeriodKey(p.period) && p.period !== 'custom' ? p.period : FALLBACK.period,
        scale: isScale(p.scale) ? p.scale : FALLBACK.scale,
        typeOrder: isOrder(p.typeOrder) ? p.typeOrder : FALLBACK.typeOrder,
        userOrder: isOrder(p.userOrder) ? p.userOrder : FALLBACK.userOrder,
      };
    } catch {
      return FALLBACK;
    }
  }
}
