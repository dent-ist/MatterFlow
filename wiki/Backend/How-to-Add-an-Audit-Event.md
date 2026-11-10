# How to Add an Audit Event

[[_TOC_]]

**What this page is for.** When and how to record an audit event for a change, so the Activity tab and the Audit Logs page show it. Design: `docs/architecture.md` section 9; summary on [Notifications Audit and Settings](../Architecture/Notifications-Audit-and-Settings.md).

## Decide: automatic or explicit

| If the change is ... | Do this |
|---|---|
| A plain property edit on an entity | Mark the entity `[Audited]` (`SharedKernel/Audit/AuditAttributes.cs`). The interceptor writes `FIELD_CHANGED` with old and new value in the same transaction. Nothing else to write |
| A meaningful action with its own wording (created, assigned, status changed, granted, exported) | Write an explicit event with `IAuditWriter` and mark the properties it covers `[AuditExplicit]` so they are not also logged as `FIELD_CHANGED` |
| A change that must not store a value (secrets, personal notes) | Keep the value out of `OldValue` and `NewValue`; `Redaction.cs` masks secret-looking text |

## Steps for an explicit event

1. **Define the event type** as a constant string in the module (for example `OrganizationAuditEvents.MatterCreated`): upper snake case, stable forever (it is stored).
2. **Write it in the application service**, before `SaveChanges`:
   ```csharp
   audit.Write(new AuditEntry
   {
       EventType = OrganizationAuditEvents.MatterCreated,
       ObjectType = nameof(Matter),
       ObjectIdFactory = () => matter.Id.ToString(CultureInfo.InvariantCulture), // when the key is generated on save
       MatterId = matter.Id,                // scope columns, so history respects the Sensitive matter rule
       NewValue = "...",
       Summary = "Matter 00343-00012 created.",
   });
   ```
   `IAuditWriter` comes from `LptHub.Audit.Contracts`. The actor, time and correlation id are filled in on save. The event is saved in the same transaction as the change; if it fails, the change fails.
3. **Scope.** An event about something that belongs to a matter must carry `MatterId` (and `TaskId` for tasks). Architecture tests (`AuditScopeRulesTests`) fail for audited matter-owned entities without a declared scope and for explicit entries without a matter, except a known list of administration events.
4. **Readable text.** The Audit Logs page and the Activity drawer show `Summary` and the composed text (`AuditSummaryComposer`, `TaskActivityNarrator` for tasks). Add a label for the new event type in the frontend: `frontend/src/app/shared/ui/event-type.ts` (event type names and icons), and `audit-format.ts` if values need formatting.
5. **Filters.** The audit browser filters by `ObjectType` and `EventType`. If you add a new object type, check `AuditDisplayLookup` (`LptHub.Api/Http/AuditDisplayLookup.cs`) so the object label and actor name can be shown.
6. **Tests.** Assert the event in the module's integration test (query `GET /api/v1/audit/events` as an admin).
7. **Wiki:** if you add a notable event family, mention it in the feature's row of [Feature Map](../Features/Feature-Map.md).

## Notes

- `AuditEvent` is append-only (trigger and permissions): never design a feature that edits or deletes events.
- Events about a Sensitive matter get `IsSensitiveScope` so history stays restricted after the matter is un-marked.
- Audit reads are not logged (decision F).

## Related pages

- [Request Lifecycle](../Architecture/Request-Lifecycle.md)
- [Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md)
- [Table Reference](../Database/Table-Reference.md)

Last verified against commit cf50a0a.
