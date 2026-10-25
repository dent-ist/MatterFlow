# sh9-docs: documentation issue #630

Docs only, no screen changed, so there are no screenshots here. What changed:

- `docs/ux/ux-spec.md`: 2.2 (landing rule, rail groups, titles, Create task), 5.1 (App shell: header, icon rail, skip links, route announcement, banner slot, toasts), 5.6 (offline, sign-in, failed list load, 403 keeps the address), S22 (system pages, session and connection, rewritten to the code), 8.5 (toasts) and seven new cross-cutting UAT rows (UAT-X-15 to UAT-X-21: oversight landing, offline banner, 403 keeps the address, one toast, title rule and route announcement, icon rail, one Create task button).
- `docs/requirements/decisions-addendum.md`: new section **AE** (every Decision (PM) of the epic with its issue numbers, including the reversal of decision T #158 for the toast position).
- `docs/qa/e2e.md`: the catalogue rows of `sh-doc-titles`, `sh-rail-icons`, `sh-route-announce`, `sh-create-task` and `sh-final-contract`.
- `docs/ux/shell-review/README.md`: a status banner pointing to the fixes; `delivery-plan.md`: the Status lines.

Where the code differs from an issue, the docs follow the code and say so: only the "New workflow" create page got the section prefix in its title (AE item 6); a Data Technician with no pod and no assigned task lands on the Dashboard (AE item 12); the Windows-authentication sign-in problem page is not built (AE item 7).
