> **How this folder is published.** This `wiki/` folder is published as the Azure DevOps wiki: Azure DevOps > Overview > Wiki > Publish code as wiki > pick this repository, the branch and the folder `/wiki`. Each page is a `.md` file. Page names use hyphens (shown as spaces in the title). A folder with the same name as a page holds its sub-pages, and the `.order` file in each folder sets the display order. Diagrams are Mermaid, written in the Azure DevOps form (`::: mermaid` on its own line, the diagram, then `:::`). Links to other wiki pages are relative. Files outside `wiki/` (for example `docs/architecture.md`) are written as plain code paths, because the published wiki cannot link to them: open them in the repository.

# MatterFlow developer wiki

[[_TOC_]]

**What this page is for.** This is the front door of the developer wiki. MatterFlow is an internal law-firm eDiscovery tool: it tracks Clients, Matters (cases), Projects, Assets (data sources), Tasks and the Workflows that make a Task run. The wiki explains how the code, the database and the screens fit together, so that a developer can find the right place quickly when adding a feature, changing something or fixing a bug.

The wiki was written from the code, the SQL scripts, the contracts and the design documents in the repository. Where something could not be confirmed, the page says "unverified". The design documents under `docs/` stay the source of truth for design decisions (start with `docs/architecture.md`); the wiki summarises them and says where to look.

## Who this wiki is for

- A developer who is new to the repository and needs a map.
- A developer who has a task ("add a field", "fix this screen", "add a permission") and needs to know which files to touch.
- A reviewer or tester who wants to know how a feature is built and tested.

## The system in one picture

::: mermaid
flowchart LR
  U["Browser: Angular 21 app (PrimeNG)"] -->|"HTTPS, /api/v1, JSON"| A["ASP.NET Core 10 API: modular monolith"]
  A -->|"EF Core and SQL"| D[("SQL Server 2022")]
  A -->|"Windows auth (production) or Dev auth"| I["IIS or Kestrel host"]
  A -.->|"read-only report login"| D
:::

More diagrams are on [System Overview](Architecture/System-Overview.md).

## How a change goes from request to release

Every request is a work item. The product manager reviews, plans and approves it. A developer branches from `dev`, builds it and, before opening a pull request, runs the unit tests for the changed code, follows the UI guideline in `docs/ux/design-guidelines.md` (`CLAUDE.md` says where to find it) and runs an AI consistency review. The pull request needs green CI, the product manager's approval (behaviour) and the technical reviewer's approval (code). After the merge to `dev`, full QA and the security check run. A commit that passes goes to `uat`, and after UAT is accepted it is merged to `main` and tagged with the version.

::: mermaid
flowchart LR
  A["Work item"] --> B["Product manager approves"]
  B --> C["Branch from dev, build, check"]
  C --> D["Pull request: CI, PM and code review"]
  D --> E["dev: full QA and security check"]
  E --> F["uat: UAT testing"]
  F --> G["main: tag the version"]
:::

Details, roles and the open items: [Change Management Process](Getting-Started/Change-Management-Process.md).

## Find it fast

