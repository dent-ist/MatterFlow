# Archived schema scripts (01 to 66)

These are the 63 incremental scripts that built the schema before it was squashed into `../00-baseline.sql` (issue #1307, before the first
deployment). They are kept unchanged (moved with `git mv`, so `git log --follow` still shows their history) for reference only.

- The application does **not** run them: the embedded-resource glob and the `Migrations:ScriptsFolder` reader take `db/scripts/*.sql` without
  subfolders. Do not add scripts here.
- `SchemaTests/BaselineEquivalenceTests` still applies them with the real runner to prove that the baseline builds the identical database.
- Code comments, docs and the wiki that say "script 43" or "`10-assets.sql`" refer to these files. Their content now lives in the baseline.
- The numbers 1 to 66 are never reused; new scripts start at 67.
