import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Badge, BadgeTone } from './badge';

/** What a person is, in the words of the People list (epic #1373): a system user (has a login), Internal (works at the firm, no login) or External. */
export type PersonKind = 'system' | 'internal' | 'external';

export interface PersonKindView {
  kind: PersonKind;
  label: string;
  tone: BadgeTone;
  /** PrimeIcons class; the chip always has the icon and the word (D-12). */
  icon: string;
}

/** The badge of a person: the API's `personType` (INTERNAL or EXTERNAL) and whether the person belongs to a user. Shared by the People page and the person picker. */
export function personKind(p: { personType: string; isSystemUser: boolean }): PersonKindView {
  if (p.isSystemUser)
    return { kind: 'system', label: 'System User', tone: 'info', icon: 'pi-user' };
  return p.personType === 'EXTERNAL'
    ? { kind: 'external', label: 'External', tone: 'neutral', icon: 'pi-globe' }
    : { kind: 'internal', label: 'Internal', tone: 'info', icon: 'pi-building' };
}

/** `<mf-person-type-badge [person]="p">`: System User, Internal or External, as the one status chip (`mf-badge`). */
@Component({
  selector: 'mf-person-type-badge',
  imports: [Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-badge
    [tone]="view().tone"
    [icon]="view().icon"
    [attr.data-person-kind]="view().kind"
    >{{ view().label }}</mf-badge
  >`,
  styles: `
    :host {
      display: inline-flex;
    }
  `,
})
export class PersonTypeBadge {
  readonly person = input.required<{ personType: string; isSystemUser: boolean }>();
  protected readonly view = computed(() => personKind(this.person()));
}