| I want to ... | Read |
|---|---|
| See how a change goes from request to release | [Change Management Process](Getting-Started/Change-Management-Process.md) |
| Get the app running on my machine | [Local Setup](Getting-Started/Local-Setup.md) |
| Know what each top-level folder contains | [Repository Map](Getting-Started/Repository-Map.md) |
| Find the right build, test or lint command | [Commands](Getting-Started/Commands.md) |
| Understand branches and commit messages | [Branching and Workflow](Getting-Started/Branching-and-Workflow.md) |
| Know what CI checks and reproduce it | [Continuous Integration](Getting-Started/Continuous-Integration.md) |
| See how the backend modules depend on each other | [Backend Modules](Architecture/Backend-Modules.md) |
| Follow one HTTP request from browser to database | [Request Lifecycle](Architecture/Request-Lifecycle.md) |
| Understand logins, roles and permissions | [Authentication and Authorization](Architecture/Authentication-and-Authorization.md) |
| Make a new endpoint safe for Sensitive matters | [Sensitive Matter Visibility](Architecture/Sensitive-Matter-Visibility.md) |
| See the database tables and how they relate | [ER Diagrams](Database/ER-Diagrams.md) and [Table Reference](Database/Table-Reference.md) |
| Change the database schema | [How to Change the Schema](Database/How-to-Change-the-Schema.md) |
| Find which module owns a feature | [Module Guide](Backend/Module-Guide.md) and [Feature Map](Features/Feature-Map.md) |
| Add a backend endpoint | [How to Add an Endpoint](Backend/How-to-Add-an-Endpoint.md) |
| Add a permission or a setting | [How to Add a Permission](Backend/How-to-Add-a-Permission.md), [How to Add a Setting](Backend/How-to-Add-a-Setting.md) |
| Find the page (route) for a screen | [Routing and Navigation](Frontend/Routing-and-Navigation.md) |
| Add a screen | [How to Add a Page](Frontend/How-to-Add-a-Page.md) |
| Pick the right shared UI component | [Shared Components Catalogue](Frontend/Shared-Components-Catalogue.md) and [UI Standard](Frontend/UI-Standard.md) |
| Add a complete feature from schema to tests | [Add a Feature End to End](How-To/Add-a-Feature-End-to-End.md) |
| Start fixing a bug | [Fix a Bug](How-To/Fix-a-Bug.md) |
| Search the code the right way | [Find Things](How-To/Find-Things.md) |
| Look up a term (CM Number, Pod, Production ...) | [Glossary](Reference/Glossary.md) |
| Look up a permission or an application setting | [Permission Catalogue](Reference/Permission-Catalogue.md), [Settings Catalogue](Reference/Settings-Catalogue.md) |
| Fix a local error (disk, Docker, SQL, drift, Playwright) | [Troubleshooting](Operations/Troubleshooting.md) |
| Keep this wiki correct | [How to Keep the Wiki Up to Date](Reference/How-to-Keep-the-Wiki-Up-to-Date.md) |

## Sections

| Section | What is in it |
|---|---|
| [Getting Started](Getting-Started.md) | Setup, repository map, commands, workflow, CI |
| [Architecture](Architecture.md) | System and module design, request flow, security, contracts, hosting |
| [Database](Database.md) | Schema conventions, ER diagrams, table reference, script history |
| [Backend](Backend.md) | Module guide, how-to pages, backend testing |
| [Frontend](Frontend.md) | Folder structure, routes, components, API client, forms, tests |
| [Features](Features.md) | Feature map: feature to module, tables, endpoints, route, tests |
| [How To](How-To.md) | Step-by-step recipes for common developer tasks |
| [Operations](Operations.md) | Runbook summary, configuration, troubleshooting, demo data |
| [Reference](Reference.md) | Glossary, catalogues, decisions index, conventions, documentation map |

## Conventions used in this wiki

- Paths are relative to the repository root unless they start with `wiki/`.
- A path in backticks that starts with `docs/`, `backend/`, `frontend/`, `db/`, `contracts/`, `tools/` or `deploy/` is a file or folder in the repository.
- "Script 35" (a number up to 66) means an SQL script of the archived chain `db/scripts/archive/35-matter-visibility.sql`; its content is in `db/scripts/00-baseline.sql` since the squash (issue #1307). Scripts numbered 67 and higher are in `db/scripts/`.
- "Epic #788" or "issue #1234" refers to a GitHub issue; the number is kept so the history can be searched.
- Every page ends with "Related pages" and the commit it was last verified against.

## Related pages

- [Overview](Getting-Started/Overview.md)
- [Documentation Map](Reference/Documentation-Map.md)

Last verified against commit b03d0ac.
