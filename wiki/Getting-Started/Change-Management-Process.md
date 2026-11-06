# Change Management Process

[[_TOC_]]

**What this page is for.** How a change goes from a request to a tagged release: who does what, which checks must pass at each step, and which branch the change lives on. It is the process the owner decided on 2026-11-06. Branch commands and commit message forms are on [Branching and Workflow](Branching-and-Workflow.md); the checks are on [Continuous Integration](Continuous-Integration.md) and in the README section "Testing and QA".

**Status today (so you know what is real).**

- The code is in the Azure DevOps repo (target). Until the move is finished, some history and tooling still point to GitHub: issue numbers like `#1234` in commit messages and the workflows in `.github/workflows/` (GitHub Actions).
- There is **no UAT environment yet**. It will be created soon. Until then the `uat` step below is a placeholder: do not skip the step in your planning, but nothing is deployed to UAT.
- The security tooling for Azure DevOps has not been chosen yet (see "Open items").

## The flow in one picture

::: mermaid
flowchart LR
  R["1. Request: work item (issue or epic) in Azure DevOps"] --> P["2. Product manager reviews, plans, approves"]
  P --> D["3. Developer picks an approved item, branches from dev"]
  D --> C["4. Checks before the PR: targeted tests, UI guideline, AI review"]
  C --> PR["5. Pull request: CI green, product manager and technical reviewer approve"]
  PR --> DEV["6. Merge to dev"]
  DEV --> Q["7. Full QA and security check on dev"]
  Q --> UAT["8. Merge the tested commit to uat, UAT testing"]
  UAT --> M["9. Merge to main and tag the version"]
:::

## Who does what

| Role | Person | Responsibility |
|---|---|---|
| Requester | anyone | Logs the request as a work item (issue) or epic, with what is wanted and why. |
| Product manager | the product manager | Reviews each request, plans it, approves it for work, and approves the finished behaviour on the pull request. |
| Developer | whoever picks the item | Builds the change, runs the checks, opens the pull request. May pick any item that is approved. |
| Technical reviewer | the owner (with AI help) | Reviews the code on the pull request. Approves or asks for changes. |
| QA and security | whoever runs the full checks | Runs full QA and the security check on `dev`, and reports what passed, failed and was not run. |

## Step by step

### 1. Request
Every request is logged as a work item in Azure DevOps (an issue, or an epic for a larger body of work). Nothing is built without a work item. Write what is wanted, who needs it, and how to tell it is done.

### 2. Review and plan (product manager)
The product manager reviews the request, asks questions, decides if and when to do it, and approves it. Only approved items are worked on. Larger requests are split into issues under an epic.

### 3. Pick up and branch (developer)
- The developer is assigned the item, or picks an approved one, and moves it to "in progress".
- Create a feature or working branch **from `dev`**, named `feature/<work-item-id>-short-name` (or `fix/<work-item-id>-short-name` for a bug). This naming is a convention, not enforced.
- Never work directly on `dev`, `uat` or `main`.

### 4. Before you open the pull request
Run these on your own machine. Run the unit tests **for the code you changed**, not the whole suite (CI runs the whole suite for you).

1. **Quick check** and **unit tests of the changed area** (README, "Testing and QA", levels 1 and 2). If you changed the API, regenerate the client; if you changed the schema, add a numbered SQL script (see [How to Change the Schema](../Database/How-to-Change-the-Schema.md)).
2. **UI guideline.** Every change that touches a screen, dialog, button, grid, chip, link, icon, label or date must follow the one UI standard in `docs/ux/design-guidelines.md`. `CLAUDE.md` has a section "UI standard" that says where it is and the rules in short; [UI Standard](../Frontend/UI-Standard.md) is the wiki summary. Run `npm run lint` and the guard specs: they enforce many of the rules automatically.
3. **AI consistency review.** Ask the AI to review your changes against the guideline and list every deviation, then fix them. A prompt that works: "Review my changes against docs/ux/design-guidelines.md and its checklist. List every place that breaks a rule (component, wording, size, colour, date or number format) and propose the fix." A new pattern, or a reason to break a rule, goes to the UI designer first; developers do not decide the look alone.
4. **Wiki.** If you changed the schema, a module, a route, a permission or a setting, update the matching wiki page in the same change ([How to Keep the Wiki Up to Date](../Reference/How-to-Keep-the-Wiki-Up-to-Date.md)).
5. Screenshots (1366x768 and 1920x1080) are evidence, not code. Do not commit them to the branch; attach or store them as described on [Branching and Workflow](Branching-and-Workflow.md).

