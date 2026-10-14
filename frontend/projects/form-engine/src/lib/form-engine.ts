import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Placeholder for the dynamic form renderer/designer (architecture section 12). */
@Component({
  selector: 'mf-form-engine',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p>form-engine works!</p>`,
})
export class FormEngine {}
