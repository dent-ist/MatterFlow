# UI update: API contract (UI-02, issue #955)

Epic #953. Written by Agent 1, first version 2026-10-31. This file is the agreement between the backend (Agent 1) and the My Matters frontend (Agent 2). Later changes are appended to the change log at the end, each with a date. Names follow the existing API: camelCase JSON, `api/v1`, ISO dates (`yyyy-MM-dd`), UTC instants as ISO 8601 with `Z`, problem+json errors with a `code`. The OpenAPI document (`contracts/openapi/v1.json`) and the nswag client are regenerated from code after each backend push; the operation names below are the nswag method names.

## 0. Conventions

### 0.1 Scope parameters (the "My Matters scope")

Every `/api/v1/my-matters/*` endpoint below takes the same scope parameters as the existing My Matters endpoints:

| Parameter   | Type         | Default | Meaning                                                                                                        |
| ----------- | ------------ | ------- | -------------------------------------------------------------------------------------------------------------- |
| `scope`     | `mine`/`all` | `mine`  | `mine` = matters where I am Primary or Secondary PM. `all` needs `Matter.AssignManagers` (403 otherwise).      |
| `role`      | string       | `both`  | `both`, `primary`, `secondary`.                                                                                |
| `clientId`  | int          | -       | Only this client's matters.                                                                                    |
| `matterId`  | int          | -       | Only this matter (a matter outside the scope or not visible to the caller gives an empty result, never a 403). |
| `managerId` | int          | -       | With `scope=all` only.                                                                                         |

Overdue and "today" are decided in the viewer's time zone (`X-Time-Zone` header), as everywhere else.

### 0.2 Permissions and visibility (applies to every endpoint)

- The `/my-matters/*` endpoints need `Task.View` and (`Matter.BeManager` or `Matter.AssignManagers`), like the existing My Matters endpoints. Events endpoints under `/matters/...` need `Matter.View`.
- Sensitive-matter rule (every endpoint without exception): a matter that is sensitive is invisible to anyone who is not allowed to see it (`IMatterVisibility`: its managers and holders of the see-sensitive permission). It does not appear in the tree, in any count, in upcoming events, in the calendar, in the feed, in the assets list, in task lists or in search, and a direct request for it (event, asset detail) answers **404**, indistinguishable from "does not exist".
- Comments exist only on tasks. Assets have no comments anywhere in this contract.

### 0.3 Errors

| Status | When                                                                                                                  | Body                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 400    | Unknown query parameter, bad value, bad range                                                                         | problem+json, `code` e.g. `UNKNOWN_KIND`, `INVALID_RANGE`, `VALIDATION_FAILED` with `errors` per field |
| 401    | Not signed in                                                                                                         | problem+json                                                                                           |
| 403    | Missing permission; `scope=all` without `Matter.AssignManagers`; event write by someone who may not manage the matter | problem+json, `code` `FORBIDDEN` or `NOT_MATTER_MANAGER`                                               |
| 404    | Object missing or not visible (sensitive)                                                                             | problem+json, `code` `NOT_FOUND`                                                                       |
| 409    | `rowVersion` is stale on update/delete                                                                                | problem+json, `code` `CONCURRENCY_CONFLICT`                                                            |

### 0.4 Paging

Lists use `page` (1-based, default 1) and `pageSize` (default 25, max 100) and answer `{ items, total, page, pageSize }`, the shape the API already uses (`PagedResult`). Exceptions are stated per endpoint.

## 1. Matter tree

`GET /api/v1/my-matters/tree` (nswag: `getMyMattersTree`)

Clients with the matters the person may see in the scope, for the tree panel. Sorted by client name, then matter reference. Clients without a visible matter in the scope are left out.

Query: scope parameters (0.1) plus

