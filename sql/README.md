# SQL file policy

`production_schema.sql` and `hostinger_production_schema.sql` are the only fresh
installation snapshots. All subsequent database changes belong in `migrations/`
at the repository root and are applied with `npm run db:migrate`.

The remaining SQL files are historical references. Do not concatenate or replay
them on a current database.