### 5. Pull request
- Open a pull request from your branch **into `dev`**. Link the work item in the description (write `AB#<id>` so Azure DevOps links it). Use the commit message form on [Branching and Workflow](Branching-and-Workflow.md): first line `<work item id> <short what changed>`, then one bullet per main navigation page or component changed.
- In the description list: what changed, what to open and check, which tests you ran and which you did **not** run.
- **Merge needs all of:** the CI pipeline green (build with warnings as errors, format, the full unit, architecture, integration and schema tests, frontend lint, tests and build, API drift checks), the **product manager's approval** (behaviour matches the request), the **technical reviewer's approval** (code), and all comments resolved.
- Recommended branch policy on `dev`, `uat` and `main`: no direct pushes, pull request required, the CI pipeline as a required check, at least the two approvals above.

### 6. Merge to `dev`
After the approvals, the pull request is merged into `dev`. The work item is moved to "done in dev" (not closed yet).

### 7. Full QA and security check on `dev`
Once code is merged to `dev`, run **full QA** (README, "Testing and QA", level 4): all levels green, the full end-to-end suite on a fresh database, a real-stack browser check of the changed pages at both sizes with an accessibility scan, and a performance check when lists or queries changed. Run the **security check** on the same commit (see "Security check"). Write the result, including what was not run, in a QA report and link it from the work items. A failure is a new work item (or a fix on a new branch from `dev`), never a quiet fix on `dev`.

### 8. Promote to `uat`
Only a commit that **passed step 7 completely** is merged into `uat`; do not merge "whatever is on `dev` now". UAT users test against the planned UAT environment. Problems found in UAT are new work items fixed through steps 3 to 7, then promoted again.

### 9. Release to `main` and tag
When UAT is accepted, merge the same tested commit into `main` and tag it with the version (for example `v0.2.0`). Before tagging, set the same version in the root `package.json` (the app shows it at the foot of the navigation; see the README, "App version"). The package for deployment is built from `main` (see [Release Checklist](../How-To/Release-Checklist.md)). Close the work items and note the version on them.

### Hotfix (urgent fix of a released version)
Branch from `main` (`fix/<id>-short-name`), open the pull request into `main`, run the quick check, unit tests and the targeted checks plus the security check, test it on `uat`, merge to `main`, tag a patch version (for example `v0.2.1`), then merge `main` back into `dev` and `uat` so the fix is not lost. This path is a proposal and is not yet used.

## Security check
What exists today: the CodeQL workflow (`codeql.yml`, push to `dev` and weekly), Dependabot updates for NuGet, npm and GitHub Actions, and the nightly dependency audits ([Continuous Integration](Continuous-Integration.md)). The rule to follow: **a High or Critical finding on `dev` blocks promotion to `uat`**; lower findings become work items. Which tools do this in Azure DevOps is an open item below.

## Open items (decisions or work still to do)

- **UAT environment and `uat` branch:** to be created. Until then, step 8 is not available.
- **Pipelines:** the CI, end-to-end, nightly, CodeQL and publish workflows exist as GitHub Actions. They must be rebuilt as Azure Pipelines before the pull request gate above can run in Azure DevOps.
- **Security tooling in Azure DevOps:** choose the code scanning, dependency audit and secrets scan, and decide whether they also run on pull requests.
- **Merge type** for pull requests (merge commit or squash): not decided.
- **Work item history:** older commits and wiki pages refer to GitHub issue numbers (`#788`, `#1234`). After the move, keep those numbers as plain history; new work uses Azure DevOps work item IDs.
- **Branch policies:** set up as recommended in step 5 once the repo is in Azure DevOps.

## Related pages

- [Branching and Workflow](Branching-and-Workflow.md)
- [Continuous Integration](Continuous-Integration.md)
- [Release Checklist](../How-To/Release-Checklist.md)
- [UI Standard](../Frontend/UI-Standard.md)
- [How to Keep the Wiki Up to Date](../Reference/How-to-Keep-the-Wiki-Up-to-Date.md)

Last verified against commit eea249f. This page describes a process decided by the owner; the UAT environment, Azure pipelines and security tooling are not built yet.
