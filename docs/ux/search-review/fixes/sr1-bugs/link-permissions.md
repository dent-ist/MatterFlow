# Hit links and permissions (#461, WP-SR1)

Question of the review (section 8, "not verified"): does a search hit ever link to a page the person cannot open? Answer, verified with
seeded users by `frontend/e2e/tests/sr1-link-permissions.spec.ts` (one test per row) and by `GlobalSearchApiTests`.

## Rules (as built)

1. **A group is returned only for a type the person may view** (`SearchService`: `permissions.Has(<Type>.View)`); asking for a type they may not
   view leaves it out (it is also absent from `searchedTypes`). A person with none of the five View permissions is refused by the route
   guard (403 page) and by the API (403).
2. **The hit's own link** (`path`: `/clients/{id}`, `/matters/{id}`, `/projects/{id}`, `/tasks/{id}`, `/assets/{id}`) is always a page that the
   hit's own View permission opens, because rule 1 returned the hit.
3. **Derived values are text, never links.** The Matter number and name on a project, task or asset row, the client name on a matter row and
   the requestor on a task row are plain text on the results page, the cards and the panel (`mf-matter-ref` has no `link`). Nothing on the
   results page links to a type other than the hit's own.
4. **The API does not hand the Matter to people who may not view Matters** (`SearchService.ShowMatter`, SEC2-11): `matterRef` and `matterName`
   are null on project, task and asset hits for a caller without `Matter.View`. The Sensitive marker (`isSensitive`) stays, because it is
   a property of the record itself (addendum O: sensitive Matters are badged, never hidden); it reveals no name. Task.View sees every Task and
   its Matter's text on the Task page itself (addendum E), so nothing new is exposed.
5. No new permission and no new flag were needed: the additive boolean the issue allowed (`MatterViewable`) is **not added**, because the
   Matter text is already absent for these people and the rows carry no Matter link.

## Table (user x type x what the box and the results page offer)

| Person (permissions) | Types searched (`searchedTypes`) | Hit link targets offered | Matter text on rows | Result of opening every hit |
| --- | --- | --- | --- | --- |
| System Admin (all) | client, matter, project, task, asset | `/clients/`, `/matters/`, `/projects/`, `/tasks/`, `/assets/` | shown, text only | all open |
| `Task.View` only | task | `/tasks/{id}` | none (API leaves it out) | opens, no 403 from the page or its API calls |
| `Asset.View` only | asset | `/assets/{id}` | none | opens |
| `Project.View` only | project | `/projects/{id}` | none | opens |
| `Client.View` only | client | `/clients/{id}` | n/a (clients have no matter) | opens |
| `Matter.View` only | matter | `/matters/{id}` | n/a | opens |
| `Client.View` + `Matter.View` | client, matter | `/clients/{id}`, `/matters/{id}` | shown on matter rows (client name as text) | all open |
| No View permission (`Pod.View` only) | none (API 403) | none: `/search` and `/search/advanced` show the 403 page | n/a | the 403 page, by the route guard |

The e2e opens every link of the results page and every option of the header panel for each row and fails on a 403 page, an inline "no access"
state, or any `403` response from `/api/` on the way.

## Findings

- **No dead link and no 403 page.** Every hit and every panel option of every row above opened its page; no `/api/` call came back 403 on the
  way. No code change to the links was needed; the fix of this issue is the proof (tests and this table) and the rule that the Matter is never a
  link in a hit row (a person without `Matter.View` has no `a[href^="/matters/"]` on the results page).
- **Opening a hit can show an in-place note, by design, never a 403 page.** The destination pages decide on the client what a person may see and
  say so in place: a task opened by a person without `Asset.View` says "You don't have permission to view assets, so linked assets aren't shown
  here." in its Assets tab; a project opened by a person without `Task.View` says "You don't have permission to view tasks." in its Tasks tab (its
  default tab). These are the shell's in-place notes (not the 403 page, no refused request). The e2e allows exactly these two notes. The
  project page opening on a tab the person cannot use is a Projects page question and is noted here for that owner; it is not a search defect.
- An asset hit's path `/assets/{id}` opens the Assets list with that asset selected (`/assets?selected={id}`); the e2e accepts both forms.