| Parameter    | Type     | Default         | Meaning                                                                                                                                                    |
| ------------ | -------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeDays` | int 1-90 | setting, else 7 | N of the "active" rule: a matter is **active** when it has an open task (New, In Progress, On Hold) **or** an asset created or updated in the last N days. |
| `q`          | string   | -               | Case-insensitive fragment of the client name/number or matter name/reference. Clients whose own name matches keep all their matters.                       |
| `activeOnly` | bool     | false           | Only active matters (clients without one are left out).                                                                                                    |

Counts per matter (and summed per client): `openTasks` = New + In Progress + On Hold; `overdue` = New or In Progress with a due date before today; `unassigned` = open tasks with no person; `critical` = open tasks whose priority is Critical. No stored weights.

```json
{
  "asOfUtc": "2026-10-31T09:12:44Z",
  "timeZone": "America/New_York",
  "activeDays": 7,
  "clientCount": 2,
  "matterCount": 3,
  "clients": [
    {
      "clientId": 12,
      "clientNumber": "00343",
      "name": "Northwind Traders",
      "matterCount": 2,
      "activeMatterCount": 1,
      "openTasks": 14,
      "overdue": 3,
      "unassigned": 2,
      "critical": 1,
      "matters": [
        {
          "matterId": 301,
          "matterRef": "00343-00012",
          "name": "Data breach response",
          "isSensitive": false,
          "isActive": true,
          "openTasks": 9,
          "overdue": 3,
          "unassigned": 1,
          "critical": 1,
          "lastAssetChangeUtc": "2026-10-29T14:03:00Z"
        },
        {
          "matterId": 302,
          "matterRef": "00343-00013",
          "name": "Second request",
          "isSensitive": false,
          "isActive": false,
          "openTasks": 0,
          "overdue": 0,
          "unassigned": 0,
          "critical": 0,
          "lastAssetChangeUtc": null
        }
      ]
    }
  ]
}
```

Notes: `isSensitive` is true only for a matter the caller may see (a sensitive matter the caller may not see is not in the list at all). `isActive` is the "active" rule above (not the matter's archive flag; closed matters are never in the tree). All fields are required except `lastAssetChangeUtc`.

## 2. Matter events (calendar items)

### 2.1 Event types (code list)

`GET /api/v1/matter-event-types` (nswag: `listMatterEventTypes`) - any signed-in user. Fixed list of 8, same order everywhere. `iconKey` is a key of the frontend icon map; `colourKey` is the token suffix (`--mf-event-<colourKey>`, see `docs/ux/theme-guide.md`).

```json
[
  {
    "code": "COURT_HEARING",
    "label": "Court hearing",
    "iconKey": "gavel",
    "colourKey": "court",
    "sortOrder": 1
  },
  { "code": "TRIAL", "label": "Trial", "iconKey": "scale", "colourKey": "trial", "sortOrder": 2 },
  {
    "code": "DEPOSITION",
    "label": "Deposition",
    "iconKey": "mic",
    "colourKey": "deposition",
    "sortOrder": 3
  },
  {
    "code": "PRODUCTION_DEADLINE",
    "label": "Production deadline",
    "iconKey": "file-export",
    "colourKey": "production",
    "sortOrder": 4
  },
  {
    "code": "FILING_DEADLINE",
    "label": "Filing deadline",
    "iconKey": "file-check",
    "colourKey": "filing",
    "sortOrder": 5
  },
  {
    "code": "MEDIATION",
    "label": "Mediation or settlement",
    "iconKey": "handshake",
    "colourKey": "mediation",
    "sortOrder": 6
  },
  {
    "code": "CLIENT_MEETING",
    "label": "Client meeting or call",
    "iconKey": "users",
    "colourKey": "meeting",
    "sortOrder": 7
  },
  { "code": "OTHER", "label": "Other", "iconKey": "calendar", "colourKey": "other", "sortOrder": 8 }
]
```

### 2.2 Event shape

```json
{
  "eventId": 41,
  "matterId": 301,
  "matterRef": "00343-00012",
  "matterName": "Data breach response",
  "clientId": 12,
  "clientName": "Northwind Traders",
  "isSensitive": false,
  "typeCode": "DEPOSITION",
  "typeLabel": "Deposition",
  "typeIconKey": "mic",
  "typeColourKey": "deposition",
  "title": "Deposition of J. Alvarez",
  "date": "2026-11-04",
  "time": "09:30",
  "note": "Room 4B, court reporter booked.",
  "canEdit": true,
  "createdAtUtc": "2026-10-20T10:00:00Z",
  "createdByName": "Test User 35",
  "modifiedAtUtc": null,
  "modifiedByName": null,
  "rowVersion": "AAAAAAAAB9E="
}
```

- `date` is a floating calendar date (the day in the matter's world); `time` is `HH:mm` (24 h, no zone, floating) or `null` for an all-day event. An event never becomes "overdue"; the UI shows past events muted.
- `title` required, 1 to 200 characters. `note` optional, up to 2000 characters, plain text.
- `canEdit` is true when the caller may update/delete this event (rule 2.3); the UI shows edit controls only then.

### 2.3 Who may do what

- **Read** (list, upcoming, calendar): anyone who can see the matter (`Matter.View` and the sensitive rule).
- **Create, update, delete**: the matter's **Primary PM**, its **Secondary PM**, and holders of the existing permission **`Matter.Edit`**. Assumption recorded for the owner: there is no `Matter.*Manage` permission in `contracts/permissions.json`; `Matter.Edit` ("Edit matter details") is the closest and **no new permission is invented**. Anyone else gets 403 `NOT_MATTER_MANAGER`. A sensitive matter the caller cannot see gives 404.

### 2.4 List events of the scope (calendar and upcoming)

`GET /api/v1/my-matters/events` (nswag: `getMyMattersEvents`)

Query: scope parameters plus `from` and `to` (required, `yyyy-MM-dd`, inclusive, at most 100 days apart; the calendar sends the visible month grid), optional `typeCode` (repeatable). Not paged; at most 500 events (more gives 400 `RANGE_TOO_LARGE`). Sorted by date, time (all-day first), title.

```json
{
  "from": "2026-11-01",
  "to": "2026-11-30",
  "total": 1,
  "items": [{ "eventId": 41, "matterId": 301, "...": "event shape of 2.2" }]
}
```

`GET /api/v1/my-matters/events/upcoming` (nswag: `getMyMattersUpcomingEvents`) - the side panel. Query: scope parameters plus `days` (1-60, default 14; from today in the viewer's zone, today included), `take` (1-50, default 10).

```json
{
  "asOfUtc": "2026-10-31T09:12:44Z",
  "from": "2026-10-31",
  "to": "2026-11-13",
  "total": 6,
  "items": [{ "eventId": 41, "...": "event shape of 2.2" }]
}
```

`total` is the number in the window (the count shown on the collapsed rail); `items` is the first `take`. Events on matters outside the scope or not visible are never counted.

### 2.5 Per matter and write endpoints

| Operation                                                      | Request                                           | Response                                      |
| -------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------- |
| `GET /api/v1/matters/{matterId}/events` (`listMatterEvents`)   | `from`, `to` optional (default today to +90 days) | `{ "from", "to", "total", "items": [event] }` |
| `POST /api/v1/matters/{matterId}/events` (`createMatterEvent`) | body below                                        | 201 + event, `Location` header                |
| `PUT /api/v1/matter-events/{eventId}` (`updateMatterEvent`)    | body below plus `rowVersion`                      | 200 + event                                   |
| `DELETE /api/v1/matter-events/{eventId}` (`deleteMatterEvent`) | query `rowVersion`                                | 204                                           |

Create/update body:

```json
{
  "typeCode": "COURT_HEARING",
  "title": "Motion hearing",
  "date": "2026-11-12",
  "time": "10:00",
  "note": null,
  "rowVersion": "AAAAAAAAB9E="
}
```

`rowVersion` is only for update. Errors: 400 `VALIDATION_FAILED` (`errors.title`, `errors.date`, `errors.time`, `errors.typeCode` = `UNKNOWN_EVENT_TYPE`), 403 `NOT_MATTER_MANAGER`, 404, 409 `CONCURRENCY_CONFLICT`. An inactive (archived) matter cannot get new events (400 `MATTER_INACTIVE`). Delete is a real delete (audited). Create, update and delete write an audit event; there are no notifications and no reminders in this round.

## 3. Recent-activity feed (six kinds)

`GET /api/v1/my-matters/feed` (nswag: `getMyMattersFeed`)

One list for the side panel's "Recent activity" and the Activity tab, newest first. The window is the last 30 days (`days`, 1-90). The six kinds and their rules:

| `kind`               | Label              | One item is                                                                                | `occurredAtUtc`         |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------------ | ----------------------- |
| `NEW_ASSETS`         | New assets         | an asset created in the window (asset item)                                                | asset created           |
| `NEW_COMMENTS`       | New comments       | a comment added to a **task** (never the text; privilege)                                  | comment created         |
| `NEW_STATUS_UPDATES` | New status updates | a task changed status to anything except On Hold (`fromStatus`, `toStatus`)                | status change           |
| `ON_HOLD`            | On hold            | a task is **currently** On Hold; the hold's reason and whole days                          | when it was put on hold |
| `OVERDUE`            | Overdue            | a task that is **currently** overdue (New or In Progress, due before today); `daysOverdue` | the due moment          |
| `DUE_DATE_UPDATED`   | Due date updated   | a task's due date was changed (`oldDueDate`, `newDueDate`; null = ASAP)                    | change                  |

`ON_HOLD` and `OVERDUE` are states, not events: an item leaves the feed when the task is resumed or finished. "Delayed" is merged into Overdue; there is no separate kind. Clicking a task item opens the task in a new browser tab (`/tasks/{taskId}`), the frontend's job.

Query: scope parameters plus

| Parameter          | Type               | Default | Meaning                                                         |
| ------------------ | ------------------ | ------- | --------------------------------------------------------------- |
| `kind`             | string, repeatable | all     | One or more of the six codes; unknown gives 400 `UNKNOWN_KIND`. |
| `days`             | int 1-90           | 30      | Window.                                                         |
| `unread`           | bool               | false   | Only unread items.                                              |
| `page`, `pageSize` | int                | 1, 25   | See 0.4 (max 100).                                              |

Unread: an item is unread when `occurredAtUtc` is after the person's read marker (`seenAtUtc`, the same marker the existing `POST /api/v1/my-matters/activity/seen` moves) and the person is not the actor. The first call creates the marker (nothing unread on the first visit). `POST /api/v1/my-matters/activity/seen` (existing) marks all as read; its body and answer are unchanged.

```json
{
  "asOfUtc": "2026-10-31T09:12:44Z",
  "timeZone": "America/New_York",
  "since": "2026-10-01T09:12:44Z",
  "seenAtUtc": "2026-10-30T16:00:00Z",
  "unreadCount": 4,
  "total": 37,
  "page": 1,
  "pageSize": 25,
  "countsByKind": {
    "NEW_ASSETS": 5,
    "NEW_COMMENTS": 9,
    "NEW_STATUS_UPDATES": 12,
    "ON_HOLD": 3,
    "OVERDUE": 6,
    "DUE_DATE_UPDATED": 2
  },
  "items": [
    {
      "itemKey": "OVERDUE:TSK-1042",
      "kind": "OVERDUE",
      "occurredAtUtc": "2026-10-28T23:59:00Z",
      "isUnread": true,
      "actorName": null,
      "matterId": 301,
      "matterRef": "00343-00012",
      "matterName": "Data breach response",
      "clientId": 12,
      "clientName": "Northwind Traders",
      "taskId": 1042,
      "taskNumber": "TSK-1042",
      "taskTitle": "Review privilege log",
      "assetId": null,
      "assetName": null,
      "assetTypeName": null,
      "fromStatus": null,
      "toStatus": null,
      "onHoldReason": null,
      "onHoldDays": null,
      "daysOverdue": 3,
      "oldDueDate": null,
      "newDueDate": null
    },
    {
      "itemKey": "NEW_STATUS_UPDATES:88213",
      "kind": "NEW_STATUS_UPDATES",
      "occurredAtUtc": "2026-10-30T15:20:00Z",
      "isUnread": true,
      "actorName": "Test User 12",
      "matterId": 301,
      "matterRef": "00343-00012",
      "matterName": "Data breach response",
      "clientId": 12,
      "clientName": "Northwind Traders",
      "taskId": 1050,
      "taskNumber": "TSK-1050",
      "taskTitle": "Load custodian data",
      "assetId": null,
      "assetName": null,
      "assetTypeName": null,
      "fromStatus": "NEW",
      "toStatus": "IN_PROGRESS",
      "onHoldReason": null,
      "onHoldDays": null,
      "daysOverdue": null,
      "oldDueDate": null,
      "newDueDate": null
    }
  ]
}
```

`itemKey` is unique and stable within a response (use it as the list track key). Fields that do not apply to a kind are `null`. Status codes are the task status codes (`NEW`, `IN_PROGRESS`, `ON_HOLD`, `COMPLETED`, `CANCELLED`); labels come from the frontend vocabulary. `countsByKind` and `unreadCount` ignore the `kind` and `unread` filters (they are the badge numbers) but respect the scope. Task items of a task the caller may not see are left out (same task visibility rule as My Work).

## 4. Task list: status, step n of m, Show filters, counts

### 4.1 Task grid

The grid keeps using `GET /api/v1/task-queue` (nswag `getTaskQueue`). Already available and unchanged: row fields `status`, `statusLabel`, `priority`, `holdReason`, `onHoldReasonName`, `statusChangedAtUtc`, `closedAtUtc`, `workflow` (`stepsTotal`, `stepsResolved`, `currentStepNumber`, `currentStepName`), the filters `managedByMe`, `role`, `client`, `matter`, `status` (repeatable), `unassigned`, `priority`, `atRisk`, `dueWithin`, and `sort=status` (workflow order New, In Progress, On Hold, Completed, Cancelled).

**Step n of m:** show `workflow.currentStepNumber` of `workflow.stepsTotal`. Edge cases: `stepsTotal = 0` (no workflow): show no step; `currentStepNumber = null` (all steps resolved): show `stepsTotal of stepsTotal`; the last step is `currentStepNumber = stepsTotal`. The bar has `stepsTotal` segments, the first `stepsResolved` filled.

**New in this round:** query parameter `show` (one value of `overdue`, `risk`, `critical`, `unassigned`, `due7`; absent = Everything). It combines with `status` by AND, with every other filter, and with the scope:

| `show`       | Meaning (and only these statuses)                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `overdue`    | status New or In Progress and the due date is before today (viewer's zone). On Hold tasks are **never** overdue here. |
| `risk`       | At risk (existing rule), New or In Progress.                                                                          |
| `due7`       | New or In Progress, due today up to and including 7 days ahead, not overdue.                                          |
| `critical`   | priority = Critical, any status.                                                                                      |
| `unassigned` | no person assigned (a pod may be set), any status.                                                                    |

The older `overdue=true`, `atRisk=true` and `dueWithin` parameters keep their meaning for the other screens. Unknown `show` gives 400 `UNKNOWN_SHOW`. Default sort of the page is urgency: `sort=attention`.

### 4.2 Status and Show counts

`GET /api/v1/my-matters/task-counts` (nswag: `getMyMattersTaskCounts`)

Query: scope parameters (`matterId` and `clientId` as for the chosen tree node) plus optional `status` (repeatable; same codes as the grid) and `show` (as 4.1). Every number respects the other filter, so each equals the total of the grid after the click.

```json
{
  "asOfUtc": "2026-10-31T09:12:44Z",
  "timeZone": "America/New_York",
  "byStatus": {
    "allOpen": 14,
    "new": 5,
    "inProgress": 6,
    "onHold": 3,
    "completed": 22,
    "cancelled": 1
  },
  "byShow": {
    "everything": 14,
    "overdue": 3,
    "risk": 2,
    "unassigned": 2,
    "critical": 1,
    "due7": 4
  }
}
```

- `byStatus` is computed with the current `show` applied (not the current `status`); `allOpen = new + inProgress + onHold`.
- `byShow` is computed with the current `status` selection applied (not the current `show`); with no `status` it covers the open statuses for `everything`, and each Show rule keeps its own status limits (4.1).
- With `matterId`/`clientId` set these are also the numbers of the stacked workflow bar of the chosen client or matter (`byStatus`).

## 5. Assets (the PM's asset list)

Assets have **no comment column**. "Status" of an asset is its disposition.

### 5.1 List

`GET /api/v1/my-matters/assets` (nswag: `getMyMattersAssets`)

Query: scope parameters plus

| Parameter                  | Type     | Default                      | Meaning                                                                                 |
| -------------------------- | -------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `q`                        | string   | -                            | Fragment of name, external reference, asset type, matter name.                          |
| `name`                     | string   | -                            | Column filter, fragment of the asset name.                                              |
| `assetTypeId`              | int[]    | -                            | Repeatable; any of the types.                                                           |
| `status`                   | string[] | -                            | Repeatable disposition codes: `ACTIVE`, `INACTIVE`, `PENDING_DISPOSITION`, `DISPOSED`.  |
| `createdFrom`, `createdTo` | date     | -                            | Created date range (viewer's zone, inclusive).                                          |
| `updatedFrom`, `updatedTo` | date     | -                            | Updated date range (an asset never updated does not match).                             |
| `sort`                     | string   | `updated`                    | `name`, `client`, `matter`, `assetType`, `created`, `updated`, `status`, `linkedTasks`. |
| `dir`                      | string   | `desc` for dates, else `asc` | `asc` or `desc`.                                                                        |
| `page`, `pageSize`         | int      | 1, 25                        | See 0.4.                                                                                |

```json
{
  "total": 41,
  "page": 1,
  "pageSize": 25,
  "items": [
    {
      "assetId": 512,
      "name": "Custodian laptops - batch 3",
      "clientId": 12,
      "clientName": "Northwind Traders",
      "matterId": 301,
      "matterRef": "00343-00012",
      "matterName": "Data breach response",
      "assetTypeId": 4,
      "assetTypeName": "Data source",
      "createdAtUtc": "2026-10-29T14:03:00Z",
      "updatedAtUtc": "2026-10-30T08:41:00Z",
      "statusCode": "ACTIVE",
      "linkedTaskCount": 3,
      "openLinkedTaskCount": 2
    }
  ]
}
```

`updatedAtUtc` is `null` for an asset never modified. `linkedTaskCount` and `openLinkedTaskCount` are `null` without `Task.View` (but this endpoint needs it, so they are present here).

### 5.2 Detail with linked tasks

`GET /api/v1/my-matters/assets/{assetId}` (nswag: `getMyMattersAsset`) - 404 when the asset is missing or its matter is not visible.

Returns the summary of 5.1 plus the type-specific values for display, and every linked task with its **latest task comment** (assets have none). Editing an asset keeps using `PUT /api/v1/assets/{assetId}`.

```json
{
  "assetId": 512,
  "name": "Custodian laptops - batch 3",
  "clientId": 12,
  "clientName": "Northwind Traders",
  "matterId": 301,
  "matterRef": "00343-00012",
  "matterName": "Data breach response",
  "assetTypeId": 4,
  "assetTypeName": "Data source",
  "description": "Imaged on 2026-10-28.",
  "externalReference": null,
  "createdAtUtc": "2026-10-29T14:03:00Z",
  "createdByName": "Test User 35",
  "updatedAtUtc": "2026-10-30T08:41:00Z",
  "statusCode": "ACTIVE",
  "sizeValue": 1.5,
  "sizeUnit": "TB",
  "linkedTasks": [
    {
      "taskId": 1042,
      "taskNumber": "TSK-1042",
      "title": "Review privilege log",
      "statusCode": "IN_PROGRESS",
      "statusLabel": "In Progress",
      "dueDate": "2026-10-28",
      "isOverdue": true,
      "assigneeName": "Test User 12",
      "latestComment": {
        "commentId": 9001,
        "authorName": "Test User 12",
        "createdAtUtc": "2026-10-30T09:00:00Z",
        "excerpt": "Waiting for the client's log, chased on Friday."
      }
    }
  ]
}
```

`latestComment` is `null` when the task has no ordinary comment. `excerpt` is plain text cut to 160 characters (the comment HTML is stripped); privileged or internal-purpose comment kinds are not returned (same rule as the activity feed: only ordinary comments).

## 6. Endpoints already in use by the page (unchanged)

For completeness; these keep their current shape (see the OpenAPI document):

- `GET /api/v1/my-matters/summary`, `attention`, `deadlines`, `calendar` (task due dates), `workload`, `breakdown`, `data`: the Overview and Metrics tabs.
- `GET /api/v1/matters`, `GET /api/v1/clients`: lookups for the Client and Matter dropdowns and "Browse".
- `POST /api/v1/task-queue/...` and `/api/v1/tasks/...`: task create and edit (the `+ New` dialogs). New projects require a matter: `matterId` is required on `POST /api/v1/projects` (see the change log when it lands).

## 7. Change log

- 2026-10-31: first version (Agent 1).
