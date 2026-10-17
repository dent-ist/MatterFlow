# My profile: availability and work hours (issue #70, epic #68)

Screenshots of the new screens at 1366x768 and 375 px wide, taken by the e2e capture
(`E2E_SCREENSHOTS=docs/ux/profile-availability frontend/e2e/run-local.sh -g "profile screenshots"`, see
`frontend/e2e/tests/profile-availability.spec.ts`). Files are `<size>-<nn>-<what>.png`.

| # | Screen | What to look at |
|---|---|---|
| 01 | `/profile`, Available | Page header with its own icon, current-status preview, status radios, weekly work-hours grid, time zone (browser zone preselected) |
| 02 | `/profile`, Out of office | From and Until (shared date input), note with 200-character counter, the plain-language summary sentence |
| 03 | `/profile`, validation | Error summary (focused, links to the field), inline error under the day, invalid time fields |
| 04 | Header menu while out of office | "Out of office until ..." label next to the name, menu: My profile, I'm back, Keyboard shortcuts, success toast |
| 05 | Header, "Set out of office..." | Small dialog: until date, note, summary sentence |
| 06 | Administration > Users | Availability chip per user (Available / Off hours / Out of office until ...) and the Availability filter beside Status |
| 07 | Users filtered to Out of office | The filter in the address (`availability=OUT_OF_OFFICE`) |
| 08 | Users, "Edit availability" | The same form in a dialog for a user (needs User.Manage); copy names the person |
| 09 | Create task, Assignee typeahead | "Out of office until ..." flag (icon and text); the person can still be chosen |

## Behaviour summary

- **Route** `/profile` (lazy, needs Task.View, the policy of `GET/PUT /api/v1/me/availability`); document title "My profile - MatterFlow".
- **Header**: the user area is a menu button (`aria-haspopup="menu"`; Enter, Space or Arrow Down opens, arrows/Home/End move, Esc closes
  and returns focus, Tab closes). Items: My profile, Set out of office... or I'm back (while out of office), Keyboard shortcuts. There is no
  version endpoint, so no "About" item. On a phone the button shows only the person icon (the name stays for screen readers).
- **Status**: Available or Out of office. Out of office has optional From and Until dates, an optional note (200 characters, counter)
  and a summary such as "You will show as out of office from Oct 16 until Oct 20 and as available again on Oct 21."
- **Work hours**: Monday to Sunday, working-day checkbox with start and end time, "Copy Monday to all weekdays", reset to the default
  Mon-Fri 09:00-17:00. An unchanged default week is saved as `workHours: null`; no working days is `[]`.
- **Time zone**: type-ahead list of `Intl.supportedValuesOf('timeZone')`; the browser zone is preselected for a person who never chose one.
- **Validation** is live (inline per field) with an error summary after Save; server codes (OOO_RANGE_INVALID, NOTE_TOO_LONG,
  TIMEZONE_UNKNOWN, WORK_HOURS_INVALID) map to the same places. A 409 reloads the latest values and says the edits were not saved.
- **Preview** "Your current status" shows the API's evaluation when nothing is edited and a client-side preview of the draft otherwise.
- **Unsaved changes**: the usual "Leave without saving?" guard (route and dialog).
- **Users admin**: chip per user, Availability filter (All / Available / Out of office / Off hours; `GET /users?availability=` evaluates the
  state now, in code), "Edit availability" for User.Manage. Below about 1100 px the list scrolls sideways and says so (review round 5).
- **Assignee menus and pickers** (Create task, task details, inline assignee menu, USER_REF picker) flag "Out of office until ..." with an
  icon; the person stays selectable.
