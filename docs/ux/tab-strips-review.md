# Tab strips review (LC-10, issue #1058, epic #1037)

Date: 2026-11-03. Owner question: some tabs have icons and some do not; make it consistent. Rule: theme guide 11.3.

## Inventory

| Where | Strip before | Icons before | After |
| --- | --- | --- | --- |
| Matter detail (Summary ... Activities) | `mf-tabs` | yes | unchanged (LC-08) |
| Client page (Overview, Matters) | `mf-tabs` | no | `mf-tabs`, icons |
| Project page (Tasks, Details) | `mf-tabs` | no | `mf-tabs`, icons |
| Asset record (Details, Linked tasks, History) | `mf-tabs` | no | `mf-tabs`, icons |
| Task detail (Workflow, Assets, Comments) | `mf-tabs` (dense) | no | `mf-tabs`, icons |
| My Matters (Overview, Calendar, Assets, Metrics, Activity) | `mf-tabs` | no | `mf-tabs`, icons (Assets = database, Activity = history, same as the Matter) |
| Dashboard (Summary, Breakdowns, Trends, Swimlane, Users) | local strip in `mf-dash-tabs` | no | `mf-tabs` inside the header, icons |
| Swimlane lane switcher (phone) | local strip | no | `mf-tabs`, one lane icon, count in brackets |
| My Work and Pod Work views | local `mf-work-tabs` | no | `mf-work-tabs` is a wrapper of `mf-tabs`, icons |
| Administration: Users / Roles / Pods, Labels, Task types / Workflows / Steps, Asset types, Reports (via `admin-list-shell`) | `mf-tabs` | no | `mf-tabs`, icons from the tab's id |
| Admin records: Task type, Workflow, Workflow version, Step, Asset type, Report editor | `mf-tabs` | mostly no | `mf-tabs`, icons |
| Roles page (Permissions, Reports) | `mf-tabs` | no | `mf-tabs`, icons |
| Settings (Branding) | `mf-tabs` | no | `mf-tabs`, icon |
| Search results (All, Matters, Clients, Tasks, Projects, Assets) | `mf-tabs` | no | `mf-tabs`, icons |
| Record skeletons | `mf-tabs` | no | same icons as the real page |

Local implementations replaced: `mf-work-tabs`, the strip in `mf-dash-tabs`, the Swimlane lane switcher. Dialogs and side panels have no tab strip.

Notes on differences accepted: My Work no longer bolds the count of Active and Due soon (one count style everywhere); the Dashboard has one panel id (`mf-dash-panel`) instead of one per tab; the Swimlane lane tabs show icon, name and count in the shared style and scroll sideways if they do not fit.

## Icon choices

See the table in theme guide 11.3 and `shared/ui/tab-icons.ts` (one registry, one icon per concept).

## Checks

Build and unit specs (`tab-icons.spec.ts`, `dash-tabs.spec.ts`, `tabs.spec.ts`, swimlane and work-list specs). Screenshots of each strip were not captured in this pass (no local stack after the container restart); the strips can be checked in the running app.
