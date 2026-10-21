# Profile of the totals in GET /search (#462, WP-SR2)

Decision: **totals are computed, exact up to a cap of 1,000 per type (`SearchService.TotalCap`), with no index and no SQL script (script 28 stays
free).** Measured on the volumes of architecture 15 plus the review's: 1,000 Clients and Matters, **20,000 Tasks, 300,000 Assets** (seeded by
set-based SQL in `SearchPerformanceTests`), one SQL Server 2022 container shared with other jobs of a busy 2-slot build machine (so every number
is noisy; the table gives the best of three requests per query, in milliseconds, the way the existing test does).

## What was tried

| Variant | What it does |
| --- | --- |
| Before | items only (`limit + 1` rows, no count) |
| A | items, then a `COUNT` of the same predicate wrapped in `TOP (1001)` for every type, always |
| B | as A, but the count is skipped when the probe row (`limit + 1`) did not come back: the rows fetched ARE the matches and `Total` is their number |
| C (built) | as B, with a plain `COUNT` (no `TOP`) of the same predicate, cut at the cap when it is reported |

A made a query with no match pay a second full scan (B removes that). B showed that a `TOP`-bounded count is slower than the plain one on 300,000
Assets (the row goal changes the plan): the same query counted by the advanced search took 450 ms against 720 to 960 ms for the bounded count.
So the cap is applied to the number, not to the query (C).

## Numbers (best of 3 requests, ms; `Typical_global_searches_stay_fast_at_300k_assets`, default limit 5, all five types)

| Query | Before | A | B | C (built) | Totals returned (C) |
| --- | --- | --- | --- | --- | --- |
| `00343-00012` | 279 | 731 | 841 | 442 | client 1, matter 1, project 1, task 1000+, asset 299 |
| `343` | 328 | 785 | 793 | 387 | client 2, matter 2, task 40, asset 897 |
| `client 1500` | 313 | 841 | 216 | 186 | client 1, matter 1 |
| `1500` | 237 | 869 | 894 | 434 | client 1, matter 1, task 12, asset 160 |
| `TSK-77` | 252 | 706 | 281 | 228 | task 111 |
| `seeded task 4` | 238 | 723 | 225 | 213 | task 1000+ |
| `custodian laptop 29999` | 246 | 864 | 766 | 407 | asset 11 |
| `evidence.example.com/ws/123` | 255 | 506 | 565 | 422 | asset 1000+ |
| `requestor 7` | 255 | 674 | 257 | 221 | task 400 |
| `zzzzqq` (no match) | 194 | 692 | 216 | 180 | none |

The runs happened at different loads of the shared machine (A was the busiest: its whole test took 42 s against 16 to 20 s for the others), so
compare the shape, not single cells.

Reading: a selective query (a number, a task number, no match) is as fast as before. A broad query on the 300,000 Assets (a few hundred to a
thousand matches) pays one more scan: about 400 to 450 ms instead of about 250 to 330 ms. Nothing exceeds the 1,500 ms bound of the existing test
(the CI container shares disk and CPU). The 300 ms p95 of architecture 14 is not met by the broad Asset queries; it was close to the line before the
change on this machine too. The items and `HasMore` do not depend on the count, so the count can be lowered or dropped later without touching the panel (fallbacks below).

## Why no index or script

The slow part is a `LIKE '%text%'` scan over `Asset.DisplayName`, `ExternalReference` and the type name; no B-tree index serves a substring, and
a full-text index is outside the architecture ("never a search engine", architecture 14). A narrower scan would need a new structure (a
trigram or normalised column), which is a design decision of its own, so **no script 28 is taken**. If the measured cost becomes a problem on a
large production database, the options in order are: lower `TotalCap`, return `Total` only for the types of the open tab, or open an issue for a
search structure with script 28.

## Contract

`SearchGroup.Total` (int), `SearchGroup.TotalCapped` (bool; true when the real count is above the cap, `Total` is then the cap), `SearchResponse.SearchedTypes`
(the types asked for that the caller may view, in group order). `limit` caps the items only; `HasMore` is unchanged. A type without View
permission has no group and is not in `SearchedTypes`. Integration tests: `GlobalSearchApiTests` (totals equal the advanced total for each type
and query, both number shapes, `limit` caps items only, permitted types).
