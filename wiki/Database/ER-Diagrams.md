# ER Diagrams

[[_TOC_]]

**What this page is for.** The entity relationship diagrams of the database, one per area, so you can see which tables exist and how they point at each other. For every column, index and constraint use [Table Reference](Table-Reference.md).

## How these diagrams were made

- Derived from the real database: the demo SQL Server container `lpt-hub-sql` (database `LptHub`, built by the archived scripts 01 to 66, which `db/scripts/00-baseline.sql` reproduces exactly), with read-only queries on `sys.tables`, `sys.columns`, `sys.foreign_keys` and `sys.indexes`. Nothing was written to the database.
- Cross-checked with `db/scripts` (the baseline, the scripts after it and the archive) by [wiki/tools/check-db-docs.mjs](../tools/check-db-docs.mjs) (see "Completeness" below).
- 71 tables and 183 foreign keys exist. **Every table and every foreign key appears in exactly one diagram below.** A foreign key is drawn in the diagram of the table that holds it (the child).
- Each diagram shows the primary key (PK), the foreign key columns (FK), single-column unique keys (UK) and a few key columns, not every column. Context tables from another area appear with their primary key only.
- Column types are written `type_length` (for example `nvarchar_200`) because the diagram syntax does not allow brackets.
- Line label = the foreign key column (several columns joined with `+` for composite keys). A circle on the parent side (`|o`) means the column is nullable (optional), a bar (`||`) means required. The child side is always "many".
- **Audit stamp lines.** 42 tables carry the standard columns `CreatedAt`, `CreatedByUserId`, `ModifiedAt`, `ModifiedByUserId`, `RowVersion`. Their two user foreign keys are drawn as one line from `AppUser` labelled `Created, Modified`. Other user columns (assignee, author, owner and so on) have their own lines.

::: mermaid
flowchart LR
  A["Identity and access"] --> B["Clients, Matters and Projects"]
  B --> C["Tasks and task configuration"]
  C --> D["Workflows"]
  C --> E["Forms and custom fields"]
  B --> F["Assets"]
  B --> G["Productions"]
  B --> H["Notes"]
  A --> I["Availability and Calendar"]
  A --> J["Reports"]
  A --> K["Audit, Notifications, Settings and platform"]
:::

The arrows only show the usual reading order of the sections, not foreign keys.

## Identity and access

Tables: `AppUser`, `UserIdentity`, `Role`, `Permission`, `RolePermission`, `UserRole`, `Pod`, `PodMember`, `UserView`, `Person`.

`AppUser` is the hub: almost every table points at it for who created or changed a row. Sign-in details are in `UserIdentity` (one person can have several identities). Effective permissions are the union over `UserRole`, `Role`, `RolePermission`, `Permission`. `Role.IsSystemAdmin` marks the built-in System Admin role, which holds every permission implicitly. `PodMember.IsPrimary` is the person's primary pod (at most one). `Person` (script 71) is the shared People list; a person with a `UserId` is the linked record of a system user (at most one per user), the others are added by hand.

