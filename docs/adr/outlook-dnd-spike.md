# ADR: Outlook drag-and-drop feasibility spike (new Outlook)

- Status: **Proposed - awaiting manual test results** (GitHub issue #21; architecture section 13.2)
- Context source: `docs/architecture.md` s13, `docs/requirements/decisions-addendum.md` s C (parse and discard; nothing stored; no attachments, no original email; firm uses new Outlook; paste/manual path must always work).

## 1. Context

Task creation should be prefillable from an Outlook message (Subject, Body, From name/email, sent date). The cloud environment used to prepare this spike cannot run new Outlook, so **nothing below about Outlook's actual behaviour is verified**. This ADR supplies (a) a test tool, (b) a manual protocol, (c) decision rules, and (d) parser findings so that, once results arrive, the decision is mechanical.

### Hypotheses to confirm (from general knowledge, NOT verified for new Outlook)

- Classic Outlook (Win32) dragging a message to a browser typically yields file descriptors (`FileGroupDescriptorW`/`FileContents`) that browsers generally do **not** expose to web pages as `File`s; Chrome/Edge often expose nothing useful or a `.msg` only in some cases.
- Outlook on the web (OWA) drag of a message historically produced a `DownloadURL` type (`message/rfc822:Subject.eml:https://...`) usable by Chromium only for drag-out-to-desktop, and a plain URL or no data to web drop targets.
- New Outlook (WebView2 shell around the OWA codebase) likely behaves like OWA. The page may receive only `text/plain`/`text/uri-list`/`DownloadURL`, or nothing.
- The expected outcome is C (no usable payload) or B (partial text). The spike exists to prove it.

## 2. Test tool

`tools/spike-outlook-dnd/index.html` + `spike.js`. Dependency-free; open it via `file://` (double-click) or serve locally (`python -m http.server` in that folder; drag/drop and paste do not need HTTPS, the Copy button falls back if the Clipboard API is unavailable). Nothing leaves the browser.

It logs for every `dragenter` (types/items visible mid-drag), `drop` and `paste`:
`dataTransfer.types`; `items` (kind, type); `files` (name, type, size, lastModified) plus the first 16 bytes (detects OLE `.msg` signature `D0 CF 11 E0 A1 B1 1A E1` or RFC 822 header text); `getData` for every listed type and probes (`text/plain`, `text/html`, `text/uri-list`, `text/rtf`, `message/rfc822`, `DownloadURL`, ...); asynchronous `getAsString` for each string item; clipboard HTML on paste; environment/scenario labels; user agent. **Copy report** puts the whole JSON on the clipboard (or **Download report**).

Privacy: reports contain message content. The tester must use test messages or review/redact before sending.

## 3. Manual test protocol

Preparation (once)
1. Create test messages in a test mailbox (or a harmless real one): **M1** plain-text message; **M2** rich HTML message with bold/list/link; **M3** message with two attachments (one PDF, one image) and an inline image; **M4** message with non-ASCII subject (accented + CJK); **M5** a forwarded chain (FW: FW:). Put them in a shared mailbox folder as well (**SM1** = copy of M2 in a shared mailbox the tester has Full Access to).
2. Open the test page (`index.html`) in **Edge** and in **Chrome** (repeat each scenario in both). Note versions: `Outlook > Settings > About` (new Outlook) and `edge://version`.
3. Fill the **Environment** field, e.g. `new Outlook desktop 1.2026.xxx / Edge 1xx / Win 11`.

For every scenario: set the **Scenario** field to the id, perform the action, wait ~2 s, press **Copy report (JSON)**, paste into a file named `<scenario>-<browser>.json`, then **Clear log** before the next scenario. Also note in the table whether the drop cursor showed "copy"/"not allowed" and whether anything visibly happened.

### A. New Outlook desktop (WebView2 app, toggle "New Outlook" on)

| Id | Steps |
|---|---|
| A1 | Select M1 in the message list. Drag it onto the drop zone. Release. |
| A2 | Same with M2 dragged from the list; then M2 dragged from the **reading pane header** (grab the subject line) if the app allows. |
| A3 | Select 3 messages (Ctrl+click) and drag them together onto the zone. |
| A4 | Drag M3 (with attachments) onto the zone. Then drag one **attachment chip** itself onto the zone (control: this should give a `File`). |
| A5 | Drag SM1 from the shared mailbox. |
| A6 | Drag M4 and M5 (encoding and chain). |
| A7 | Drop M2 **outside** the zone (page body) and onto the paste textarea. |
| A8 | Paste test: open M2 in the reading pane, select all (Ctrl+A) in the body, Ctrl+C, click the paste textarea, Ctrl+V. Repeat after selecting the whole message in the list and pressing Ctrl+C (copies the item; may paste nothing). Repeat with M4/M5. |
| A9 | Control: In Outlook, Save As / drag-to-desktop a message to get a `.eml` (and `.msg` if offered), then drop that desktop file on the zone. Confirms the file path works and records MIME type. |

### B. Outlook on the web (outlook.office.com / firm OWA), Edge and Chrome

Repeat B1-B9 mirroring A1-A9 (B1 single from list, B2 HTML/reading-pane, B3 multiple, B4 attachments + attachment chip, B5 shared mailbox opened via "Open another mailbox" or added shared folder, B6 non-ASCII + chain, B7 outside zone, B8 paste, B9 downloaded `.eml` dropped on zone). Also, in B1, hold **Ctrl** and **Shift** during the drag once each (modifiers can change the effect).

### C. Optional reference: classic Outlook (Win32) with M1 and M2 (C1, C2)

Only if still installed. Useful for contrast, not for the decision.

### D. Quick sanity check of the tool

Drag a `.eml` file from Explorer onto the zone: the report must show one file with a name, size and RFC 822 guess. If it does not, the tool is broken; stop and report.

## 4. Results table (to be filled in)

Legend for "Payload": F = real `File` with .eml/.msg content; H = `text/html` with message header+body; T = `text/plain` only; U = URL/`DownloadURL` only; N = nothing/blocked.

| Id | Scenario | Browser | Types seen | File? (name, size, head guess) | text/html has Subject+From+Sent+Body? | URL type? | Cursor | Payload | Notes |
|---|---|---|---|---|---|---|---|---|---|
| A1 | new Outlook desktop, single plain | Edge | | | | | | | |
| A1 | | Chrome | | | | | | | |
| A2 | single HTML (list / reading pane) | Edge | | | | | | | |
| A3 | multiple (3) | Edge | | | | | | | |
| A4 | with attachments; attachment chip control | Edge | | | | | | | |
| A5 | shared mailbox | Edge | | | | | | | |
| A6 | non-ASCII; forwarded chain | Edge | | | | | | | |
| A7 | drop outside zone / textarea | Edge | | | | | | | |
| A8 | paste from body / from list | Edge | | | | | | | |
| A9 | control: desktop .eml/.msg file drop | Edge | | | | | | | |
| B1 | OWA single plain | Edge | | | | | | | |
| B1 | | Chrome | | | | | | | |
| B2 | OWA HTML | Edge | | | | | | | |
| B3 | OWA multiple | Edge | | | | | | | |
| B4 | OWA attachments + chip | Edge | | | | | | | |
| B5 | OWA shared mailbox | Edge | | | | | | | |
| B6 | OWA non-ASCII; chain | Edge | | | | | | | |
| B7 | OWA outside zone / textarea | Edge | | | | | | | |
| B8 | OWA paste | Edge | | | | | | | |
| B9 | control: .eml file drop | Edge | | | | | | | |

Repeat rows for Chrome where they differ from Edge.

## 5. Decision rules

Evaluate on **new Outlook desktop and OWA** (the firm's environments), single message from the list (A1/B1) as the primary scenario.

1. **Ship drag-drop (outcome A)**: in A1 *and* B1 (at least in Edge, the firm's browser) the drop yields a `File` whose head guess is OLE (`.msg`) or RFC 822 (`.eml`), size > 0, reproducibly (3 of 3 attempts), for M1, M2 and M4. Multiple-message drops (A3) may return several files; support the first or reject with a message, but it must not break. Attachment-bearing messages (A4) must also yield one message file. Then the dropzone posts the file to `POST /api/v1/intake/parse-email`.
2. **Ship drag-drop via HTML (outcome B)**: no file, but `text/html` (or `text/plain`) contains *deterministically* Subject, From (name and address), Sent and Body for single messages in A1/B1/A2/B2, 3 of 3. Then feed it through the same client-side paste parser and label the dropzone "beta". If any one of Subject/From/Sent is missing in either environment, this is **not** pass; treat as C.
3. **Paste + file picker only (outcome C)**: neither of the above, i.e. only URLs (`DownloadURL`, `text/uri-list` to Outlook-protected resources needing auth), empty payloads, or inconsistent results. UI documents "drag-and-drop from new Outlook is not supported; use Paste email or Choose .eml/.msg (save the message first)". The paste/picker path ships in Phase 1 regardless.
4. **Propose an Outlook add-in** (separate estimate, not Phase 1) if the product owner states that Save-then-pick and paste are too slow in practice **and** outcome C holds. An add-in ("Create MatterFlow task") reads the item through Office.js (`subject`, `from`, `dateTimeCreated`/`body.getAsync`) and posts to the same endpoint, which needs no file at all, no parse of .eml/.msg, and works in new Outlook and OWA. Cost: tenant admin deployment, manifest, hosting, SSO/auth to MatterFlow.
5. A URL-only payload is never fetched by MatterFlow (it would need the user's Microsoft session, and we store/handle nothing). Record it; it does not count as success.

If results are mixed (e.g. desktop works, OWA does not), ship what works as an enhancement behind feature detection (a drop with no usable payload shows a hint toward Paste/Choose file) and document the limitation.

## 6. Parser-side findings (server, .NET, in memory)

Library status was checked on nuget.org pages on 2026-10-14 (versions/dates as displayed there; re-check at implementation time).

| Purpose | Package | Version seen | License | Notes |
|---|---|---|---|---|
| .eml / MIME (RFC 5322, 2045-2047, 2231) | **MimeKit** (jstedfast) | 4.18.1 (updated 2026-09-19) | MIT | .NET 8, netstandard2.0, net462; actively maintained; the de-facto standard. Handles RFC 2047 encoded words, charsets, nested multiparts, malformed input leniently |
| .msg (OLE compound, MS-OXMSG) | **MsgReader** (Sicos1977) | 6.2.0 (updated 2026-10-12) | MIT | Targets .NET 8/9/10, netstandard2.0/2.1, net462. Exposes subject, sender name/email, `SentOn`, body text/HTML/RTF (converts RTF via RtfPipe), attachments. Depends on OpenMcdf (MPL-2.0), RtfPipe, Microsoft.IO.RecyclableMemoryStream, UTF.Unknown, Microsoft.Maui.Graphics, System.Security.Cryptography.Pkcs |
| HTML to text | **HtmlAgilityPack** | 1.13.1 (updated 2026-10-12) | MIT | Parse leniently, drop script/style/head, walk nodes to text |
| (optional) HTML sanitizer | **HtmlSanitizer** (mganss) | 9.2.1039 stable (updated 2026-08-28) | MIT | Only needed if HTML is ever kept as HTML. For HTML-to-plain-text, the text extraction itself removes markup, so sanitizing is redundant; skip it unless the Description will render HTML |
| OLE (transitive) | OpenMcdf | 3.3.0 (updated 2026-09-03) | **MPL-2.0** (file-level copyleft; fine as an unmodified NuGet dependency, but record it in the third-party license inventory) | |

Not verified: whether MsgReader's transitive `Microsoft.Maui.Graphics` dependency (listed by NuGet for net8.0) is acceptable for a server deployment footprint; check restore size and that no native/platform assets are pulled. Alternative if it is not: parse `.msg` with OpenMcdf directly (read `__substg1.0_0037001F` Subject, `...0C1A001F` sender name, `...5D01001F`/`...0C1F001F` sender email, `__properties_version1.0` for `PR_CLIENT_SUBMIT_TIME`/`PR_MESSAGE_DELIVERY_TIME`, `...1000001F` body, `...1013` HTML) but this is more code to maintain. Recommend MsgReader first. Licenses of MsgReader/MimeKit/HtmlAgilityPack/HtmlSanitizer/OpenMcdf were taken from NuGet pages; I did not read the repositories' LICENSE files.

### Recommended server approach

- Endpoint per architecture s13: multipart, one `file`, cap size, buffer into a `MemoryStream` (never a temp file; disable request buffering to disk; content excluded from logs).
- Decide format by content, not extension: OLE signature `D0 CF 11 E0 A1 B1 1A E1` -> MsgReader; otherwise try MimeKit `MimeMessage.LoadAsync(stream)`. A drag may give the wrong extension or MIME type.
- **.eml (MimeKit)**: `Subject` (already RFC 2047 decoded); `From.Mailboxes.FirstOrDefault()` -> `Name`, `Address` (use `Sender` only if `From` is empty); `Date` (a `DateTimeOffset`; if the header is missing/invalid fall back to the first `Received` date or leave null with a warning; convert to UTC). Body: `message.TextBody` (prefers text/plain); if null, `message.HtmlBody` -> text. Do not enumerate `Attachments` (do not read filenames); MimeKit's `TextBody`/`HtmlBody` already skip attachment parts. Set `ParserOptions` with a sane limit; wrap in a timeout and catch all parse exceptions -> `EMAIL_PARSE_FAILED`.
- **.msg (MsgReader `Storage.Message`)**: `Subject`, `Sender.DisplayName` / `Sender.Email` (for Exchange-internal senders the SMTP address may be an X.500/EX address; prefer the SMTP property (`PR_SENDER_SMTP_ADDRESS`) where available and add a warning if the address does not contain `@`), `SentOn` (fall back to `ReceivedOn`), `BodyText`; if empty, `BodyHtml` (or RTF-derived HTML) -> text. Never touch `Attachments`. Dispose the message and stream; ensure MsgReader is not configured to extract to disk.
- **HTML to text**: HtmlAgilityPack; remove `script`, `style`, `head`, comments; `<br>`/`</p>`/`</div>`/`</li>`/`</tr>` -> newlines; `<li>` -> `- `; `<a href>` -> `text (url)` when the text differs from the URL and only for http/https/mailto; decode entities; collapse runs of whitespace and more than 2 blank lines; drop `cid:` and `data:` URLs (inline images); never fetch remote resources. Because the output is plain text there is no XSS surface; the front end must render the Description as text.
- **Truncate** at 20,000 chars with a warning; Title = Subject truncated to 300.
- **Forwarded chains**: the sender and date are those of the outermost message (the person forwarding), which is also the Requestor semantics (the person who sent it to the team). Do not try to dig into the nested header block on the server; the quoted chain remains in the body text. Make this explicit to the product owner. Sample `05-forwarded-chain.eml` covers it.
- **Failure modes to test**: no `From`; group address; multiple From mailboxes; missing Date; naive Date without zone (MimeKit parses to a `DateTimeOffset` with offset 0, treat as UTC); wrong encoding labels; HTML with huge nested tables; 25 MB input; zip-bomb-like deeply nested multiparts (MimeKit depth is limited by the stack/`ParserOptions`; verify, and apply a timeout).

### Pasted-text handling (client-side, deterministic)

Input arrives as either `text/html` or `text/plain` from the clipboard (new Outlook / OWA copies from the reading pane give HTML of the *body only*, usually without a header block; copying from the message *header* area may include From/Sent/To/Subject lines). Algorithm:

1. Prefer `text/plain`. If only `text/html`, convert via `DOMParser` (no script execution) to text with the same rules as the server converter.
2. Normalize line endings; trim. Look at the first ~15 non-empty lines for a header block, case-insensitive, English labels `From:`, `Sent:` or `Date:`, `To:`, `Cc:`, `Subject:` (also tolerate `De:`/`Von:`/`Envoy.`... as a later localisation backlog item, not Phase 1). A block is recognized only if it has at least `From` plus one of `Sent`/`Date`/`Subject`.
3. `Subject:` -> Title. `From:` -> split `Name <email>` / `"Name" <email>` / bare email / `Name [email]`; if only a name, leave email empty. `Sent:`/`Date:` -> parse with several formats (`Thursday, October 15, 2026 3:10 PM`, ISO, RFC 2822) interpreted in the firm timezone when no zone is present; on failure leave `RequestedAt` empty.
4. Body = everything after the header block (and after a blank line). If no header block is found: the whole text goes to Description, the Title may be prefilled from the first non-empty line only if shorter than 150 chars and the user confirms (prefer leaving Title blank).
5. Only the **first** header block is treated as the message header; later `From:/Sent:` blocks (replies/forwards) stay in the body.
6. The user always reviews/edits every prefilled field. Unit-test the helper with vectors made from the sample `.eml` files and real pasted Outlook text collected by the spike's `paste` events (the product owner's JSON reports provide these vectors).

## 7. Consequences

- Architecture s13 stays valid: server endpoint (MimeKit + MsgReader) serves both file picker and, if applicable, drop. The spike result determines only whether the dropzone ships.
- Third-party license inventory gains MimeKit (MIT), MsgReader (MIT), HtmlAgilityPack (MIT), OpenMcdf (MPL-2.0) and their transitives.
- Samples in `tools/spike-outlook-dnd/samples/` (01 plain, 02 HTML-only with script/style/QP, 03 multipart with attachment, 04 UTF-8 encoded-word subject/sender and base64 body, 05 forwarded chain) are fixtures for parser tests. There are no `.msg` samples: a valid `.msg` must be produced by Outlook (A9/B9 save); the product owner should supply 2-3 non-confidential ones.

## 8. What the product owner must do

1. Run the protocol in section 3 on the firm's new Outlook desktop and OWA, with Edge (and Chrome if used).
2. Fill the table in section 4 (or just send the JSON reports plus the Scenario ids) and send back reports; supply 2-3 non-confidential `.msg` files saved from Outlook.
3. Then the status of this ADR is changed to Accepted with outcome A, B or C per section 5.
