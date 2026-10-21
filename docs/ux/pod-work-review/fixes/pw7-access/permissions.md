# Pod Work: permission matrix (#574)

Written by `frontend/e2e/tests/pw7-permissions.spec.ts`, which derives each person's expectations from their real permission list (`GET /me`) and checks the page against it. The rule (decision AD.8): the rail item and the page need `Pod.View` and `Task.View`; every other control is **hidden, never disabled**, for a person who may not use it. On every allowed path the spec also asserts no response was 403, no toast appeared and nothing in the header, strip, tabs, pod list or workload table looks disabled.

| Person (permissions that matter) | Rail item | Page at `/pods/work` | Strip, tabs, By member | "Assign to me" and the assignee menu (`Task.Assign`) | "Add members" on an empty pod (`Pod.ManageMembers`) | "Create a pod" when the system has no pods (`Pod.Manage`) | With no pod chosen |
|---|---|---|---|---|---|---|---|
| Pod Lead (`Pod.View`, `Task.View`, `Task.Assign`, `Pod.Manage`, `Pod.ManageMembers`) | shown | page | all (the strip only filters) | shown | shown | shown | opens its primary pod |
| Read-only (`Pod.View`, `Task.View`) | shown | page | all | hidden | hidden | hidden ("Ask an administrator to create one.") | list of pods |
| `Pod.Manage` only (plus `Pod.View`, `Task.View`) | shown | page | all | hidden | hidden | shown | list of pods |
| `Pod.ManageMembers` and `Task.Assign` (plus `Pod.View`, `Task.View`) | shown | page | all | shown | shown | hidden | list of pods |
| Director, no pod (all of the five) | shown | page | all | shown | shown | shown | list of pods |
| Read-Only Observer, no pod (`Pod.View`, `Task.View`) | shown | page | all | hidden | hidden | hidden | list of pods |
| `Pod.View` without `Task.View` | hidden | 403 page, no Pod Work request, no toast | none | none | none | none | none |
| `Task.View` without `Pod.View` | hidden | 403 page, no Pod Work request, no toast | none | none | none | none | none |

States the spec visits for each allowed person: the three tabs of a pod with work, an empty pod's By member tab, the list of pods (people with no pod and no remembered pod), and the no-pods message (the pod list answered empty by a route stub). axe is run on the 403 pages, the list of pods and the no-pods state for every allowed person; the main states at four sizes are audited in `pw7-keyboard.spec.ts`.
