import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';

import {
  PodDetail,
  PodMemberCandidate,
  PodMemberDto,
  PodsClient,
  PodSummary,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import {
  HasUnsavedChanges,
  LeaveConfirmService,
} from '../../../shared/guards/unsaved-changes.guard';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';

type LoadState = 'loading' | 'ready' | 'error';
type StatusFilter = 'all' | 'active' | 'inactive';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 200;

/**
 * Admin: Pods (UX S13). Lists Pods, creates/edits/deactivates them and manages members. Pod Lead is a
 * role, not a Pod flag, so members show their roles as read-only chips and there is no lead control.
 * Actions are hidden without `Pod.Manage` / `Pod.ManageMembers`.
 */
@Component({
  selector: 'mf-pods-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConfirmDialog, ErrorReference, Button, HasPermissionDirective, RouterLink],
  templateUrl: './pods-page.html',
  styleUrl: './pods-page.scss',
})
export class PodsPage implements OnInit, OnDestroy, HasUnsavedChanges {
  private readonly api = inject(PodsClient);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  /** Query parameter `pod`: a pod id or `new`, so a reload or a shared link returns to the same editor. */
  readonly pod = input<string | undefined>(undefined);
  private readonly leaveConfirm = inject(LeaveConfirmService);
  protected readonly auth = inject(AuthStore);

  // ---- list
  protected readonly state = signal<LoadState>('loading');
  protected readonly pods = signal<PodSummary[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly search = signal('');
  protected readonly status = signal<StatusFilter>('all');
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  // ---- editor
  protected readonly editorOpen = signal(false);
  protected readonly detail = signal<PodDetail | null>(null);
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly isActive = signal(true);
  protected readonly nameError = signal('');
  protected readonly failure = signal('');
  protected readonly busy = signal(false);
  protected readonly confirmDeactivate = signal(false);
  protected readonly deactivateOpen = signal(false);
  protected readonly announce = signal('');

  // ---- members
  protected readonly candidateQuery = signal('');
  protected readonly candidates = signal<PodMemberCandidate[]>([]);
  protected readonly selected = signal<number[]>([]);

  protected readonly isNew = computed(() => this.detail() === null);
  protected readonly members = computed(() => this.detail()?.members ?? []);
  protected readonly availableCandidates = computed(() => {
    const present = new Set(this.members().map((m) => m.userId));
    return this.candidates().filter((c) => !present.has(c.userId));
  });
  protected readonly dirty = computed(() => {
    if (!this.editorOpen()) return false;
    const pod = this.detail()?.pod;
    return (
      this.name() !== (pod?.name ?? '') ||
      this.description() !== (pod?.description ?? '') ||
      this.isActive() !== (pod?.isActive ?? true)
    );
  });
  protected readonly deactivating = computed(
    () => !this.isNew() && !!this.detail()?.pod.isActive && !this.isActive(),
  );

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private candidateTimer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit(): void {
    void this.load().then(() => this.openFromUrl());
  }

  private async openFromUrl(): Promise<void> {
    const pod = this.pod();
    if (!pod || this.editorOpen()) return;
    if (pod === 'new') {
      this.openEditor(null, '', '', true);
      return;
    }
    const id = Number(pod);
    if (!Number.isInteger(id)) return;
    try {
      const detail = await firstValueFrom(this.api.getPod(id));
      this.openEditor(detail, detail.pod.name, detail.pod.description ?? '', detail.pod.isActive);
    } catch {
      this.syncUrl(null); // an unknown pod: stay on the list
    }
  }

  private syncUrl(pod: string | null): void {
    void this.router
      .navigate([], { queryParams: { pod }, queryParamsHandling: 'merge', replaceUrl: true })
      .catch(() => undefined);
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
    clearTimeout(this.candidateTimer);
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  // ---- list actions

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      const status = this.status();
      const result = await firstValueFrom(
        this.api.listPods(
          this.search().trim() || undefined,
          status === 'all' ? undefined : status === 'active',
          this.page(),
          PAGE_SIZE,
        ),
      );
      this.pods.set(result.items);
      this.total.set(result.total);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page.set(1);
      void this.load();
    }, SEARCH_DEBOUNCE_MS);
  }

  protected onStatus(event: Event): void {
    this.status.set((event.target as HTMLSelectElement).value as StatusFilter);
    this.page.set(1);
    void this.load();
  }

  protected goTo(page: number): void {
    this.page.set(Math.min(Math.max(1, page), this.pageCount()));
    void this.load();
  }

  // ---- editor actions

  protected async newPod(): Promise<void> {
    if (!(await this.leaveEditor())) return;
    this.openEditor(null, '', '', true);
  }

  protected async edit(summary: PodSummary): Promise<void> {
    if (!(await this.leaveEditor())) return;
    try {
      const detail = await firstValueFrom(this.api.getPod(summary.podId));
      this.openEditor(detail, detail.pod.name, detail.pod.description ?? '', detail.pod.isActive);
    } catch {
      // the HTTP layer already toasted the failure
    }
  }

  protected async close(): Promise<void> {
    if (!(await this.leaveEditor())) return;
    this.editorOpen.set(false);
    this.detail.set(null);
    this.syncUrl(null);
  }

  protected onName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    this.nameError.set('');
  }

  protected onDescription(event: Event): void {
    this.description.set((event.target as HTMLTextAreaElement).value);
  }

  protected onActive(event: Event): void {
    this.isActive.set((event.target as HTMLInputElement).checked);
    this.confirmDeactivate.set(false);
  }

  protected confirmDeactivation(): void {
    this.deactivateOpen.set(false);
    this.confirmDeactivate.set(true);
    void this.save();
  }

  protected async save(): Promise<void> {
    const name = this.name().trim();
    if (!name) {
      this.nameError.set('Enter a pod name.');
      return;
    }
    if (this.deactivating() && !this.confirmDeactivate()) {
      this.deactivateOpen.set(true);
      return;
    }

    this.busy.set(true);
    this.failure.set('');
    const description = this.description().trim() || undefined;
    try {
      const current = this.detail();
      const saved = current
        ? await firstValueFrom(
            this.api.updatePod(current.pod.podId, {
              name,
              description,
              isActive: this.isActive(),
              rowVersion: current.pod.rowVersion,
            }),
          )
        : await firstValueFrom(this.api.createPod({ name, description }));
      this.openEditor(saved, saved.pod.name, saved.pod.description ?? '', saved.pod.isActive);
      this.notify.success(current ? 'Pod saved' : 'Pod created');
      void this.load();
    } catch (error) {
      this.showSaveError(error, name);
    } finally {
      this.busy.set(false);
      this.confirmDeactivate.set(false);
    }
  }

  protected async reload(): Promise<void> {
    const current = this.detail();
    if (!current) return;
    const detail = await firstValueFrom(this.api.getPod(current.pod.podId));
    this.openEditor(detail, detail.pod.name, detail.pod.description ?? '', detail.pod.isActive);
    void this.load();
  }

  // ---- member actions

  protected onCandidateQuery(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.candidateQuery.set(value);
    clearTimeout(this.candidateTimer);
    this.candidateTimer = setTimeout(() => void this.findCandidates(), SEARCH_DEBOUNCE_MS);
  }

  protected toggleSelected(userId: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selected.update((ids) =>
      checked ? [...ids.filter((id) => id !== userId), userId] : ids.filter((id) => id !== userId),
    );
  }

  protected async addSelected(): Promise<void> {
    const current = this.detail();
    const userIds = this.selected();
    if (!current || userIds.length === 0) return;
    await this.memberCall(
      () => firstValueFrom(this.api.addPodMembers(current.pod.podId, { userIds })),
      `${userIds.length === 1 ? 'Member' : 'Members'} added.`,
    );
    this.selected.set([]);
    this.candidates.set([]);
    this.candidateQuery.set('');
  }

  protected async removeMember(member: PodMemberDto): Promise<void> {
    const current = this.detail();
    if (!current) return;
    await this.memberCall(async () => {
      await firstValueFrom(this.api.removePodMember(current.pod.podId, member.userId));
      return firstValueFrom(this.api.getPod(current.pod.podId));
    }, `${member.displayName} removed.`);
  }

  protected async togglePrimary(member: PodMemberDto): Promise<void> {
    const current = this.detail();
    if (!current) return;
    await this.memberCall(
      () =>
        firstValueFrom(
          this.api.setPrimaryPod(current.pod.podId, member.userId, {
            isPrimary: !member.isPrimary,
          }),
        ),
      member.isPrimary
        ? `${member.displayName} has no primary pod here.`
        : `${current.pod.name} is now ${member.displayName}'s primary pod.`,
    );
  }

  // ---- internals

  private async findCandidates(): Promise<void> {
    const query = this.candidateQuery().trim();
    if (query.length < 2) {
      this.candidates.set([]);
      return;
    }
    try {
      this.candidates.set(await firstValueFrom(this.api.findPodMemberCandidates(query)));
    } catch {
      this.candidates.set([]);
    }
  }

  private async memberCall(call: () => Promise<PodDetail>, message: string): Promise<void> {
    this.busy.set(true);
    try {
      const detail = await call();
      // Member changes never touch the unsaved name/description edits.
      this.detail.set(detail);
      this.announce.set(message);
      void this.load();
    } catch {
      // the HTTP layer already toasted the failure
    } finally {
      this.busy.set(false);
    }
  }

  private openEditor(
    detail: PodDetail | null,
    name: string,
    description: string,
    isActive: boolean,
  ): void {
    this.detail.set(detail);
    this.name.set(name);
    this.description.set(description);
    this.isActive.set(isActive);
    this.nameError.set('');
    this.failure.set('');
    this.confirmDeactivate.set(false);
    this.candidates.set([]);
    this.candidateQuery.set('');
    this.selected.set([]);
    this.announce.set('');
    this.editorOpen.set(true);
    this.syncUrl(detail ? String(detail.pod.podId) : 'new');
  }

  private async leaveEditor(): Promise<boolean> {
    return !this.dirty() || (await this.leaveConfirm.ask());
  }

  private showSaveError(error: unknown, name: string): void {
    if (error instanceof ApiError) {
      if (error.code === 'DUPLICATE_NAME') {
        this.nameError.set(`A pod named '${name}' already exists.`);
        return;
      }
      if (error.code === 'CONCURRENCY_CONFLICT') {
        this.failure.set('Someone else changed this pod. Reload it to see their changes.');
        return;
      }
      const fieldErrors = error.problem?.errors?.['name'];
      if (fieldErrors?.length) {
        this.nameError.set(fieldErrors[0].message);
        return;
      }
    }
    this.failure.set('The pod could not be saved. Try again.');
  }
}
