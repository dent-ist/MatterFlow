import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { IntakeClient, ParsedEmailResponse } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { ApiError } from '../../core/http/api-error';
import { MfDatePipe } from '../pipes/mf-date.pipe';
import { TextField } from './text-field';

/** The values the host prefills a Create Task form with. A field is present only when the user chose to replace it. */
export interface EmailPrefill {
  title?: string;
  description?: string;
  requestorName?: string;
  requestorEmail?: string;
  /** Sent date of the email, UTC ISO 8601. */
  requestedAt?: string;
}

/** What the form already holds, so the review panel can default to Keep for non-empty fields. */
export interface EmailIntakeExisting {
  title?: string;
  description?: string;
  requestorName?: string;
  requestorEmail?: string;
}

type Phase = 'idle' | 'loading' | 'error' | 'review' | 'done';
type FieldKey = 'title' | 'description' | 'requestorName' | 'requestorEmail';

/** Largest email file the server reads (matches the API limit). */
export const MAX_EMAIL_FILE_BYTES = 10 * 1024 * 1024;

const FIELD_LABELS: Record<FieldKey, string> = {
  title: 'Title',
  description: 'Description',
  requestorName: 'Requestor name',
  requestorEmail: 'Requestor email',
};

/** localStorage key of the panel's last open/closed choice. */
export const EMAIL_PANEL_STORAGE_KEY = 'mf.emailIntake.open';

