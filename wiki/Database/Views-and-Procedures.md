# Views and Procedures

[[_TOC_]]

**What this page is for.** The programmable objects of the database: the sequence, inline functions, stored procedures and triggers, with what each is for and which script created it (script numbers refer to the archived chain in `db/scripts/archive/`; all of these objects are in `db/scripts/00-baseline.sql` now, issue #1307). There are no views. Read it before you change a table that has a trigger, or when you need raw SQL that must respect the Sensitive matter rule.

Derived from `sys.objects` and `sys.triggers` of the demo database and checked against the scripts.

## Summary

| Kind | Count | Objects |
|---|---|---|
| Views | 0 | none |
| Sequences | 1 | `dbo.TaskNumberSeq` (script 01) |
| Inline table-valued functions | 3 | `fnMatterVisible`, `fnTaskVisible`, `fnAssetVisible` (script 35) |
| Stored procedures | 2 | `usp_ReportRunComplete`, `usp_ReportRunPurge` (script 30) |
| Table triggers | 20 | listed below |
| Database DDL trigger | 1 | `TR_Protect_AuditEvent` (script 13) |

## Sequence

- `dbo.TaskNumberSeq` (bigint, start 1, no cycle). `Task.TaskNumber` defaults to `'TSK-' + NEXT VALUE FOR dbo.TaskNumberSeq`.

## Functions (Sensitive matter rule, SQL twin)

The C# rule lives in `SharedKernel/Visibility`. Raw SQL readers (notification scheduler, search, dashboard, My Matters, audit) use these functions. They are inline table-valued (never scalar, which would run per row) and take the viewer as `(@UserId, @SeeAll)`. `@SeeAll` is true for the System Admin and holders of `Matter.ViewSensitive`; the application resolves it. They are denied to the report login.

| Function | Returns | Rule |
|---|---|---|
| `dbo.fnMatterVisible(@UserId, @SeeAll)` | `MatterId` | Matter is not sensitive, or `@SeeAll`, or the user is Primary or Secondary manager |
| `dbo.fnTaskVisible(@UserId, @SeeAll)` | `TaskId, MatterId` | The matter is visible, or the task is assigned to the user |
| `dbo.fnAssetVisible(@UserId, @SeeAll)` | `AssetId, MatterId` | The matter is visible, or the asset is linked to a task assigned to the user |

Tip from the script header: for set-wide counts and lists use `LEFT JOIN dbo.fnMatterVisible(@u, @s) v ON v.MatterId = t.MatterId ... WHERE (v.MatterId IS NOT NULL OR t.AssignedUserId = @u)`. The `EXISTS (...) OR ...` form probes the Matter table once per task. `fnTaskVisible` and `fnAssetVisible` are for a single id or a short list. See [Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md).

## Stored procedures (Reports)

| Procedure | Purpose |
|---|---|
| `dbo.usp_ReportRunComplete` | Completes a `ReportRun` once (Running to a final status, with row count, duration, error code). The application cannot UPDATE `ReportRun` directly |
| `dbo.usp_ReportRunPurge` | Deletes runs older than two years (owner decision) |

## Triggers on tables

| Table | Trigger | Effect (from the scripts) |
|---|---|---|
| `AuditEvent` | `TR_AuditEvent_AppendOnly` | INSTEAD OF: no update or delete (script 03) |
| `Asset` | `TR_Asset_Guard` | No delete (set inactive instead); an asset cannot move to another matter (script 10) |
| `FormVersion` | `TR_FormVersion_Immutable` | A published version cannot change (script 06) |
| `FormField` | `TR_FormField_Immutable` | Fields of a published version cannot change |
| `FormFieldOption` | `TR_FormFieldOption_Immutable` | Options of a published version cannot change |
| `Matter` | `TR_Matter_SensitivityToTask` | Copies `IsSensitive` to `Task.IsMatterSensitive` (script 37) |
| `ProductionSpec` | `TR_ProductionSpec_Guard` | A spec belongs to one matter and cannot move (script 52) |
| `ReportRun` | `TR_ReportRun_Guard` | Runs cannot be deleted before two years; only completion changes a run, its other columns never change (script 30) |
| `ReportVersion` | `TR_ReportVersion_AppendOnly` | Append-only |
| `StepInstance` | `TR_StepInstance_Immutable` | The configuration snapshot of a step instance cannot change (script 11) |
| `Task` | `TR_Task_Immutable`, `TR_Task_NoDelete`, `TR_Task_MatterSensitivityInsert` | Matter, task type, workflow and request form version cannot change after creation; no delete; sets the sensitivity copy at insert (scripts 12, 37) |
| `TaskComment` | `TR_TaskComment_Guard`, `TR_TaskComment_NoDelete` | A comment cannot change its task, author or purpose; no physical delete (script 12) |
| `TaskCommentRevision` | `TR_TaskCommentRevision_AppendOnly` | Append-only (script 14) |
| `TaskStatusLabel` | `TR_TaskStatusLabel_FixedCodes` | The five status codes cannot change (script 07) |
| `WorkflowInstance` | `TR_WorkflowInstance_Immutable` | Pinned to its workflow version, cannot be moved (script 11) |
| `WorkflowVersion` | `TR_WorkflowVersion_Immutable` | A published version cannot change (script 09) |
| `WorkflowVersionStep` | `TR_WorkflowVersionStep_Immutable` | Steps of a published version cannot change |

The error messages come from `THROW` statements in the named scripts. These guards are why some "obvious" updates (moving a task to another matter, moving an asset) are refused by SQL, not by the application.

## Database DDL trigger

`TR_Protect_AuditEvent` (script 13) refuses `DROP TABLE` of the audit tables, `ALTER TABLE` of the guard table and `DROP` or `ALTER` of the append-only trigger. A sysadmin can still disable it deliberately; detection is a monitoring task (runbook).

## Related pages

- [Database Overview](Overview.md)
- [Table Reference](Table-Reference.md)
- [Schema Script History](Schema-Script-History.md)

Last verified against commit a80aa5a.