::: mermaid
erDiagram
  AppUser {
    int UserId PK
    nvarchar_200 DisplayName
    nvarchar_320 Email
    bit IsActive
    int HolidayCalendarId FK
  }
  UserIdentity {
    int UserIdentityId PK
    int UserId FK
    varchar_20 Provider
    nvarchar_256 Username
    bit IsActive
  }
  Role {
    int RoleId PK
    nvarchar_100 Name UK
    bit IsSystemAdmin
    bit IsActive
    varchar_40 LandingPage "nullable page key"
  }
  Permission {
    int PermissionId PK
    varchar_64 Code UK
    bit IsActive
  }
  RolePermission {
    int RoleId PK
    int PermissionId PK
  }
  UserRole {
    int UserId PK
    int RoleId PK
    int GrantedByUserId FK
  }
  Pod {
    int PodId PK
    nvarchar_100 Name UK
    bit IsActive
    int DefaultHolidayCalendarId FK
  }
  PodMember {
    int PodId PK
    int UserId PK
    bit IsPrimary
  }
  Person {
    int PersonId PK
    nvarchar_200 FirstName
    nvarchar_200 LastName
    varchar_10 PersonType "INTERNAL or EXTERNAL"
    int UserId FK "unique, nullable"
    bit IsActive
  }
  UserView {
    bigint UserViewId PK
    int UserId FK
    varchar_40 Surface
    nvarchar_80 Name
    bit IsDefault
  }
  HolidayCalendar {
    int CalendarId PK
  }
  HolidayCalendar |o--o{ AppUser : "HolidayCalendarId"
  HolidayCalendar |o--o{ Pod : "DefaultHolidayCalendarId"
  Pod ||--o{ PodMember : "PodId"
  AppUser ||--o{ PodMember : "UserId"
  Permission ||--o{ RolePermission : "PermissionId"
  Role ||--o{ RolePermission : "RoleId"
  AppUser ||--o{ UserIdentity : "UserId"
  AppUser |o--o{ UserRole : "GrantedByUserId"
  Role ||--o{ UserRole : "RoleId"
  AppUser ||--o{ UserRole : "UserId"
  AppUser ||--o{ UserView : "UserId"
  AppUser |o--o| Person : "UserId"
  AppUser |o--o{ AppUser : "CreatedBy, ModifiedBy"
  AppUser |o--o{ Person : "CreatedBy, ModifiedBy"
  AppUser |o--o{ Pod : "CreatedBy, ModifiedBy"
  AppUser |o--o{ Role : "CreatedBy, ModifiedBy"
  AppUser |o--o{ UserIdentity : "CreatedBy, ModifiedBy"
:::

## Clients, Matters and Projects

Tables: `Client`, `Matter`, `Project`, `MatterEvent`, `MatterType`, `MatterMatterType`, `MatterCategory`, `CurrentState`, `TeamTitle`, `MatterTeamMember`.

A Matter belongs to one Client. The Matter keeps a copy of the client number (`ClientNumber`) and the composite foreign key `ClientId + ClientNumber` keeps it equal to the client's (`ON UPDATE CASCADE`). The business reference of a matter is `MatterRef` = client number + `-` + matter number (the CM Number, for example `00343-00012`). `PrimaryManagerId` and `SecondaryManagerId` point at `AppUser` (script 28). `IsSensitive` drives the Sensitive matter rule. `MatterCategoryId` (script 68) and `CurrentStateId` (both optional) point at the admin lists `MatterCategory` and `CurrentState`; the Matter Types of a matter are the rows of the junction `MatterMatterType` (script 69; the old column `MatterTypeId` is deprecated); `DmsPath` and `DfsPath` are optional text; the team of a matter is `MatterTeamMember` rows with a `TeamTitle` (script 64).

::: mermaid
erDiagram
  Client {
    int ClientId PK
    char_5 ClientNumber UK
    nvarchar_200 Name
    bit IsActive
  }
  Matter {
    int MatterId PK
    int ClientId FK
    char_5 ClientNumber FK
    char_5 MatterNumber
    char_11 MatterRef UK
    nvarchar_300 Name
    bit IsActive
    bit IsSensitive
    int PrimaryManagerId FK
    int SecondaryManagerId FK
    int MatterCategoryId FK
    int CurrentStateId FK
  }
  MatterMatterType {
    int MatterId PK
    int MatterTypeId PK
  }
  MatterCategory {
    int MatterCategoryId PK
    nvarchar_100 Name UK
    bit IsActive
  }
  MatterType {
    int MatterTypeId PK
    nvarchar_100 Name UK
    bit IsActive
  }
  CurrentState {
    int CurrentStateId PK
    nvarchar_100 Name UK
    bit IsActive
  }
  TeamTitle {
    int TeamTitleId PK
    nvarchar_100 Name UK
    bit IsActive
  }
  MatterTeamMember {
    int MatterTeamMemberId PK
    int MatterId FK
    nvarchar_200 Name
    nvarchar_254 Email
    int TeamTitleId FK
  }
  Project {
    int ProjectId PK
    int MatterId FK
    nvarchar_200 Name
    bit IsActive
  }
  MatterEvent {
    int MatterEventId PK
    int MatterId FK
    varchar_30 EventTypeCode
    nvarchar_200 Title
  }
  AppUser {
    int UserId PK
  }
  Client ||--o{ Matter : "ClientId+ClientNumber"
  AppUser |o--o{ Matter : "PrimaryManagerId"
  AppUser |o--o{ Matter : "SecondaryManagerId"
  Matter ||--o{ MatterEvent : "MatterId"
  Matter ||--o{ MatterTeamMember : "MatterId"
  MatterCategory |o--o{ Matter : "MatterCategoryId"
  Matter ||--o{ MatterMatterType : "MatterId"
  MatterType ||--o{ MatterMatterType : "MatterTypeId"
  CurrentState |o--o{ Matter : "CurrentStateId"
  TeamTitle ||--o{ MatterTeamMember : "TeamTitleId"
  Matter ||--o{ Project : "MatterId"
  AppUser |o--o{ Client : "CreatedBy, ModifiedBy"
  AppUser |o--o{ Matter : "CreatedBy, ModifiedBy"
  AppUser |o--o{ MatterEvent : "CreatedBy, ModifiedBy"
  AppUser |o--o{ MatterCategory : "CreatedBy, ModifiedBy"
  AppUser |o--o{ MatterType : "CreatedBy, ModifiedBy"
  AppUser |o--o{ CurrentState : "CreatedBy, ModifiedBy"
  AppUser |o--o{ TeamTitle : "CreatedBy, ModifiedBy"
  AppUser |o--o{ MatterTeamMember : "CreatedBy, ModifiedBy"
  AppUser |o--o{ Project : "CreatedBy, ModifiedBy"
:::

## Tasks and task configuration

Tables: `Task`, `TaskComment`, `TaskCommentRevision`, `TaskAsset`, `TaskType`, `Priority`, `TaskStatusLabel`, `OnHoldReason`, `AssetLinkRole`.

`Task` points at its matter, optionally a project (composite key `ProjectId + MatterId` forces the same matter), a task type, a priority, a status label, an assigned pod and or user, a form version and a workflow instance. `TaskAsset` links tasks to assets of the same matter (composite keys on `MatterId`). `TaskStatusLabel` holds the display labels of the five fixed status codes; `Task.StatusCode` references it. The audit trail of a task is in `AuditEvent` (no history tables).

::: mermaid
erDiagram
  Task {
    bigint TaskId PK
    varchar_20 TaskNumber UK
    int MatterId FK
    int ProjectId FK
    int TaskTypeId FK
    int FormVersionId FK
    bigint WorkflowInstanceId FK
    nvarchar_300 Title
    int PriorityId FK
    varchar_20 StatusCode FK
    int AssignedPodId FK
    int AssignedUserId FK
    date DueDate
    datetime2_3 DueAtUtc
    bit IsMatterSensitive
    int OnHoldReasonId FK
  }
  TaskComment {
    bigint TaskCommentId PK
    bigint TaskId FK
    int AuthorUserId FK
    varchar_12 Purpose
    bit IsDeleted
    int DeletedByUserId FK
  }
  TaskCommentRevision {
    bigint TaskCommentRevisionId PK
    bigint TaskCommentId FK
    varchar_10 Reason
    int RevisedByUserId FK
  }
  TaskAsset {
    bigint TaskId PK
    int AssetId PK
    int MatterId FK
    int AssetLinkRoleId FK
  }
  TaskType {
    int TaskTypeId PK
    nvarchar_100 Name UK
    bit IsActive
    varchar_50 IconKey
    varchar_20 ColourKey
  }
  Priority {
    int PriorityId PK
    nvarchar_50 Label UK
    bit IsActive
    bit IsDefault
  }
  TaskStatusLabel {
    varchar_20 StatusCode PK
    nvarchar_50 DisplayLabel UK
  }
  OnHoldReason {
    int OnHoldReasonId PK
    nvarchar_100 Name UK
    bit IsActive
  }
  AssetLinkRole {
    int AssetLinkRoleId PK
    nvarchar_50 Name UK
    bit IsActive
  }
  AppUser {
    int UserId PK
  }
  Asset {
    int AssetId PK
  }
  FormVersion {
    int FormVersionId PK
  }
  Matter {
    int MatterId PK
  }
  Pod {
    int PodId PK
  }
  Project {
    int ProjectId PK
  }
  WorkflowInstance {
    bigint WorkflowInstanceId PK
  }
  Pod |o--o{ Task : "AssignedPodId"
  AppUser |o--o{ Task : "AssignedUserId"
  FormVersion |o--o{ Task : "FormVersionId"
  Matter ||--o{ Task : "MatterId"
  OnHoldReason |o--o{ Task : "OnHoldReasonId"
  Priority ||--o{ Task : "PriorityId"
  Project ||--o{ Task : "ProjectId+MatterId"
  TaskStatusLabel ||--o{ Task : "StatusCode"
  TaskType ||--o{ Task : "TaskTypeId"
  WorkflowInstance ||--o{ Task : "WorkflowInstanceId"
  Asset ||--o{ TaskAsset : "AssetId+MatterId"
  AssetLinkRole |o--o{ TaskAsset : "AssetLinkRoleId"
  Task ||--o{ TaskAsset : "TaskId+MatterId"
  AppUser ||--o{ TaskComment : "AuthorUserId"
  AppUser |o--o{ TaskComment : "DeletedByUserId"
  Task ||--o{ TaskComment : "TaskId"
  TaskComment ||--o{ TaskCommentRevision : "TaskCommentId"
  AppUser |o--o{ TaskCommentRevision : "RevisedByUserId"
  AppUser |o--o{ AssetLinkRole : "CreatedBy, ModifiedBy"
  AppUser |o--o{ OnHoldReason : "CreatedBy, ModifiedBy"
  AppUser |o--o{ Priority : "CreatedBy, ModifiedBy"
  AppUser |o--o{ Task : "CreatedBy, ModifiedBy"
  AppUser |o--o{ TaskAsset : "CreatedBy, ModifiedBy"
  AppUser |o--o{ TaskComment : "CreatedBy, ModifiedBy"
  AppUser |o--o{ TaskStatusLabel : "CreatedBy, ModifiedBy"
  AppUser |o--o{ TaskType : "CreatedBy, ModifiedBy"
:::

## Workflows

Tables: `StepDefinition`, `StepDefinitionTag`, `StepTag`, `WorkflowDefinition`, `WorkflowVersion`, `WorkflowVersionStep`, `WorkflowInstance`, `StepInstance`, `TaskTypeWorkflowEligibility`.

Design time: `WorkflowDefinition` has versions (`WorkflowVersion`), a version has steps (`WorkflowVersionStep`) copied from the library (`StepDefinition`, tagged by `StepTag`). Run time: a `WorkflowInstance` pins one workflow version for one task and holds `StepInstance` rows. `TaskTypeWorkflowEligibility` says which workflows a task type may use; `TaskType.DefaultWorkflowDefinitionId` (Tasks diagram) names the default.

::: mermaid
erDiagram
  StepDefinition {
    int StepDefinitionId PK
    nvarchar_200 Title
    bit IsActive
  }
  StepDefinitionTag {
    int StepDefinitionId PK
    int StepTagId PK
  }
  StepTag {
    int StepTagId PK
    nvarchar_40 TagKey UK
    nvarchar_40 Name
  }
  WorkflowDefinition {
    int WorkflowDefinitionId PK
    nvarchar_200 Name UK
    bit IsActive
  }
  WorkflowVersion {
    int WorkflowVersionId PK
    int WorkflowDefinitionId FK
    int VersionNo
    varchar_12 Status
    bit IsOrdered
    int PublishedByUserId FK
  }
  WorkflowVersionStep {
    int WorkflowVersionStepId PK
    int WorkflowVersionId FK
    int SequenceNo
    int SourceStepDefinitionId FK
    nvarchar_200 Title
    int StepFormVersionId FK
    bit IsSkippable
  }
  WorkflowInstance {
    bigint WorkflowInstanceId PK
    int WorkflowVersionId FK
    bit IsOrdered
  }
  StepInstance {
    int StepInstanceId PK
    bigint WorkflowInstanceId FK
    int WorkflowVersionStepId FK
    int SequenceNo
    nvarchar_200 Title
    bit IsSkippable
    int InputFormVersionId FK
    int InputFormDefinitionId FK
    varchar_12 Status
    int ResolvedByUserId FK
  }
  TaskTypeWorkflowEligibility {
    int TaskTypeId PK
    int WorkflowDefinitionId PK
  }
  AppUser {
    int UserId PK
  }
  FormDefinition {
    int FormDefinitionId PK
  }
  FormVersion {
    int FormVersionId PK
  }
  TaskType {
    int TaskTypeId PK
  }
  StepDefinition ||--o{ StepDefinitionTag : "StepDefinitionId"
  StepTag ||--o{ StepDefinitionTag : "StepTagId"
  FormDefinition |o--o{ StepInstance : "InputFormDefinitionId"
  FormVersion |o--o{ StepInstance : "InputFormVersionId"
  AppUser |o--o{ StepInstance : "ResolvedByUserId"
  WorkflowVersionStep ||--o{ StepInstance : "WorkflowVersionStepId"
  WorkflowInstance ||--o{ StepInstance : "WorkflowInstanceId"
  TaskType ||--o{ TaskTypeWorkflowEligibility : "TaskTypeId"
  WorkflowVersion ||--o{ WorkflowInstance : "WorkflowVersionId"
  WorkflowDefinition ||--o{ WorkflowVersion : "WorkflowDefinitionId"
  AppUser |o--o{ WorkflowVersion : "PublishedByUserId"
  FormVersion |o--o{ WorkflowVersionStep : "StepFormVersionId"
  StepDefinition ||--o{ WorkflowVersionStep : "SourceStepDefinitionId"
  WorkflowVersion ||--o{ WorkflowVersionStep : "WorkflowVersionId"
  AppUser |o--o{ StepDefinition : "CreatedBy, ModifiedBy"
  AppUser |o--o{ StepInstance : "CreatedBy, ModifiedBy"
  AppUser |o--o{ TaskTypeWorkflowEligibility : "CreatedBy"
  AppUser |o--o{ WorkflowDefinition : "CreatedBy, ModifiedBy"
  AppUser |o--o{ WorkflowInstance : "CreatedBy, ModifiedBy"
  AppUser |o--o{ WorkflowVersion : "CreatedBy, ModifiedBy"
:::

## Forms and custom fields

Tables: `FormDefinition`, `FormVersion`, `FormField`, `FormFieldOption`, `FormValueSet`, `CustomFieldIndex`.

A `FormDefinition` is owned by exactly one thing (task type, step, asset type, or a client, matter or project for custom fields). It has versions (`FormVersion`: DRAFT, PUBLISHED, RETIRED), versions have `FormField` rows and fields have `FormFieldOption` rows. `FormValueSet` stores the JSON values per owner; `CustomFieldIndex` stores typed copies for filtering. Published versions, fields and options are immutable (triggers).

::: mermaid
erDiagram
  FormDefinition {
    int FormDefinitionId PK
    varchar_20 Scope
    int StepDefinitionId FK
    int AssetTypeId FK
    bit IsActive
  }
  FormVersion {
    int FormVersionId PK
    int FormDefinitionId FK
    int VersionNo
    varchar_12 Status
    int ClonedFromVersionId FK
    int PublishedByUserId FK
  }
  FormField {
    int FormFieldId PK
    int FormVersionId FK
    varchar_64 FieldKey
    nvarchar_200 Label
    varchar_20 ControlType
    bit IsRequired
    bit IsFilterable
  }
  FormFieldOption {
    int FormFieldOptionId PK
    int FormFieldId FK
    nvarchar_200 Label
  }
  FormValueSet {
    bigint FormValueSetId PK
    varchar_16 OwnerKind
    int FormDefinitionId FK
    int FormVersionId FK
  }
  CustomFieldIndex {
    bigint CustomFieldIndexId PK
    varchar_12 OwnerKind
    int FormDefinitionId FK
    varchar_64 FieldKey
    decimal_19_4 ValueNumber
  }
  AppUser {
    int UserId PK
  }
  AssetType {
    int AssetTypeId PK
  }
  StepDefinition {
    int StepDefinitionId PK
  }
  FormDefinition ||--o{ CustomFieldIndex : "FormDefinitionId"
  AssetType |o--o{ FormDefinition : "AssetTypeId"
  StepDefinition |o--o{ FormDefinition : "StepDefinitionId"
  FormVersion ||--o{ FormField : "FormVersionId"
  FormField ||--o{ FormFieldOption : "FormFieldId"
  FormDefinition ||--o{ FormValueSet : "FormDefinitionId"
  FormVersion ||--o{ FormValueSet : "FormVersionId"
  FormVersion |o--o{ FormVersion : "ClonedFromVersionId"
  FormDefinition ||--o{ FormVersion : "FormDefinitionId"
  AppUser |o--o{ FormVersion : "PublishedByUserId"
  AppUser |o--o{ FormDefinition : "CreatedBy, ModifiedBy"
  AppUser |o--o{ FormValueSet : "CreatedBy, ModifiedBy"
  AppUser |o--o{ FormVersion : "CreatedBy, ModifiedBy"
:::

## Assets

Tables: `AssetType`, `Asset`, `AssetReport`, `AssetNumberCounter`.

An `Asset` belongs to one matter and one asset type. An asset type can number its assets automatically: `AssetNumberCounter` holds the next counter value per asset type and scope key (the matter id while the scope is per matter; no foreign key on the scope key) and `Asset.AssetNumber` keeps the generated text. The size field and unit of an asset type tell the reports which custom NUMBER field means size. `AssetReport` is a person's saved report definition.

::: mermaid
erDiagram
  AssetType {
    int AssetTypeId PK
    nvarchar_100 Name UK
    bit IsActive
    varchar_50 IconKey
    varchar_20 ColourKey
    bit NumberingEnabled
    nvarchar_150 NumberingPattern
  }
  AssetNumberCounter {
    int AssetTypeId PK
    int ScopeKey PK
    int NextNumber
  }
  Asset {
    int AssetId PK
    int MatterId FK
    int AssetTypeId FK
    nvarchar_300 DisplayName
    bit IsActive
    varchar_20 DispositionCode
    int DispositionChangedByUserId FK
    nvarchar_100 AssetNumber UK
    int AssetNumberSeq
  }
  AssetReport {
    int AssetReportId PK
    int OwnerUserId FK
    nvarchar_100 Name
  }
  AppUser {
    int UserId PK
  }
  Matter {
    int MatterId PK
  }
  AssetType ||--o{ Asset : "AssetTypeId"
  AssetType ||--o{ AssetNumberCounter : "AssetTypeId"
  AppUser |o--o{ Asset : "DispositionChangedByUserId"
  Matter ||--o{ Asset : "MatterId"
  AppUser ||--o{ AssetReport : "OwnerUserId"
  AppUser |o--o{ Asset : "CreatedBy, ModifiedBy"
  AppUser |o--o{ AssetReport : "CreatedBy, ModifiedBy"
  AppUser |o--o{ AssetType : "CreatedBy, ModifiedBy"
:::

## Productions

Tables: `ProductionSpec`, `Production`, `ProductionComment`.

A `ProductionSpec` and its `Production` rows belong to one matter. A production may point at a spec of the same matter (composite key). Comments carry `MatterId` for the visibility rule.

::: mermaid
erDiagram
  ProductionSpec {
    int ProductionSpecId PK
    int MatterId FK
    nvarchar_200 Name
    varchar_10 StatusCode
  }
  Production {
    int ProductionId PK
    int MatterId FK
    nvarchar_200 Name
    varchar_3 DirectionCode
    int ProductionSpecId FK
  }
  ProductionComment {
    int ProductionCommentId PK
    int ProductionId FK
    int MatterId FK
  }
  AppUser {
    int UserId PK
  }
  Matter {
    int MatterId PK
  }
  Matter ||--o{ Production : "MatterId"
  ProductionSpec ||--o{ Production : "ProductionSpecId+MatterId"
  Production ||--o{ ProductionComment : "ProductionId+MatterId"
  Matter ||--o{ ProductionSpec : "MatterId"
  AppUser |o--o{ Production : "CreatedBy, ModifiedBy"
  AppUser |o--o{ ProductionComment : "CreatedBy, ModifiedBy"
  AppUser |o--o{ ProductionSpec : "CreatedBy, ModifiedBy"
:::

## Notes

Tables: `Note`, `NoteLink`, `NoteTag`, `NoteTagLink`, `NoteTemplate`, `NoteTemplateTag`.

A `Note` belongs to one matter. Tags are many-to-many (`NoteTagLink`). `NoteLink` records references from the note text to users, notes, matters, projects and assets. A `NoteTemplate` is at System, Client or Matter level (`ScopeCode` with the matching `ClientId` or `MatterId`).

::: mermaid
erDiagram
  Note {
    int NoteId PK
    int MatterId FK
    nvarchar_300 Title
    bit IsPinned
    int LockedByUserId FK
    int ContentUpdatedByUserId FK
  }
  NoteLink {
    int NoteId PK
    varchar_10 TargetType PK
    int TargetId PK
  }
  NoteTag {
    int NoteTagId PK
    nvarchar_60 Name UK
    varchar_20 ColourKey
    bit IsActive
  }
  NoteTagLink {
    int NoteId PK
    int NoteTagId PK
  }
  NoteTemplate {
    int NoteTemplateId PK
    varchar_6 ScopeCode
    int MatterId FK
    nvarchar_100 Name
    int ClientId FK
  }
  NoteTemplateTag {
    int NoteTemplateId PK
    int NoteTagId PK
  }
  AppUser {
    int UserId PK
  }
  Client {
    int ClientId PK
  }
  Matter {
    int MatterId PK
  }
  AppUser |o--o{ Note : "ContentUpdatedByUserId"
  AppUser |o--o{ Note : "LockedByUserId"
  Matter ||--o{ Note : "MatterId"
  Note ||--o{ NoteLink : "NoteId"
  Note ||--o{ NoteTagLink : "NoteId"
  NoteTag ||--o{ NoteTagLink : "NoteTagId"
  Client |o--o{ NoteTemplate : "ClientId"
  Matter |o--o{ NoteTemplate : "MatterId"
  NoteTag ||--o{ NoteTemplateTag : "NoteTagId"
  NoteTemplate ||--o{ NoteTemplateTag : "NoteTemplateId"
  AppUser |o--o{ Note : "CreatedBy, ModifiedBy"
  AppUser |o--o{ NoteTag : "CreatedBy, ModifiedBy"
  AppUser |o--o{ NoteTemplate : "CreatedBy, ModifiedBy"
:::

## Vendors

Tables: `Vendor`, `VendorServiceOption`, `VendorAreaOption`, `VendorServiceChoice`, `VendorAreaChoice`, `VendorTechAi`, `VendorContact`, `VendorMatter`.

A `Vendor` (epic #1373) has services and areas chosen from two admin lists (`VendorServiceOption`, `VendorAreaOption`, through `VendorServiceChoice` and `VendorAreaChoice`), a free-text Tech AI list, contacts (a `Person` with a flag, `VendorContact`) and links to matters (`VendorMatter`, no cascade: a linked vendor cannot be deleted). The choices, Tech AI rows and contacts go with the vendor.

::: mermaid
erDiagram
  Vendor {
    int VendorId PK
    nvarchar_200 Name "unique"
    varchar_12 CategoryCode "PREFERRED or BLACKLISTED"
  }
  VendorServiceOption {
    int VendorServiceOptionId PK
    nvarchar_100 Name "unique"
    bit IsActive
  }
  VendorAreaOption {
    int VendorAreaOptionId PK
    nvarchar_100 Name "unique"
    bit IsActive
  }
  VendorServiceChoice {
    int VendorId PK
    int VendorServiceOptionId PK
  }
  VendorAreaChoice {
    int VendorId PK
    int VendorAreaOptionId PK
  }
  VendorTechAi {
    int VendorTechAiId PK
    int VendorId FK
    nvarchar_200 Name
  }
  VendorContact {
    int VendorContactId PK
    int VendorId FK
    int PersonId FK
    varchar_12 FlagCode "NONE, RECOMMENDED, DO_NOT_HIRE"
    date ReportedOn
    int ReportedByUserId FK
  }
  VendorMatter {
    int VendorId PK
    int MatterId PK
    int LinkedByUserId FK
  }
  Person {
    int PersonId PK
  }
  Matter {
    int MatterId PK
  }
  AppUser {
    int UserId PK
  }
  Vendor ||--o{ VendorServiceChoice : "VendorId"
  VendorServiceOption ||--o{ VendorServiceChoice : "VendorServiceOptionId"
  Vendor ||--o{ VendorAreaChoice : "VendorId"
  VendorAreaOption ||--o{ VendorAreaChoice : "VendorAreaOptionId"
  Vendor ||--o{ VendorTechAi : "VendorId"
  Vendor ||--o{ VendorContact : "VendorId"
  Person ||--o{ VendorContact : "PersonId"
  Vendor ||--o{ VendorMatter : "VendorId"
  Matter ||--o{ VendorMatter : "MatterId"
  AppUser |o--o{ VendorContact : "ReportedBy"
  AppUser |o--o{ VendorMatter : "LinkedBy"
  AppUser |o--o{ Vendor : "CreatedBy, ModifiedBy"
  AppUser |o--o{ VendorServiceOption : "CreatedBy, ModifiedBy"
  AppUser |o--o{ VendorAreaOption : "CreatedBy, ModifiedBy"
  AppUser |o--o{ VendorContact : "CreatedBy, ModifiedBy"
:::

## Availability and Calendar

Tables: `UserAvailability`, `UserWorkHour`, `UserAbsence`, `HolidayCalendar`, `Holiday`.

Availability is per person (`UserAvailability`, `UserWorkHour`, `UserAbsence`). Holidays come from calendars (`HolidayCalendar`, `Holiday`): a person has one calendar (`AppUser.HolidayCalendarId`), a pod has a default (`Pod.DefaultHolidayCalendarId`), the firm calendar id is an `AppSetting`, and calendars flagged `AppliesToEveryone` always apply.

::: mermaid
erDiagram
  UserAvailability {
    int UserId PK
    varchar_20 Status
    int UpdatedByUserId FK
  }
  UserWorkHour {
    int UserId PK
    tinyint DayOfWeek PK
  }
  UserAbsence {
    int AbsenceId PK
    int UserId FK
    varchar_20 AbsenceType
    int UpdatedByUserId FK
  }
  HolidayCalendar {
    int CalendarId PK
    nvarchar_100 Name UK
    varchar_20 ColourKey
    bit IsActive
  }
  Holiday {
    int HolidayId PK
    int CalendarId FK
    nvarchar_100 Name
    varchar_20 RuleKind
  }
  AppUser {
    int UserId PK
  }
  HolidayCalendar ||--o{ Holiday : "CalendarId"
  AppUser |o--o{ UserAbsence : "UpdatedByUserId"
  AppUser ||--o{ UserAbsence : "UserId"
  AppUser |o--o{ UserAvailability : "UpdatedByUserId"
  AppUser ||--o{ UserAvailability : "UserId"
  AppUser ||--o{ UserWorkHour : "UserId"
  AppUser |o--o{ Holiday : "CreatedBy, ModifiedBy"
  AppUser |o--o{ HolidayCalendar : "CreatedBy, ModifiedBy"
  AppUser |o--o{ UserAbsence : "CreatedBy"
:::

## Reports

Tables: `ReportCategory`, `ReportDefinition`, `ReportVersion`, `ReportParameter`, `RoleReport`, `SavedReportView`, `ReportFavourite`, `ReportRecent`, `ReportRun`.

A `ReportDefinition` points at its category and its current `ReportVersion`; the circular reference (definition to current version, version to definition) is why `CurrentVersionId` and `LastPreviewOkVersionId` are nullable. `ReportRun` logs every run. `RoleReport` assigns reports to roles. All Reports tables are denied for the report login.

::: mermaid
erDiagram
  ReportCategory {
    int ReportCategoryId PK
    nvarchar_100 Name UK
    bit IsActive
  }
  ReportDefinition {
    int ReportId PK
    int ReportCategoryId FK
    nvarchar_150 Name UK
    bit IsActive
    int CurrentVersionId FK
    int LastPreviewOkVersionId FK
  }
  ReportVersion {
    int ReportVersionId PK
    int ReportId FK
    int VersionNo
  }
  ReportParameter {
    int ReportParameterId PK
    int ReportId FK
    varchar_64 Name
    varchar_20 Type
    nvarchar_100 Label
    bit IsRequired
  }
  RoleReport {
    int RoleId PK
    int ReportId PK
    int GrantedByUserId FK
  }
  SavedReportView {
    int SavedReportViewId PK
    int ReportId FK
    int UserId FK
    nvarchar_100 Name
    bit IsDefault
  }
  ReportFavourite {
    int UserId PK
    int ReportId PK
  }
  ReportRecent {
    int UserId PK
    int ReportId PK
  }
  ReportRun {
    bigint ReportRunId PK
    int ReportId FK
    int ReportVersionId FK
    int UserId FK
    varchar_12 Status
    varchar_12 Kind
  }
  AppUser {
    int UserId PK
  }
  Role {
    int RoleId PK
  }
  ReportCategory ||--o{ ReportDefinition : "ReportCategoryId"
  ReportVersion |o--o{ ReportDefinition : "CurrentVersionId"
  ReportVersion |o--o{ ReportDefinition : "LastPreviewOkVersionId"
  ReportDefinition ||--o{ ReportFavourite : "ReportId"
  AppUser ||--o{ ReportFavourite : "UserId"
  ReportDefinition ||--o{ ReportParameter : "ReportId"
  ReportDefinition ||--o{ ReportRecent : "ReportId"
  AppUser ||--o{ ReportRecent : "UserId"
  ReportDefinition ||--o{ ReportRun : "ReportId"
  AppUser ||--o{ ReportRun : "UserId"
  ReportVersion ||--o{ ReportRun : "ReportVersionId"
  ReportDefinition ||--o{ ReportVersion : "ReportId"
  AppUser |o--o{ RoleReport : "GrantedByUserId"
  ReportDefinition ||--o{ RoleReport : "ReportId"
  Role ||--o{ RoleReport : "RoleId"
  ReportDefinition ||--o{ SavedReportView : "ReportId"
  AppUser ||--o{ SavedReportView : "UserId"
  AppUser |o--o{ ReportCategory : "CreatedBy, ModifiedBy"
  AppUser |o--o{ ReportDefinition : "CreatedBy, ModifiedBy"
  AppUser |o--o{ ReportVersion : "CreatedBy"
:::

## Audit, Notifications, Settings and platform

Tables: `AuditEvent`, `AuditEventGuard`, `Notification`, `NotificationPreference`, `AppSetting`, `UserMatterActivitySeen`, `SchemaMigration`, `SeedMarker`.

`AuditEvent` has no foreign keys on purpose (the actor, `MatterId` and `TaskId` are plain columns), so the audit trail outlives its subjects. `Notification` and `NotificationPreference` point at users. `SchemaMigration` and `SeedMarker` are bookkeeping tables.

::: mermaid
erDiagram
  AuditEvent {
    bigint AuditEventId PK
    varchar_64 EventType
    varchar_40 ObjectType
    varchar_100 FieldKey
    bit IsSensitiveScope
  }
  AuditEventGuard {
    bigint AuditEventId PK
  }
  Notification {
    bigint Id PK
    int RecipientUserId FK
    varchar_40 EventType
    int MatterId FK
    int ActorUserId FK
  }
  NotificationPreference {
    int UserId PK
    varchar_40 EventType PK
  }
  AppSetting {
    varchar_100 SettingKey PK
    int UpdatedByUserId FK
  }
  UserMatterActivitySeen {
    int UserId PK
    bit IsInitial
  }
  SchemaMigration {
    int SchemaMigrationId PK
    nvarchar_260 ScriptName UK
    int Prefix UK
  }
  SeedMarker {
    varchar_100 Name PK
  }
  AppUser {
    int UserId PK
  }
  Matter {
    int MatterId PK
  }
  AppUser ||--o{ AppSetting : "UpdatedByUserId"
  AuditEvent ||--o{ AuditEventGuard : "AuditEventId"
  AppUser |o--o{ Notification : "ActorUserId"
  Matter |o--o{ Notification : "MatterId"
  AppUser ||--o{ Notification : "RecipientUserId"
  AppUser ||--o{ NotificationPreference : "UserId"
  AppUser ||--o{ UserMatterActivitySeen : "UserId"
:::

## Completeness

- Tables in the database: 71. Tables in [Table Reference](Table-Reference.md): 71. Tables in the diagrams above: 71.
- Foreign keys in the database: 183. Foreign keys drawn above: 183 (106 as normal lines, 77 as the combined `Created, Modified` lines from `AppUser`).
- The script `wiki/tools/check-db-docs.mjs` re-checks this from `db/scripts/*.sql` (the baseline and later scripts) and the wiki pages. Run it with `node wiki/tools/check-db-docs.mjs` from the repository root after you change the schema.
- The diagrams were syntax-checked with Mermaid 9.4.3 and 10.9.1 (see [Documentation Map](../Reference/Documentation-Map.md)); their layout in Azure DevOps was not viewed.

## Related pages

- [Table Reference](Table-Reference.md)
- [Database Overview](Overview.md)
- [Schema Script History](Schema-Script-History.md)
- [How to Change the Schema](How-to-Change-the-Schema.md)

Last verified against commit a8f9659.
