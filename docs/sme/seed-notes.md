# Starter configuration seed: notes

How `docs/sme/seed-configuration.json` is loaded (ticket #56) and where the real schema forced a change. The JSON file itself is unchanged and is embedded into the API host at build time (`backend/src/MatterFlow.Api/Seeding/`).

## Running it

| Setting | Default | Meaning |
|---|---|---|
| `Seed:StarterConfiguration:Enabled` | `true` in Development, `false` otherwise | Run the seed at startup, after the schema scripts and the module seeds. |
| `Seed:StarterConfiguration:DryRun` | `false` | Log what would be created (including publish validation of every form) and write nothing. |

Example for a first deployment: `Seed__StarterConfiguration__Enabled=true`. Leave it on or switch it off afterwards; re-running is harmless.

The seed runs through the real application services (Task Types, forms designer and publish, step library, workflow publish, Asset Types, roles) as a system actor with no user row, so the audit trail shows "system". A failing item is logged and reported, never stops the host, and is retried on the next start.

## Idempotence rules

- Items are matched by their unique name: role name, step title, workflow name, Task Type name, Asset Type name.
- An existing item is never modified. The one exception is an untouched shell: an existing Task Type, step or Asset Type whose form has no version at all, or only a draft carrying the seed's change note (an interrupted run), gets its form designed and published; an existing workflow whose only version is an empty draft (or a draft with the seed's step count) is filled and published. Eligible workflows of an existing Task Type are never changed.
- A role that an admin deleted is created again on the next run with the seed enabled.
- Roles: the five architecture starter roles are seeded by the Identity module and are left alone (the SME matrix differs slightly from the architecture matrix; the architecture matrix wins). The four SME additions (Intake Coordinator, Read-Only Observer, Configuration Admin, Compliance Auditor) are created with the permission codes of the JSON, which all exist in `contracts/permissions.json`.

## Changes made when converting the seed to the real schema

| Seed content | Real schema | What the seeder does |
|---|---|---|
| Asset Type `statusValues` (Planned, Active, ...) | An Asset has only an active flag; there is no status list. | Adds a leading optional SELECT field `asset_status` ("Status") to each Asset Type form with the SME values. |
| Asset Type `naming` | Asset Type has a 500 character description. | Used as the description (backticks removed). |
| Task Type `titleHint` | Task Type has no example-title column. | Appended to the description as "Example title: ...". |
| Field `help` | `helpText` (max 1000). | Mapped one to one. This carries the privilege reminder on `handling_flags` and the deadline/handling notes. |
| Field `default` | `defaultValue`, checked by publish validation. | Mapped one to one. |
| `showWhen` / `requiredWhen` | Same rule grammar (`and`/`or`/`not`, `eq`, `in`, `contains`, `isTrue`, `isNotEmpty`, ...). | Passed through unchanged; publish validation accepted all of them. |
| `deadline_driver` | Up to 5 filterable fields per form. | Marked filterable (domain review MF-3) so Tasks can be filtered by deadline driver. |
| Pods, seed Client and Matter, Client/Matter/Project custom fields, priorities, status labels | Out of scope of this seed. | Priorities, status labels and link roles are seeded by the Configuration module; the rest is left to the admin (custom fields belong to the custom-fields work). |

No seeded form needed a rule or option change: every one of the 32 forms (15 Task Types, 10 steps, 7 Asset Types) passes `FormPublishValidator`.

## Open items for the SME

- Physical Media Custody Event has no `deadline_driver` block (the SME marks the standard blocks "where relevant"); kept as written.
- Physical Media `custody_status_note` could now be dropped and the disposition fields keyed off the new `asset_status` field (SME note 2 in `seed-configuration.md`, last section). Kept as written to avoid changing the SME's content in code.
- `seed-configuration.md` still describes status values as Asset statuses; the JSON is the source the seeder reads.
