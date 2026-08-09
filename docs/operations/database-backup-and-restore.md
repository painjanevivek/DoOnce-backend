# Database backup and restore

## Backup policy

Use encrypted PostgreSQL physical backups with point-in-time recovery for normal operations and a daily logical `pg_dump --format=custom` for portable verification. Encrypt backup objects with the managed key service, restrict restore rights to operators, retain according to the approved policy, and test deletion. Queue storage and tenant storage may use different roles but must be captured at a recovery point that keeps run state understandable.

## Monthly restore drill

1. Create a new isolated network and empty database; never restore over production.
2. Record backup ID, source timestamp, expected migration count, and expected recovery-point objective.
3. Restore with `pg_restore --exit-on-error` or the managed provider recovery operation.
4. Compare `schema_migrations` IDs/checksums, tenant/workflow/run aggregate counts, and foreign-key validity.
5. Start one API and one worker with temporary credentials and workflow changes disabled.
6. Check `/ready`; load workflow summaries for a synthetic tenant; run a controlled fixture; inspect queue health.
7. Destroy temporary credentials and the isolated environment after evidence is retained.

The CI `recovery` job performs a schema-level dump/restore on every change. It is a fast regression gate, not a substitute for restoring production-sized encrypted backups and measuring recovery time.
