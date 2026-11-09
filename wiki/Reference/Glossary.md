# Glossary

[[_TOC_]]

**What this page is for.** The words used in the product and in the code, in plain language. eDiscovery terms are explained briefly for developers who do not work in the field. Sources: `docs/requirements/baseline-v1.1.md` section 2.1, `docs/ux/design-guidelines.md` section 4.4, the decisions addendum and the code.

## Business terms

| Term | Meaning |
|---|---|
| eDiscovery | Collecting, processing and reviewing electronic data for legal matters. MatterFlow tracks the operational work of the eDiscovery department |
| Client | A firm client. Has a firm **Client Number** (5 digits, zero padded, for example `00343`). Table `Client` |
| Matter | An engagement (case) under one client. Has a **Matter Number** (5 digits, unique within the client). Table `Matter` |
| **CM Number** | The combined reference of a matter: client number plus matter number, for example `00343-00012`. The UI word is "CM Number"; the code calls it `MatterRef` (`Matter.MatterRef`). Search accepts `343`, `343-12` and `00343-00012` |
| Project | An optional folder inside a matter that groups tasks. A project always belongs to a matter |
| Asset | A matter-owned record of a data source or deliverable: physical media, a data set, a workspace (for example Relativity), a vault, a third-party data set. No files are stored in MatterFlow |
| Asset Type | An admin-defined kind of asset with its own custom fields, icon, colour and optional size field |
| Asset disposition | The retention state of an asset: Active, Inactive, Pending disposition, Disposed |
| Asset link role | How an asset relates to a task (Source, Destination, Subject, Result, Related by default) |
| Task (Request) | A unit of operational work on a matter, of one task type, with a priority, status, due date and optional assignee |
| Task number | `TSK-` plus a sequence number, for example `TSK-1042` |
| Task Type | Admin-defined kind of task (for example Production, Data Processing). Has a request form, eligible workflows and a default workflow |
| Task status | One of five fixed states: New, In Progress, On Hold, Completed, Cancelled (labels can be renamed, codes cannot) |
| On Hold reason | An admin-managed reason a task is put On Hold |
| At risk | An open task that is not yet overdue but has used 80 percent of its task type's target days |
| Priority | An admin-managed label with a sort order (for example Critical, High) |
| Workflow | A named, versioned list of steps. A task type can use one of its eligible workflows |
| Workflow version | An immutable published version of a workflow. A task keeps the version it was created with |
| Step (Workflow Step) | One item of a workflow: title, instructions, documentation link, optional input form, skippable or not |
| Step Definition | A reusable step in the step library; copied into a workflow version |
| Step instance | The state of a step on a particular task: Pending, In Progress, Completed, Skipped |
| Form, form version | An admin-defined form (request form of a task type, input form of a step, asset type fields, custom fields). Versions are Draft, Published or Retired |
| Custom field | An admin-defined field on a client, matter, project or asset |
| Production | A delivery of documents to or from a party (outgoing or incoming) for a matter, with a Bates range and counts |
| Production spec | The agreed format of productions of a matter (image format, load file, redaction rules and so on) |
| Bates number | A page identifier stamped on produced documents; a production holds a begin and end range |
| Note | A rich-text note on a matter, with tags, pinning and a lock |
| Pod | A team of technical people. A **Pod Lead** is a role, not a flag |
| Primary PM, Secondary PM | The matter's Primary and Secondary **Project Manager** (the UI words). Set on the matter; a person must hold `Matter.BeManager` |
| Project Manager (PM) | A role that manages matters and works from My Matters |
| Director | The department head role; sees the department, and all Sensitive matters by default |
| Technician (Data Technician), Data Scientist | Starter roles that work tasks |
| System Admin | The built-in role that holds every permission |
| Access Pending | The state of a signed-in person with no role yet |
| Sensitive matter | A matter flagged so that only its managers, holders of `Matter.ViewSensitive` and, for their own tasks, its assignees can see it |
| Out of Office | A dated absence entry of a person (vacation, sick, training, conference, other) |
| Off Hours | The soft state of a person outside their work hours or on a holiday; never "unavailable" |
| Holiday calendar | A set of holiday rules that applies to a person, a pod or everyone |
| Capacity battery | The Dashboard indicator of free task slots (3 per person by default) |
| Unassigned gauge | The Dashboard level (0 to 5) showing how long the oldest unassigned task has waited |
| Coverage | How many expected people are available on a day or in a pod |
| Swimlane | The Dashboard board of tasks grouped in lanes |
| Task Queue | The department-wide list of tasks (the UI word is "Task Queue", never "Tasks") |
| My Work, Pod Work, My Matters | Personal lists: my tasks; tasks of my pod; the Project Manager's matters |
| Data Area | The Data section of My Matters (Metrics tab): assets of the selected matters aggregated by disposition, type and size |
| Intake | Creating a task from an email dropped or pasted into the Create Task page |
| Assignee | The person a task is assigned to (never "owner") |

## Technical terms

| Term | Meaning |
|---|---|
| Module | A backend project that owns tables, services and controllers; modules talk through `.Contracts` projects. See [Backend Modules](../Architecture/Backend-Modules.md) |
| Contracts | The public interfaces and DTOs of a module (`MatterFlow.<Module>.Contracts`) |
| Query side | `WorkViews` and `Search`: read-only modules allowed to read other modules' entities |
| Permission, policy | A permission is a code (`Task.Create`); a policy is its ASP.NET name (`Perm:Task.Create`) |
| rowVersion | The optimistic concurrency token sent with every update; mismatch is 409 |
| Problem details | The standard JSON error body (`application/problem+json`) with a stable `code` |
| Persona walk | The test that calls every endpoint as six personas to prove the Sensitive matter rule |
| Dev auth | The development sign-in provider; never in production |
| Report login | The separate read-only SQL login that reports use |
| nswag | The tool that generates the Angular API client from the OpenAPI document |
| Form engine | The Angular library that renders and designs dynamic forms and evaluates their rules |
| Landing page | The page a person sees first after signing in and on a logo click: their own choice, else the default of their first role by name, else the Automatic rule. Stored as a stable page key |
| Automatic (landing page) | No fixed page: My Matters for managers, My Work when the person has work, else Dashboard or the first page they can open |
| Starter roles / starter configuration | Roles and configuration seeded once on a new install |
| UI2, WPx, epic #n | Labels in commit messages and docs: the UI update 2 round, work packages, GitHub epics |
| Sensitive access catalog | The test table that classifies every endpoint for the Sensitive matter rule |

## Related pages

- [Overview](../Getting-Started/Overview.md)
- [Conventions](Conventions.md)
- [Decision Index](Decision-Index.md)

Last verified against commit a8f9659.
