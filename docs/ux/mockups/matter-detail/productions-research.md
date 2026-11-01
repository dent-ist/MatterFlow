# How law firms manage productions: short research note

Written 2026-11-01 for the Matter detail mockups (WPx). This is working knowledge of common eDiscovery practice (EDRM stages, FRCP Rules 26 and 34, ESI protocols, and the way review platforms such as Relativity, Everlaw, Reveal and Concordance-style load files behave). I had no web access to cite sources, so treat the details as a starting list for a litigation-support lead to confirm, not as legal advice. Where jurisdictions differ I say so.

## 1. What a "production" is

A production is a delivery of documents (and data) from one party to another in a case. It is the "Production" stage of the EDRM model, after Review. Most matters have several productions, called **volumes** (VOL001, VOL002, ...), often tied to a request set, a rolling deadline, or a court order. Productions flow in **both directions**: the firm produces for its client, and receives productions from the opposing party and from third parties (subpoena responses). Both need tracking, which is why the mockup has a Direction.

## 2. Things teams track for each production

| Group | What | Why it matters |
| --- | --- | --- |
| Identity | Production name, volume number, matter, linked request or order | Referred to in letters and meet-and-confers |
| Direction and parties | Produced by us / received; producing party type (our company, our client, opposing party, other company or third party); recipient | Decides who holds the privilege log, who signs the receipt |
| Bates | Prefix, number of digits, first and last number (and range per volume), confidentiality stamp | Every page needs a unique, continuous number; reused or gapped numbers cause disputes |
| Volume | Document count, page count, native count, size, custodians, date range | Used in cover letters and to reconcile with the review platform |
| Spec / protocol | Agreed format (see section 3) | The other side can object if a production does not follow the protocol |
| Privilege | Withheld count, redaction count, privilege log reference, FRE 502(d) order or clawback agreement | Inadvertent disclosure is the main legal risk |
| QC | Checklist and sign-off: Bates continuity, load file validates, counts match, privilege screen, sample check | The step that catches most errors before delivery |
| Delivery | Method (SFTP, secure link, encrypted drive by courier, platform share), delivery date, who sent it, encryption and password handling | Proof of timely delivery |
| Receipt | Acknowledgement date and by whom; defects reported by the recipient | Closes the loop; starts the clock for deficiency letters |
| Clawback | Request date, documents involved, status (quarantined, returned, destroyed), certification | Must be traceable and fast (often 5 business days) |
| Comments and history | Free discussion plus an audit trail of status changes | Production is high risk, so changes need a trail |

## 3. The production specification (protocol)

Usually agreed in an ESI protocol, a court order, or an exchange of letters or email, and often amended during the case. A spec normally defines:

- **Image format:** TIFF (single-page, Group IV black and white, 300 dpi) is still the common default; colour TIFF or JPG for documents where colour matters; searchable PDF for small productions; or **native only** for spreadsheets, audio, video and databases.
- **Natives:** which file types are produced natively (Excel, PowerPoint, audio, video, CAD), with a **slip sheet** image carrying the Bates number and a link to the native.
- **Text:** document-level extracted text where it exists, OCR for scans and for redacted documents (never the original text of a redacted document).
- **Load file:** DAT (Concordance delimited, with the standard delimiter characters) plus OPT (Opticon image cross-reference), or LFP (IPRO), or CSV for simple cases; encoding (UTF-8 or ANSI); one load file per volume.
- **Metadata fields:** the agreed list, typically 20 to 35 fields: BegBates, EndBates, BegAttach, EndAttach, Custodian, All Custodians, From, To, CC, BCC, Subject, DateSent, TimeSent, DateReceived, FileName, FileExtension, FilePath, Author, DateCreated, DateLastModified, MD5Hash, Title, Confidentiality, Redacted (Y/N), NativeLink, TextLink.
- **Families:** parent and attachments produced together; relationship fields (BegAttach/EndAttach).
- **De-duplication:** global, per custodian, or none; hash type (MD5 or SHA-1); whether an "All Custodians" field lists the other holders of a duplicate; near-duplicate and email threading rules.
- **Dates and time:** format (MM/DD/YYYY or ISO 8601), 12 or 24 hour, time zone (often UTC) for the whole production.
- **Redaction and privilege:** how redactions look (burned-in "REDACTED" or "PRIVILEGED"), whether slip sheets are produced for withheld documents, privilege log format and deadline.
- **Confidentiality designation:** stamp text per protective order (for example "CONFIDENTIAL", "HIGHLY CONFIDENTIAL").
- **Custodians and sources:** which custodians, systems and date ranges are in scope; search terms or TAR (technology-assisted review) validation if agreed.
- **Naming and numbering:** Bates and control number format, volume folder structure (IMAGES, NATIVES, TEXT, DATA).
- **Delivery and security:** encryption (AES-256), password sent separately, hard-drive labelling, return or destruction at the end.

A matter can have more than one spec: a general ESI protocol, a smaller one for a subpoena response, a special one for structured data. Specs change, so the system should keep **which spec version a production was built with**.

## 4. The usual lifecycle

1. Request or order received (due date set).
2. Scope agreed: custodians, date range, spec.
3. Collect, process, review, privilege screen, redact.
4. Build the production set: Bates numbers assigned, images and natives generated, load file exported.
5. QC (counts, Bates continuity, load file validation, sample review, privilege re-check).
6. Cover letter, privilege log (if required), delivery.
7. Receipt acknowledged. Deficiency letters or clawback requests handled.
8. Volume closed. Report kept with the matter (what was produced, when, how, by whom).

Suggested statuses in the mockup: Draft, In QC, Ready to deliver, Delivered, Acknowledged; for incoming: Received; and a flag-style status Clawback requested. The status set is a proposal for the owner to adjust.

## 5. What the mockup models, and what it leaves out

Modelled: volume, name, direction, producing party type and name, recipient, spec link, Bates prefix/digits/first/last with a live preview, document/page/native counts, redaction and withheld counts, privilege log reference, custodians, date range, QC checklist, delivery method and dates, receipt, clawback note, comments, history, and a Specs list with duplicate and retire.

Left out on purpose (for later): linking produced documents from the review database (the production set itself stays in the review platform), automatic Bates overlap detection across all volumes, deficiency-letter tracking, cover-letter generation, per-document clawback lists, and spec versioning screens (the data model section of the README proposes how).

## 6. Questions for the owner or a litigation-support lead

1. Is MatterFlow only the tracker (as assumed), or should it ever generate Bates ranges for the review platform?
2. Should Bates ranges be checked for overlap across volumes of the same matter (recommended, cheap)?
3. Which statuses does the firm already use for productions?
4. Does the firm need to keep a privilege log inside MatterFlow, or only reference the one in the review platform?
5. Are specs shared across matters of the same client (a client "template")? The mockup keeps specs per matter, as requested, with Duplicate to copy one in.
