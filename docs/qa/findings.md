# QA findings and resolutions

Raised by the QA lead on 2026-10-14; resolved by the project manager unless marked **PO** (needs product owner confirmation). Numbering is referenced by `test-plan.md` and `risk-register.md`.

| ID | Finding | Resolution |
|---|---|---|
| FND-01 | Addendum A says Cancel "at any time", but architecture/UX forbade Completed -> Cancelled. | **Allowed** directly with `Task.Cancel` + comment (matrix updated). |
| FND-02 | A NEW Task could not be Completed, though addendum K lets the user click Complete. | **Allowed** from NEW; bulk-complete applies. |
| FND-03 | Permission codes drift between UX spec and architecture (`Task.Reassign`, `Workflow.StepEdit`, `Role.Manage` vs `User.Manage`, `Matter.SetActive`, Cancel gated by `Task.Comment`). | Architecture section 6.3 and `contracts/permissions.json` are the source of truth; UX spec follows. |
| FND-04 | Old/new values in Task Activity: open to `Task.View` (architecture) vs `Audit.View` (UX). | **Task.View** (Phase 1 has no per-Matter restrictions); `Audit.View` gates the admin audit browser only. |
| FND-05 | Bulk-complete all-or-nothing vs partial. | **All-or-nothing** in one transaction (addendum K). |
| FND-06 | Step reopen on a Completed Task bypasses `Task.Reopen`. | Keep architecture: `Workflow.StepReopen` is enough (technicians reopen freely, audited). |
| FND-07 | Core custom fields re-validated on every save, so a new required field blocks unrelated edits. | Validate **only changed fields** on update. |
| FND-08 | Number edge cases undefined (`0`, `000343`, whitespace). | Trim whitespace; accept ASCII digits, 1 to 5 characters; reject `0`/all zeros and 6+ characters. |
| FND-09 | Step actions blocked while a Task is On Hold. | Keep blocked (resume first). **PO** may revisit. |
| FND-10 | Baseline sort order conflicts with addendum G. | Addendum wins (ASAP above explicit due dates within priority). |
| FND-11 | The Cancel comment could be soft-deleted. | Cancel comments are **not deletable**. |
| FND-12 | Hidden form values are dropped on every save. | Warn the user before dropping; audit dropped keys. |
| FND-13 | OPEN-05 still listed as open. | Closed by addendum K. |
| FND-14 | Seed volumes inconsistent. | 1,000 Matters x 250 Assets; about 5,000 Tasks; 300 users. |
| FND-15 | Inactive Client / Project semantics undefined. | Inactive Client blocks new Matters; inactive Project blocks new Tasks; existing records keep working. |
| FND-16 | Pod Work scope unclear given addendum E. | Everyone with `Task.View` sees all Tasks; Pod Work is a filtered view, not a security boundary. |
| FND-17 | A numeric search term matches Client, Matter and Task at once. | Keep; group results by type; test it. |
| FND-18 | Baseline still describes removed features. | Errata banner added to the baseline. |
| FND-19 | Permission refresh timing assumes a single node. | Documented as assumption A-1/A-13. |
| FND-20 | Spec hygiene: baseline section numbering, SCN-017 vs addendum C, K dialog copy. | Addendum overrides; fix numbering opportunistically. |
