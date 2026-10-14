# UAT round 2: Tasks, queues, search, dashboard, audit browser and accessibility

Run by the user agent on `dev` (2026-10-14) as System Admin `ke\kekim`, Project Manager (priya), Data Technicians (jamal, elena), Director (dana), Pod Lead (marcus), a Task.View-only role (viewer), an Intake Coordinator (newhire) and a user with no role (sam). About 125 screenshots are in `screenshots/` (`k<journey>-<seq>-<what>.png`).

## 1. Run instructions that worked

- SQL Server: `docker run ... -p 14331:1433 --name uat2-sql mcr.microsoft.com/mssql/server:2022-latest`, wait about 20 s, create the empty `MatterFlow` database with sqlcmd.
- API: the round-1 environment variables (see `../uat-round-1/report.md`) with the connection string on port 14331, plus `Dev__Users__N__Username/DisplayName/Roles__0` for each persona; `dotnet run --urls http://localhost:5080`.
- Frontend: `npm run start:api`. Browser: Playwright + axe, `X-Dev-User` per browser context.
- Users without a prior sign-in are provisioned by calling `GET /api/v1/me` as that user, then granted a role through the admin UI.
- Note: another agent's `npm ci` briefly broke `ng serve` (Vite error overlay blocked clicks); restarting `npm run start:api` fixed it. Not an app defect.

## 2. Journey results

| J | Result |
|---|---|
| K1 Admin setup (roles, clients, matters, assets) | PASS (UAT2-02 date typing, UAT2-10) |
| K2 PM creates tasks (manual, pasted email, .eml, assign, cancel) | PARTIAL (UAT2-01, 13, 17) |
| K3 Technician works a task (steps, bulk-complete, hold, comments, links, activity) | PARTIAL (UAT2-09, 11, 12, 14, 15) |
| K4 Director (dashboard, queue, search, advanced search, tabs, audit log) | PASS (UAT2-07, 14, 20) |
| K5 Permission checks | PASS (UAT2-18) |
| K6 Accessibility (axe, keyboard, zoom, motion) | PARTIAL (UAT2-03, 04, 05, 06) |
| K7 Responsiveness and console | PASS (UAT2-21, 24) |

No Blocker. 4 pass, 3 partial, 0 fail.

## 3. Findings (each reproduced at least twice)

### Major
- **UAT2-01** A task's request-form asset references show raw ids. TSK-1 Details reads "Source collection / data set: 5" and "Target Relativity workspace: 1" (k2-07); on Edit, "Related asset" is a bare numeric spinbutton with no picker (k2-15); the referenced assets' Linked Tasks tab shows none (k4-17). Area: form-engine ASSET_REF read-only and edit renderers (`frontend/projects/form-engine/src/lib/renderer/dynamic-form.*`) and the backend task-to-asset link projection.
- **UAT2-02** Typed dates in the form engine (`p-datepicker`, `dateFormat="yy-mm-dd"`, `dynamic-form.html` lines 175-195) are broken: the first typed date is discarded on first blur (3 runs); key-by-key typing produced `2026-09-016`; `09/14/2026`, `Oct 1, 2026`, `10/1/26` are silently cleared; no format hint (k1-22).
- **UAT2-03 (a11y)** Focus is lost after dialogs close: it lands on "Skip to main content" or `body` after Esc/Keep/Close on the Skip, blocked Complete, Cancel and Hold dialogs; also lost after a keyboard matter pick in Create Task (k6-04).
- **UAT2-04 (a11y)** Every `p-select` combobox has `aria-label="Select..."` instead of its field label; the dialog X icon button has no accessible name (axe `button-name`, serious, in the Hold and blocked-Complete dialogs, k6-01).