function readOpenChoice(): boolean | null {
  try {
    const value = localStorage.getItem(EMAIL_PANEL_STORAGE_KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null; // storage blocked (private window, site data cleared): use the default
  }
}

function writeOpenChoice(open: boolean): void {
  try {
    localStorage.setItem(EMAIL_PANEL_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // not remembered; the panel still works
  }
}

const DROP_FAILED = "We couldn't read that drop. Paste the email text or choose a file instead.";

/**
 * "Quick fill from email" (UX S09, architecture 13): paste the email text, choose a saved `.eml`/`.msg` file, or drop a file/text on the
 * zone. The server (or the paste heuristics behind it) reads subject, body, sender and sent date and discards the original; the user
 * reviews and edits the values and applies them, which emits `prefill`. Paste and the file picker always work; drag-and-drop is an
 * enhancement and makes no promise for Outlook. Renders only for users who may create Tasks.
 */
@Component({
  selector: 'mf-email-intake',
  imports: [Button, TextField, MfDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './email-intake.scss',
  template: `
    @if (allowed()) {
      <section class="ei" aria-labelledby="ei-title" data-email-intake>
        <div class="ei__head">
          <h2 class="ei__title" id="ei-title">Quick fill from email</h2>
          <button
            type="button"
            class="mf-btn"
            data-email-toggle
            [attr.aria-expanded]="open()"
            [attr.aria-controls]="open() ? 'ei-body' : null"
            (click)="toggle()"
          >
            @if (!open()) {
              <i class="pi pi-envelope" aria-hidden="true"></i>
            }
            {{ open() ? 'Hide' : 'Fill from email' }}
          </button>
        </div>

        @if (open()) {
          <div class="ei__body" id="ei-body">
            <p class="ei__note" data-privacy-note>
              We read the subject, body, sender and sent date. Attachments and the original email
              are not saved.
            </p>
            <p class="ei__note ei__note--privilege" data-privilege-note>
              <i class="pi pi-lock" aria-hidden="true"></i>
              Privilege reminder: email content you paste or load is saved in the task description.
              Remove anything that should not be stored.
            </p>

            <div
              class="ei__drop"
              role="button"
              tabindex="0"
              data-dropzone
              aria-label="Drop an email file here, or press Enter to paste email text"
              [class.ei__drop--over]="dragging()"
              (dragenter)="onDragOver($event)"
              (dragover)="onDragOver($event)"
              (dragleave)="dragging.set(false)"
              (drop)="onDrop($event)"
              (keydown.enter)="focusPaste()"
              (keydown.space)="$event.preventDefault(); focusPaste()"
            >
              Drop a saved .eml or .msg file here
              <span class="ei__hint">
                Dragging straight from Outlook may not work in your browser. Paste or Choose file
                always works.
              </span>
            </div>

            <div class="ei__paste">
              <label class="ei__label" for="ei-paste">Paste email text</label>
              <textarea
                #pasteBox
                id="ei-paste"
                class="ei__textarea"
                rows="5"
                placeholder="Copy the email in Outlook (including From, Sent and Subject lines) and paste it here"
                [value]="pasted()"
                [disabled]="phase() === 'loading'"
                (input)="pasted.set($any($event.target).value)"
              ></textarea>
            </div>

            <div class="ei__actions">
              <p-button
                label="Fill from pasted text"
                icon="pi pi-clipboard"
                severity="secondary"
                [disabled]="phase() === 'loading' || !pasted().trim()"
                (onClick)="readPasted()"
              />
              <p-button
                label="Choose .eml/.msg file"
                icon="pi pi-folder-open"
                severity="secondary"
                [disabled]="phase() === 'loading'"
                (onClick)="openPicker()"
              />
              <input
                #fileInput
                type="file"
                class="ei__file"
                accept=".eml,.msg"
                tabindex="-1"
                aria-label="Choose an .eml or .msg file"
                (change)="onFileChosen($event)"
              />
            </div>

            <div class="ei__live" role="status" aria-live="polite" data-live>
              {{ liveMessage() }}
            </div>

            @switch (phase()) {
              @case ('loading') {
                <div class="ei__state" aria-busy="true" data-loading>
                  <i class="pi pi-spin pi-spinner" aria-hidden="true"></i> Reading the email...
                </div>
              }
              @case ('error') {
                <div class="ei__alert" role="alert" data-error>{{ error() }}</div>
              }
              @case ('done') {
                <div class="ei__done" data-done>
                  <i class="pi pi-check-circle" aria-hidden="true"></i>
                  {{ doneMessage() }}
                  <button type="button" class="ei__link" (click)="clear()">Clear</button>
                </div>
              }
              @case ('review') {
                <div class="ei__review" data-review>
                  @if (nothingFound()) {
                    <div class="ei__alert" role="alert" data-empty>
                      We couldn't find a subject, sender or body in that email. Fill the task in
                      manually, or try pasting the text instead.
                    </div>
                  }
                  @for (w of warnings(); track w) {
                    <p class="ei__warning" data-warning>
                      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ w }}
                    </p>
                  }
                  <h3 class="ei__subtitle">Review before filling the task</h3>

                  <mf-text-field
                    label="Title"
                    inputId="ei-f-title"
                    [maxLength]="300"
                    [(value)]="title"
                    [help]="title() ? '' : 'The email has no subject; type a title.'"
                  />
                  <label class="ei__replace">
                    <input
                      type="checkbox"
                      data-replace="title"
                      [checked]="replace().title"
                      (change)="setReplace('title', $any($event.target).checked)"
                    />
                    {{ replaceLabel('title') }}
                  </label>

                  <mf-text-field
                    label="Description"
                    inputId="ei-f-description"
                    [multiline]="true"
                    [maxLength]="20000"
                    [(value)]="description"
                    help="Plain text. Signatures and quoted messages are kept; trim what you do not need."
                  />
                  <label class="ei__replace">
                    <input
                      type="checkbox"
                      data-replace="description"
                      [checked]="replace().description"
                      (change)="setReplace('description', $any($event.target).checked)"
                    />
                    {{ replaceLabel('description') }}
                  </label>

                  <mf-text-field
                    label="Requestor name"
                    inputId="ei-f-name"
                    [maxLength]="200"
                    [(value)]="requestorName"
                    [help]="confirmName() ? 'Please confirm the name.' : ''"
                  />
                  <label class="ei__replace">
                    <input
                      type="checkbox"
                      data-replace="requestorName"
                      [checked]="replace().requestorName"
                      (change)="setReplace('requestorName', $any($event.target).checked)"
                    />
                    {{ replaceLabel('requestorName') }}
                  </label>

                  <mf-text-field
                    label="Requestor email"
                    inputId="ei-f-email"
                    [maxLength]="320"
                    [(value)]="requestorEmail"
                    [error]="emailError()"
                  />
                  <label class="ei__replace">
                    <input
                      type="checkbox"
                      data-replace="requestorEmail"
                      [checked]="replace().requestorEmail"
                      (change)="setReplace('requestorEmail', $any($event.target).checked)"
                    />
                    {{ replaceLabel('requestorEmail') }}
                  </label>

                  <p class="ei__sent" data-sent>
                    Source email sent:
                    @if (sentAt(); as s) {
                      {{ s | mfDate }}
                    } @else {
                      not found in the email
                    }
                  </p>

                  <div class="ei__actions">
                    <p-button
                      label="Fill the task"
                      icon="pi pi-check"
                      [disabled]="!!emailError()"
                      (onClick)="apply()"
                    />
                    <p-button
                      label="Cancel"
                      severity="secondary"
                      [text]="true"
                      (onClick)="clear()"
                    />
                  </div>
                </div>
              }
            }
          </div>
        }
      </section>
    }
  `,
})
export class EmailIntake {
  /** What the form holds now, so non-empty fields default to Keep in the review. */
  readonly existing = input<EmailIntakeExisting>({});
  /**
   * Start expanded? Collapsed by default (UXR-38): the essentials of the form come first. The person's last choice, made with the
   * Fill from email / Hide button, is remembered in this browser and wins over this default.
   */
  readonly expanded = input(false);

  /** The reviewed values to put into the form. */
  readonly prefill = output<EmailPrefill>();

  private readonly api = inject(IntakeClient);
  private readonly auth = inject(AuthStore);

  private readonly pasteBox = viewChild<ElementRef<HTMLTextAreaElement>>('pasteBox');
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly allowed = computed(() => this.auth.has('Task.Create'));
  protected readonly open = linkedSignal(() => readOpenChoice() ?? this.expanded());
  protected readonly phase = signal<Phase>('idle');
  protected readonly error = signal('');
  protected readonly dragging = signal(false);
  protected readonly pasted = signal('');
  protected readonly liveMessage = signal('');
  protected readonly doneMessage = signal('');

  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly requestorName = signal('');
  protected readonly requestorEmail = signal('');
  protected readonly sentAt = signal<string | null>(null);
  protected readonly warnings = signal<string[]>([]);
  protected readonly confirmName = signal(false);
  protected readonly replace = signal<Record<FieldKey, boolean>>({
    title: true,
    description: true,
    requestorName: true,
    requestorEmail: true,
  });

  protected readonly nothingFound = computed(
    () => !this.title() && !this.description() && !this.requestorName() && !this.requestorEmail(),
  );

  protected readonly emailError = computed(() => {
    const value = this.requestorEmail().trim();
    return value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      ? 'Enter a valid email address.'
      : null;
  });

  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);
    writeOpenChoice(next);
  }

  protected replaceLabel(key: FieldKey): string {
    const hasExisting = !!this.existing()[key]?.trim();
    return hasExisting
      ? `Replace the current ${FIELD_LABELS[key].toLowerCase()}`
      : `Fill ${FIELD_LABELS[key].toLowerCase()}`;
  }

  protected setReplace(key: FieldKey, value: boolean): void {
    this.replace.update((r) => ({ ...r, [key]: value }));
  }

  protected openPicker(): void {
    this.fileInput()?.nativeElement.click();
  }

  protected focusPaste(): void {
    this.open.set(true);
    queueMicrotask(() => this.pasteBox()?.nativeElement.focus());
  }

  // --- input paths ---------------------------------------------------------------------------

  protected async readPasted(): Promise<void> {
    const text = this.pasted().trim();
    if (!text || this.phase() === 'loading') return;
    await this.run(() => firstValueFrom(this.api.parseEmailText({ pastedText: text })));
  }

  protected async onFileChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // the same file can be chosen again
    if (file) await this.readFile(file);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.dragging.set(true);
  }

  protected async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragging.set(false);
    if (this.phase() === 'loading') return;
    const data = event.dataTransfer;
    if (!data) return this.dropFailed();

    const file = Array.from(data.files ?? []).find((f) => /\.(eml|msg)$/i.test(f.name));
    if (file) return this.readFile(file);

    // No file: some sources drop the message as text or HTML. Read it like pasted text (best effort).
    const text = textFromDrop(data);
    if (text) {
      this.pasted.set(text);
      return this.readPasted();
    }

    this.dropFailed();
  }

  private dropFailed(): void {
    this.fail(DROP_FAILED);
    this.focusPaste();
  }

  private async readFile(file: File): Promise<void> {
    if (!/\.(eml|msg)$/i.test(file.name)) {
      this.fail('Choose a .eml or .msg file, or paste the email text.');
      return;
    }
    if (file.size > MAX_EMAIL_FILE_BYTES) {
      this.fail(
        'That file is larger than 10 MB. Save a smaller message or paste the text instead.',
      );
      return;
    }
    if (file.size === 0) {
      this.fail('That file is empty. Paste the email text instead.');
      return;
    }
    await this.run(() =>
      firstValueFrom(this.api.parseEmailFile({ data: file, fileName: file.name })),
    );
  }

  // --- flow ------------------------------------------------------------------------------------

  private async run(call: () => Promise<ParsedEmailResponse>): Promise<void> {
    this.phase.set('loading');
    this.error.set('');
    this.liveMessage.set('Reading the email.');
    try {
      this.show(await call());
    } catch (err) {
      this.fail(messageFor(err));
    }
  }

  private show(result: ParsedEmailResponse): void {
    const existing = this.existing();
    const fromName = result.fromName?.trim() ?? '';
    const email = result.fromEmail?.trim() ?? '';
    const guessed = !fromName && !!email ? email.split('@')[0] : '';

    this.title.set(result.subject ?? '');
    this.description.set(result.body ?? '');
    this.requestorName.set(fromName || guessed);
    this.requestorEmail.set(email);
    this.confirmName.set(!!guessed);
    this.sentAt.set(result.sentAt ?? null);
    this.warnings.set(result.warnings ?? []);
    this.replace.set({
      title: !existing.title?.trim(),
      description: !existing.description?.trim(),
      requestorName: !existing.requestorName?.trim(),
      requestorEmail: !existing.requestorEmail?.trim(),
    });
    this.phase.set('review');
    this.liveMessage.set('Email read. Review the values below.');
  }

  private fail(message: string): void {
    this.error.set(message);
    this.phase.set('error');
    this.liveMessage.set(message);
  }

  protected apply(): void {
    if (this.emailError()) return;
    const r = this.replace();
    const out: EmailPrefill = {};
    const filled: string[] = [];
    if (r.title && this.title().trim()) {
      out.title = this.title().trim();
      filled.push('Title');
    }
    if (r.description && this.description().trim()) {
      out.description = this.description().trim();
      filled.push('Description');
    }
    if (r.requestorName && this.requestorName().trim()) {
      out.requestorName = this.requestorName().trim();
      filled.push('Requestor name');
    }
    if (r.requestorEmail && this.requestorEmail().trim()) {
      out.requestorEmail = this.requestorEmail().trim();
      filled.push('Requestor email');
    }
    const sent = this.sentAt();
    if (sent) {
      out.requestedAt = sent;
      filled.push('Sent date');
    }

    this.prefill.emit(out);
    this.doneMessage.set(filled.length ? `Filled ${filled.join(', ')}.` : 'Nothing was filled.');
    this.liveMessage.set(this.doneMessage());
    this.phase.set('done');
  }

  protected clear(): void {
    this.phase.set('idle');
    this.error.set('');
    this.pasted.set('');
    this.title.set('');
    this.description.set('');
    this.requestorName.set('');
    this.requestorEmail.set('');
    this.sentAt.set(null);
    this.warnings.set([]);
    this.liveMessage.set('');
  }
}

/** Plain text from a drop's `text/plain`, else the visible text of its `text/html`; empty when neither carries anything usable. */
function textFromDrop(data: DataTransfer): string {
  const plain = safeGet(data, 'text/plain').trim();
  if (plain && !/^https?:\/\/\S+$/i.test(plain)) return plain;
  const html = safeGet(data, 'text/html');
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html'); // inert: scripts do not run
  doc.querySelectorAll('script,style,head').forEach((n) => n.remove());
  return (doc.body?.innerText ?? doc.body?.textContent ?? '').trim();
}

function safeGet(data: DataTransfer, type: string): string {
  try {
    return data.getData(type) ?? '';
  } catch {
    return '';
  }
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.isNetworkError)
      return "We couldn't reach the server. Check your connection and try again.";
    if (err.status === 403) return "You don't have permission to create tasks.";
    return err.message || 'We could not read that email. Paste the email text instead.';
  }
  return 'We could not read that email. Paste the email text instead.';
}
