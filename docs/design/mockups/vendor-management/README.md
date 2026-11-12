# Vendor Management and People: clickable mockup

Mockup only, no issue yet, no app code changed. Open `index.html` in a browser (self-contained: tokens copied from `docs/ux/tokens.css`, a PrimeIcons woff2, no network, nothing saves). The **Mockup Guide** pill at the bottom left lists every screen and a "Who is looking" switch (vendor manager, Project Manager, read only, no vendor rights). `index.html#vendor-note` jumps straight to a screen; add `?chrome=0` to hide the guide. Sizes: 1366x768 and 1920x1080 only (D-82). No keyboard shortcut is added or changed (#420); Esc closing a dialog is the existing dialog behaviour (D-31).

Sample data is invented (firms, people, matters, `.example` addresses).

## Screens

| Guide group | Screen | What it shows |
| --- | --- | --- |
| Vendors | Vendor list | New nav page "Vendors". Record grid: Vendor (name button + website), Category chip, Services, Areas, Contacts, Matters, Updated, row menu. Search plus Category, Service, Area dropdowns (the filters really work). Flag icon = a contact is marked Do Not Hire. |
| Vendors | Detail drawer (Overview, Contacts, Matters) | 720 px read drawer from the row. Overview: category, website, services, areas, Tech AI list, note. Contacts: people at the vendor with their flag, reported date, reported by and note. Matters: the reverse view (every matter that has this vendor). |
| Vendors | Edit Vendor / New Vendor | 768 px two-column form dialog: Name, Website, Category (segmented), Services and Areas (toggle chips), Tech AI (removable chips plus Add), Note. |
| Vendors | Contact Note | 576 px dialog over the drawer: flag (No Note, Recommended, Do Not Hire), Reported Date, Reported By, Note. |
| Vendors | Add Contact | Pick a person from People (or add one inline). |
| Vendors | Delete Vendor | Confirm when unused; a "cannot delete, linked to N matters" variant when in use. |
| Matter | Summary: Team and Vendors boxes | No new tabs. Under the existing asset tiles and the full-width Details card sit two side-by-side cards, Team and Vendors, each a short read-only list capped at 4 rows (5 at 1080 px high and taller) with "Show All N" when there are more. Team rows: avatar, name, role on this matter, System User / Internal / External badge. Vendor rows: name (link to the vendor), Category badge, red flag icon when a contact is Do Not Hire. Blacklisted vendors sort first, are tinted, and the box header carries a red "1 Blacklisted" chip. Each box has an Edit button. |
| Matter | Summary, empty | Both boxes empty: one muted sentence plus a text button (Add Member, Add Vendor). |
| Matter | Team and Vendors: Show All / Edit | A 768 px dialog with the full list. Show All is read only (Close). Edit adds Title selects and Remove / Unlink icons, and an Add Member / Add Vendor button that opens the pickers below. The Vendors dialog carries the Blacklisted banner. |
| Matter | Add Vendors picker | 768 px picker (`lookup-dialog` pattern): search, Category, Service, Area filters, checkbox rows. Already linked vendors are shown and cannot be picked again. Blacklisted vendors are listed, tinted and flagged, never hidden. Selecting one raises a red warning with the reason and requires "I have read this and still want to add it" before the primary enables. Footer counts the selection. |
| Matter | Add Team Member | Person combobox over People grouped as System Users, Internal No Login, External; people already on the team are disabled. "Add New Person" is the last row and opens an inline mini form in the same dialog (no dialog inside a dialog, D-31), saves to People and selects them. Title on This Matter keeps coming from Team Titles. |
| People | People page | New nav page "People": the shared address book. Search, Internal/External switch, Type chip, Title or Role, Company, counts of matters and vendors that use the person. |
| People | New Person / Edit Person | 576 px dialog: First Name, Last Name, Internal or External, Title or Role, Email, External Company Name (External only), Comments. A system user opens with name, email and Internal locked and a link to Users. |
| Permissions | Role matrix | Administration > Users > Roles: the five new permissions by built-in role, plus the Project Manager role editor excerpt (new groups Vendors and People). |
| Permissions | No-permission states | Summary table, plus each state in place: no `Vendor.View` (menu hidden, address shows Access Denied, Vendors box gone and the Team box takes the full row), `Vendor.View` only (read-only drawer, no New Vendor, no row menu), no `Vendor.Link` (the Vendors box Edit button disabled, reason written in the box footer), no `People.Manage` (Add New Person disabled with the reason). |

## Pattern choices and why

- **Vendor detail is a drawer, edit is a dialog.** Guidelines D-31 and D-33: a right drawer is for reading and detail, create and edit open in a form dialog; the list stays visible behind the drawer. Vendors are reference data (tens to low hundreds, no tasks, no activity feed), so a full record page like Matters would be heavier than the job. The Contacts tab in the drawer is where contacts and notes are edited, which keeps the Edit Vendor dialog flat: a dialog may not open another dialog, and the Contact Note dialog opens from the drawer instead. If the owner wants a full record page later, the drawer tabs become page tabs unchanged.
- **Owner change: no Team or Vendors tab, one pair of boxes on Summary.** Both change rarely and need little room, so the matter tab strip stays exactly as today minus Team (Summary, Tasks, Projects, Assets, Productions, Notes, Activities). The boxes sit under the Details card as two `mf-card`s with the same title style (16/600), compact 36 px rows and the same tokens. Edit opens the existing dialogs; Show All opens the full list. The Details card keeps its rule of fitting its content and scrolling inside itself; at 1366x768 the two boxes take about 230 px, so Details shows about three rows of fields before it scrolls (at 1920x1080 all of it shows). That is the price of keeping both boxes visible without a tab.
- **The existing Team tab would be replaced** (matter-tabs.ts, D-44y and the matter-fields spec section 4 would be amended; `Team (n)` leaves the strip). Add/Edit Team Member (576 px dialog with "Fill from a User") is replaced by the people picker.
- **What the Summary box cannot show that the Team tab shows today:** Email and Company (only in Show All, not in the box row), the sortable, resizable record grid with 25/50/100 paging and the Columns chooser, the per-row Edit (name button) and Remove icon (now in the Edit dialog), and a count in the tab strip (now a count chip in the box header). Rows beyond the cap are one click away, not visible at once. Team is also no longer a deep link target (`?tab=team`); a link to the Summary tab replaces it.
- **People is its own main nav page**, because Project Managers maintain it as they work, not an administrator. Alternative: under Administration.
- **Services and Areas are shown as toggle chips** in the form (eight and six values). They should be admin-maintained lists: a new group "Vendors" in Administration > Lists (like Team Titles).
- **Colour and wording**: Preferred is the healthy tint with a verified icon, Blacklisted the red tint with a ban icon, never colour alone (word and icon always). Title Case for buttons, tabs, headings; sentence case for help text; dates MM/DD/YYYY; "(required)" on required labels (D-20, D-35).

## Proposed permissions (names follow `contracts/permissions.json`: `Noun.Verb`, group, description)

| Code | Group | Description | Proposed default |
| --- | --- | --- | --- |
| `Vendor.View` | Vendors | See the Vendors page, vendor details, and the Vendors box on the matter Summary tab | Director, Project Manager, Pod Lead, System Admin |
| `Vendor.Manage` | Vendors | Create, edit and delete vendors; add and edit contacts and contact notes; maintain the Services and Areas lists | Director, System Admin |
| `Vendor.Link` | Vendors | Link and unlink vendors on a matter. Needs `Vendor.View` and `Matter.View` | Director, Project Manager, System Admin |
| `People.View` | People | See the People page. Pickers work for anyone who may edit a team or a vendor contact | Director, Project Manager, Pod Lead, SME Intake Coordinator, System Admin |
| `People.Manage` | People | Create, edit and delete people, including the quick "Add New Person" in pickers | Director, Project Manager, System Admin |

Rules: the role editor selects `Vendor.View` when `Vendor.Manage` or `Vendor.Link` is ticked (same as the Dashboard tabs). `Matter.Edit` stays what gates Edit on the Team box (D-44y). Seeding the defaults would be one numbered script in `db/scripts/` plus `Permissions.cs` and `permissions.ts` in step; nothing is deployed, so no backfill.

## Open design questions for the owner (most important first)

1. **Are system users automatically in People?** Recommendation: yes. Every user appears as a System User row, read only for name and email (maintained on Users), so nobody types a colleague twice. "Internal" without a login (a partner who never opens MatterFlow) is still possible and editable. If you want People to be only typed-in contacts, the Team picker loses "pick a user".
2. **One flag per contact or a history?** The mockup keeps one current flag with date, reporter and note (what you described); the earlier text is in the audit trail. A contact flagged Do Not Hire and later cleared would otherwise need a log of notes.
3. **What happens when someone links a Blacklisted vendor?** Mockup: allowed, with a warning and an "I have read this" tick. Alternatives: hard block, or allowed only with a new permission such as `Vendor.LinkBlacklisted`. Recommendation: the tick (shown), because the firm may legitimately keep a vendor on an old matter.
4. **Category has only Preferred and Blacklisted.** A vendor that is neither vetted nor bad has to pick one. Recommendation: add a third value "Approved" (no icon) or leave Preferred as the default. Your call.
5. **Delete rule.** Mockup: a vendor linked to any matter cannot be deleted (dialog explains, suggests Blacklisted); an unused one can. Other lists in the app deactivate rather than delete when in use. Do you want Deactivate instead?
6. **Title or Role versus Title on This Matter.** A person has one free-text Title or Role (Partner); the Team box keeps its separate "Title on This Matter" from the Team Titles list (Opposing Counsel). Recommendation: keep both. Say if you want to drop one.
7. **Who may "Add New Person" from a picker?** Recommendation: `People.Manage`, given to Project Managers by default. Without it the entry is shown disabled with the reason.
8. **Hidden or disabled?** Whole pages and tabs are hidden when the person has no right (the app's rule). The Vendors box Edit button is shown disabled with the reason, because that is the one thing a Project Manager comes to the box to do and should know whom to ask. Is that exception acceptable?
9. **Visible rows.** Cap 4 at 768 px high and 5 at 1080: raise it and Details shrinks; lower it and more people hide behind Show All. OK?
10. **Should Do Not Hire flags also warn in the matter Team box** when the same person is on a team (they could be a vendor contact and a team member)? Not built.
11. **Link extras.** Today a link is only vendor + matter + who + when. A "role on this matter" or a note per link (for example "Review vendor, wave 2") would be a small add. Not built.
12. **Existing team entries.** Typed-in team members on matters would need to become People. The app is not deployed, so the mockup assumes no migration; confirm.
13. **People in the main nav or in Administration?** Mockup: main nav, right under Vendors.

## Rough build estimate (not a commitment)

Frontend about 28 to 38 agent-hours (Vendors grid, drawer, forms, picker dialog, Summary Team and Vendors boxes, People page and dialogs, person picker reused in Team and vendor contacts, nswag client, specs, e2e). Backend about 14 to 20 hours (Vendors, VendorContacts, VendorMatters, People tables via numbered scripts; a People module or part of Identity; Team table gets a PersonId; endpoints, permissions, audit events, OpenAPI sync). Risks: the Team change is the only one touching existing behaviour; module boundaries (a People and a Vendors module may only share `.Contracts`); Details card height at 1366x768.

## Files

`index.html`, `assets/app.js` (renderer and screen list), `assets/data.js` (sample data), `assets/mockup.css`, `assets/tokens.css` (copy of `docs/ux/tokens.css`), `assets/primeicons.css` and `primeicons.woff2` (the PrimeIcons font from the app's own dependency, as `docs/ux/admin-lists/mockup.html` already embeds). Screenshots are not committed here; they live on the `design-evidence` branch under `vendor-management-mockup/`.
