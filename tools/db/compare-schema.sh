#!/usr/bin/env bash
# Compare the schema of two SQL Server databases with tools/db/schema-fingerprint.sql (issue #1307).
# Usage:  MF_SQL_PASSWORD=... tools/db/compare-schema.sh <databaseA> <databaseB>
# Env:    MF_SQL_SERVER (default localhost), MF_SQL_USER (default sa), MF_SQL_PASSWORD (required),
#         MF_SQLCMD (default: sqlcmd; for the dev container use
#         "docker exec -i lpt-hub-sql /opt/mssql-tools18/bin/sqlcmd" and run the script from a place where docker is available).
# Roles:  the fingerprint maps the legacy role names mf_app/mf_migrator/mf_report_reader/mf_reports to lpt_* (see schema-fingerprint.sql), so a database
#         built from db/scripts/archive can be compared with one built from the baseline.
# Output: a unified diff of the two descriptions; exit code 0 and no output lines starting with + or - means the schemas are equal.
set -euo pipefail
a=${1:?database A}
b=${2:?database B}
here=$(cd "$(dirname "$0")" && pwd)
sqlcmd=${MF_SQLCMD:-sqlcmd}
run() {
  # -y 0 = unlimited column width (and no header line).
  $sqlcmd -S "${MF_SQL_SERVER:-localhost}" -U "${MF_SQL_USER:-sa}" -P "${MF_SQL_PASSWORD:?set MF_SQL_PASSWORD}" -C -I -b -d "$1" -y 0 < "$here/schema-fingerprint.sql" \
    | sed 's/[ ]*$//'
}
diff -u --label "$a" --label "$b" <(run "$a") <(run "$b") && echo "Schemas are equal: $a and $b."
