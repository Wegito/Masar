-- Handgeschrieben (ADR 0004, ADR 0005).
-- btree_gist erlaubt EXCLUDE-Constraints, die Gleichheit (Fahrt, Sitz) mit überlappenden Bereichen
-- (Teilstrecken) kombinieren. Die Extension gilt seit PostgreSQL 13 als "trusted" und lässt sich
-- deshalb vom Besitzer der Datenbank (Rolle masar_migrate) ohne Superuser-Rechte anlegen.
-- Prisma kennt die Extension nicht; ein Integrationstest prüft, dass sie existiert.
CREATE EXTENSION IF NOT EXISTS btree_gist;
