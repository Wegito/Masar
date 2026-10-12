#!/usr/bin/env bash
# Legt Rollen und Datenbanken für Masar an (ADR 0004):
#   masar_migrate  besitzt die Datenbanken, führt Migrationen aus (DDL); kein CREATEDB
#   masar_app      Laufzeit der API, nur Lesen und Schreiben von Daten (DML)
# Datenbanken: masar (Entwicklung), masar_test (Tests), masar_shadow (Prisma-Schattendatenbank).
# Läuft beim ersten Start des Containers (docker-entrypoint-initdb.d) und in CI gegen den
# Service-Container (dann mit PGHOST, PGUSER, PGPASSWORD aus der Umgebung).
set -euo pipefail

: "${MASAR_MIGRATE_PASSWORD:?MASAR_MIGRATE_PASSWORD fehlt}"
: "${MASAR_APP_PASSWORD:?MASAR_APP_PASSWORD fehlt}"
ADMIN_USER="${POSTGRES_USER:-${PGUSER:-postgres}}"

psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname postgres \
  -v migrate_password="$MASAR_MIGRATE_PASSWORD" \
  -v app_password="$MASAR_APP_PASSWORD" <<'SQL'
CREATE ROLE masar_migrate LOGIN PASSWORD :'migrate_password';
CREATE ROLE masar_app LOGIN PASSWORD :'app_password';
CREATE DATABASE masar OWNER masar_migrate;
CREATE DATABASE masar_test OWNER masar_migrate;
-- Feste Schattendatenbank für "prisma migrate dev" und den Abgleich Migrationen gegen Schema.
-- Dadurch braucht masar_migrate kein CREATEDB.
CREATE DATABASE masar_shadow OWNER masar_migrate;
REVOKE ALL ON DATABASE masar_shadow FROM PUBLIC;
SQL

for db in masar masar_test; do
  psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname "$db" <<'SQL'
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO masar_app', current_database());
END
$$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO masar_app;
-- Alles, was die Migrationsrolle künftig anlegt, darf die Anwendung lesen und schreiben,
-- aber nicht verändern oder löschen (kein DDL).
ALTER DEFAULT PRIVILEGES FOR ROLE masar_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO masar_app;
ALTER DEFAULT PRIVILEGES FOR ROLE masar_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO masar_app;
SQL
done