### Minor
- **UAT2-05** "Delete role" contrast 3.76:1 (`#ef4444` on white); axe `color-contrast` serious (k6-02).
- **UAT2-06** ARIA to review: "Change status" `aria-controls` points at a missing id; `aria-labelledby` on plain divs for read-only values; hidden focus sentinels inside dialogs trigger `aria-hidden-focus`.
- **UAT2-08** A single non-numeric character in global search shows nothing and no hint.
- **UAT2-09** Form-engine error copy reads badly: "Select Category.", "Enter What is needed.", "Select What is driving the due date?." (k3-05).
- **UAT2-10** Required-fields summary is vague: "Complete the highlighted fields: Approximate size (GB)" (k1-23).
- **UAT2-11** The rich-text link button silently rejects `javascript:` and inserts a URL with no space before it ("run QChttps://...", k3-21).
- **UAT2-12** The link-asset picker gives no feedback for no results; duplicate asset names are indistinguishable (k3-27).
- **UAT2-13** Edit task limits Assignee to the chosen Pod's members (only "Unassigned" when no Pod); Create allows any user; nothing explains it (k2-14). (Also e2e finding E2E-F2.)
- **UAT2-15** The system "On hold reason" comment is editable (k3-24). (Also security finding SEC2-07.)
- **UAT2-16** Past due dates are accepted without a warning.
- **UAT2-18** Read-only viewers see edit-oriented copy ("Move it back to In Progress to edit", "You will be asked whether to mark them all completed") and a disabled Complete task button with no explanation (k5-02, k5-04).
- **UAT2-19** `GET /api/v1/me/pods` returns 403 on every shell load for users without Pod.View (a console error each time).
- **UAT2-21** Task Queue table is 1046 px wide: Status and Age are off-screen at 1024, Due at 768, with no scroll hint.
- **UAT2-23** NG0956 console warning on `/assets/new`; no announcement after "Check again" on Access Pending.
- **UAT2-24** At 375 px, tables and the task tab strip overflow.

### Cosmetic
- **UAT2-07** Search highlight inserts gaps: "00 343 -00012", "matc h_ test" (k4-07).
- **UAT2-14** Activity and audit wording uses internal keys and codes: `received_datetime`, `FormValueSet 55`, "Reassigned from Processing Pod (pod) to Jamal Okafor (Processing Pod)" (k3-30, k4-18).
- **UAT2-17** The Create Task validation summary stays stale after fields are fixed (k2-03).
- **UAT2-20** Filter chips show ISO dates ("Due: until 2026-10-16").
- **UAT2-22** Round-1 items still present: sidebar background ends partway down short pages; buttons small (about 11-12 px); Access Pending has a stray space before the full stop ("ke\sam ."); the "ke\kekim Seeded" label in the Users list is unclear; zero-count dashboard bars show a sliver and labels are truncated.

## 4. Accessibility (axe wcag2a, wcag2aa, wcag21aa)

- 60 admin route and tab states: **0 violations** (every route in `app.routes.ts` and the admin routes; task detail in all 5 tabs for TSK-1 and TSK-2; Access Pending as `ke\sam`).
- Interactive states: 2 serious violations (UAT2-04, UAT2-05) plus the needs-review items in UAT2-06.
- Keyboard, zoom, motion: skip link and visible focus work; global search combobox (Ctrl+K, arrows, Enter, Esc); roving-tab task tabs; status menu returns focus on Esc. At 200 % zoom (640 CSS px) no horizontal overflow on 16 screens. Reduced motion is honoured. Status, priority and overdue carry an icon plus text, not colour alone.

## 5. Verified good

Dashboard tile counts match the queue exactly; queue ordering, paging and sort are correct; `%`, `_` and `[` in search are treated literally; overdue labels are correct in New York, Los Angeles and Auckland; email paste and all 5 `.eml` samples fill the form correctly; UI and API enforce permissions and a cross-matter asset link returns 409; round-1 items UAT-01, 02, 03, 09, 11, 13 and 16 are fixed.

## 6. Console and network

3x 403 on `/me/pods` (viewer) and 1 NG0956 warning; no 5xx and no page errors.

## 7. Cleanup

The API, `ng serve` and the `uat2-sql` container were stopped. Scratch scripts and logs: `/tmp/claude-0/-home-user-MatterFlow/ac891d55-a228-5712-8916-fb387c7f73c4/scratchpad/uat2/` (`axe-admin.json`, `netlog.jsonl`).
