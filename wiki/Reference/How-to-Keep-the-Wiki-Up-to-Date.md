# How to Keep the Wiki Up to Date

[[_TOC_]]

**What this page is for.** The rules that keep this wiki correct. The wiki lives in the repository (`wiki/`) and is published to the Azure DevOps wiki, so a change that makes a page wrong must update the page **in the same change**. `CLAUDE.md` points here.

## The rule

When you change the schema, a module, a route, a permission or a setting, update the matching wiki page in the same commit or pull request. Reviewers should ask for it. A wiki page that says something the code no longer does is worse than no page.

## What change needs which page

| You change | Update these pages |
|---|---|
| A SQL script (new table, column, index, trigger, permission insert) | [ER Diagrams](../Database/ER-Diagrams.md) (entity and relationship lines), [Table Reference](../Database/Table-Reference.md) (the table entry: columns, keys, indexes, scripts line), [Schema Script History](../Database/Schema-Script-History.md) (one row), [Views and Procedures](../Database/Views-and-Procedures.md) if you add a trigger, function or procedure, [Database Overview](../Database/Overview.md) if counts or conventions change. Then run `node wiki/tools/check-db-docs.mjs` |
| A new module or a new project reference | [Backend Modules](../Architecture/Backend-Modules.md) (module list and dependency diagram), [Module Guide](../Backend/Module-Guide.md), [Feature Map](../Features/Feature-Map.md) |
| A new controller or endpoint group | [Feature Map](../Features/Feature-Map.md) (row and controller index), [Module Guide](../Backend/Module-Guide.md) |
| A new frontend route or menu item | [Routing and Navigation](../Frontend/Routing-and-Navigation.md), [Feature Map](../Features/Feature-Map.md), [Folder Structure](../Frontend/Folder-Structure.md) if a feature folder is new |
| A new permission | [Permission Catalogue](Permission-Catalogue.md) (add a row; check the count), [Routing and Navigation](../Frontend/Routing-and-Navigation.md) if a route uses it, [Authentication and Authorization](../Architecture/Authentication-and-Authorization.md) if the starter roles change |
| A new application setting (`SettingDefinitions.cs`) | [Settings Catalogue](Settings-Catalogue.md) |
| A new configuration key (`appsettings`) | [Configuration Reference](../Operations/Configuration-Reference.md) |
| A new UI pattern or shared component | `docs/ux/design-guidelines.md` (the standard, owned by the UI designer), [Shared Components Catalogue](../Frontend/Shared-Components-Catalogue.md) if it is a new "need to component" row |
| An API change | Nothing in the wiki unless it adds a controller (see above); regenerate `contracts/openapi/v1.json` and the client |
| A new error code | `SharedKernel/Results/ErrorCodes.cs`; mention in [Conventions](Conventions.md) only if it opens a new family |
| A new audit event family | [How to Add an Audit Event](../Backend/How-to-Add-an-Audit-Event.md) only if the recipe changes |
| A CI workflow or command | [Continuous Integration](../Getting-Started/Continuous-Integration.md), [Commands](../Getting-Started/Commands.md) |
| Deployment, hosting, runbook steps | [Deployment and Hosting](../Architecture/Deployment-and-Hosting.md), [Runbook](../Operations/Runbook.md), [Release Checklist](../How-To/Release-Checklist.md) |
| A new decision (addendum section or ADR) | [Decision Index](Decision-Index.md) |
| A new document in `docs/` | [Documentation Map](Documentation-Map.md) |
| A new term | [Glossary](Glossary.md) |
| Sensitive matter rule, availability or calendar behaviour | [Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md), [Availability Capacity and Calendar](../Architecture/Availability-Capacity-and-Calendar.md) |

## Page standards

- Every page starts with a paragraph "What this page is for", ends with "Related pages" and a line `Last verified against commit <sha>` (use `git rev-parse --short HEAD`; update the sha when you re-check the page).
- Write from the code. If you could not verify a statement, write "unverified" in the page instead of guessing.
- Plain English, short sentences, tables and bullet lists. No marketing text, no HTML, no images that need uploading. Do not copy long text from `docs/`; summarise and name the file.
- Files outside `wiki/` are written as code paths (`docs/architecture.md`), not links: the published wiki cannot follow them. Links between wiki pages are relative (`../Database/Overview.md`).

## Azure DevOps conventions

- Page = one `.md` file; file names use hyphens (shown as spaces). A folder with the same name as a page holds its sub-pages (`Database.md` and the folder `Database/`).
- Each folder has an `.order` file listing page names without `.md`, one per line, in display order. A new page must be added to the `.order` of its folder.
- `[[_TOC_]]` on its own line makes a table of contents.
- Diagrams use `::: mermaid` on its own line, the diagram, then `:::` on its own line (not triple backticks). Keep to flowchart, sequence, ER, class and basic state diagrams, and the older syntax. Keep a diagram small enough to read; split it otherwise. Quote labels that contain special characters.
- Publish: Azure DevOps > Overview > Wiki > Publish code as wiki > this repository, the branch and the folder `/wiki`. After that, every push to that branch updates the wiki.

## Generated pages

[ER Diagrams](../Database/ER-Diagrams.md), [Table Reference](../Database/Table-Reference.md), [Schema Script History](../Database/Schema-Script-History.md) and [Permission Catalogue](Permission-Catalogue.md) were first generated from the real database, the scripts and the permission catalog, and then edited. Update them by hand following the existing format; the check script catches a missing table, foreign key or script. The generator itself is not kept in the repository.

## Related pages

- [Home](../Home.md)
- [Documentation Map](Documentation-Map.md)
- [Branching and Workflow](../Getting-Started/Branching-and-Workflow.md)

Last verified against commit c4bfdaf.
