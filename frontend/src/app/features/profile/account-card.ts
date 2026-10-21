import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';
import { CopyButton } from '../../shared/ui/copy-button';

/**
 * The Account card of My profile (epic #520, P1): who the signed-in person is, read-only. Name, Windows account (with a copy button),
 * email, every role by name and the Pods (the primary one first and marked "Primary"). Everything comes from `GET /me`; there are no edit
 * controls ("Managed by your administrator."). A missing email reads "Not set", no Pods "No pods yet".
 */
@Component({
  selector: 'mf-account-card',
  imports: [CopyButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './account-card.scss',
  template: `
    <section class="ac" aria-labelledby="ac-title" data-account-card>
      <h2 class="ac__title" id="ac-title">Account</h2>
      <dl class="ac__list">
        <div class="ac__row" data-ac-row="name">
          <dt>Name</dt>
          <dd class="ac__value" data-ac-name>{{ name() }}</dd>
        </div>
        <div class="ac__row" data-ac-row="account">
          <dt>Windows account</dt>
          <dd class="ac__value ac__value--copy">
            @if (account(); as a) {
              <span data-ac-account>{{ a }}</span>
              <mf-copy-button [text]="a" label="Windows account" />
            } @else {
              <span class="ac__none" data-ac-account>Not available</span>
            }
          </dd>
        </div>
        <div class="ac__row" data-ac-row="email">
          <dt>Email</dt>
          <dd class="ac__value">
            @if (email(); as e) {
              <span data-ac-email>{{ e }}</span>
            } @else {
              <span class="ac__none" data-ac-email>Not set</span>
            }
          </dd>
        </div>
        <div class="ac__row" data-ac-row="roles">
          <dt>{{ roles().length === 1 ? 'Role' : 'Roles' }}</dt>
          <dd class="ac__value">
            @if (roles().length === 0) {
              <span class="ac__none" data-ac-roles-none>No roles yet</span>
            } @else {
              <ul class="ac__pills" aria-label="Your roles">
                @for (r of roles(); track r) {
                  <li class="ac__pill" data-ac-role>{{ r }}</li>
                }
              </ul>
            }
          </dd>
        </div>
        <div class="ac__row" data-ac-row="pods">
          <dt>{{ pods().length === 1 ? 'Pod' : 'Pods' }}</dt>
          <dd class="ac__value">
            @if (pods().length === 0) {
              <span class="ac__none" data-ac-pods-none>No pods yet</span>
            } @else {
              <ul class="ac__pills" aria-label="Your pods">
                @for (p of pods(); track p.podId) {
                  <li class="ac__pill" data-ac-pod [attr.data-primary]="p.isPrimary ? '' : null">
                    @if (p.isPrimary) {
                      <i class="pi pi-star-fill" aria-hidden="true"></i>
                    }
                    <span class="ac__pill-name">{{ p.name }}</span>
                    @if (p.isPrimary) {
                      &ngsp;<span class="ac__tag">Primary</span>
                    }
                  </li>
                }
              </ul>
            }
          </dd>
        </div>
      </dl>
      <p class="ac__note" data-ac-note>Managed by your administrator.</p>
    </section>
  `,
})
export class AccountCard {
  private readonly auth = inject(AuthStore);

  protected readonly name = computed(() => this.auth.profile()?.displayName ?? '');
  protected readonly account = computed(() => this.auth.profile()?.windowsAccount ?? '');
  protected readonly email = computed(() => this.auth.profile()?.email?.trim() ?? '');
  protected readonly roles = computed(() =>
    [...(this.auth.profile()?.roles ?? [])].sort((a, b) => a.localeCompare(b)),
  );
  /** The primary Pod first, then by name. */
  protected readonly pods = computed(() =>
    [...(this.auth.profile()?.pods ?? [])].sort(
      (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name),
    ),
  );
}
