import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** One piece of a sentence: plain text (spaces included) or a link inside it. */
export type CopyPart = string | { readonly label: string; readonly to: string };

/** A sentence with links in it ("Check <Pod Work> for unassigned tasks."), so the copy is one string-like value built by one function. */
@Component({
  selector: 'mf-copy-parts',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@for (p of parts(); track $index) {
    @if (isText(p)) {
      <span>{{ p }}</span>
    } @else {
      <a class="mf-copy-link" [routerLink]="link(p)">{{ label(p) }}</a>
    }
  }`,
  styles: `
    .mf-copy-link {
      color: var(--mf-link);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  `,
})
export class CopyParts {
  readonly parts = input.required<readonly CopyPart[]>();

  protected isText(p: CopyPart): p is string {
    return typeof p === 'string';
  }
  protected link(p: CopyPart): string {
    return typeof p === 'string' ? '' : p.to;
  }
  protected label(p: CopyPart): string {
    return typeof p === 'string' ? '' : p.label;
  }
}

/** The plain text of the parts (tests, titles). */
export function partsText(parts: readonly CopyPart[]): string {
  return parts.map((p) => (typeof p === 'string' ? p : p.label)).join('');
}
