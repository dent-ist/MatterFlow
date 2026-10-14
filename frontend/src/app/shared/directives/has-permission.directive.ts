import {
  Directive,
  TemplateRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';

/**
 * Structural directive: renders the host only when the user holds the permission (or ANY of a
 * list). Hides, never disables; use for actions unrelated to the user's context (UX 5.7).
 *
 *   <button *mfHasPermission="'Task.Assign'">Assign</button>
 *   <a *mfHasPermission="['Client.View', 'Matter.View']; else denied">...</a>
 */
@Directive({ selector: '[mfHasPermission]' })
export class HasPermissionDirective {
  private readonly store = inject(AuthStore);
  private readonly vcr = inject(ViewContainerRef);
  private readonly template = inject<TemplateRef<unknown>>(TemplateRef);

  readonly mfHasPermission = input.required<Permission | Permission[] | string | string[]>();
  readonly mfHasPermissionElse = input<TemplateRef<unknown> | null>(null);

  private readonly allowed = computed(() => {
    const required = this.mfHasPermission();
    return this.store.hasAny(Array.isArray(required) ? required : [required]);
  });

  constructor() {
    effect(() => {
      const allowed = this.allowed();
      const elseTpl = this.mfHasPermissionElse();
      this.vcr.clear();
      if (allowed) this.vcr.createEmbeddedView(this.template);
      else if (elseTpl) this.vcr.createEmbeddedView(elseTpl);
    });
  }
}
