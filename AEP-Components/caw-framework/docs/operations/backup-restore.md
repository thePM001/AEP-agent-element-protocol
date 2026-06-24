# Backup and Restore

This guide covers backup and restore procedures for aep-caw deployments.

## What to Backup

### Critical (Required)

These files are essential for system operation and must be backed up:

- **Audit database**: `<audit.storage.sqlite_path>` (default: `/var/lib/aep-caw/events.db`)
  - Contains all audit events and integrity chain state
  - Loss means complete audit history is gone

- **Configuration**: `/etc/aep-caw/config.yaml`
  - Main configuration file
  - Contains all runtime settings

- **Policies**: `<policies.dir>` (default: `/etc/aep-caw/policies/`)
  - File policies, network policies, approval rules
  - Loss means reverting to default (permissive) behavior

### Important (Recommended)

These files should be backed up but require special handling:

- **Encryption keys**: `<audit.encryption.key_file>` and `<audit.integrity.key_file>`
  - **WARNING**: Store separately from data backups
  - Use secure key management (HashiCorp Vault, AWS Secrets Manager, etc.)
  - Without these, encrypted audit logs cannot be decrypted
  - Without integrity key, audit chain cannot be verified

- **Audit log rotation set and sidecar**: `audit.jsonl`, `audit.jsonl.1`, `audit.jsonl.2`, ..., and `audit.jsonl.chain`
  - The `.chain` sidecar stores the last durable integrity state
  - Back up the sidecar together with the log files to preserve chain continuity across restart
  - If the sidecar is missing, aep-caw starts a fresh chain only when the last retained v2 entry still verifies
  - If the sidecar and log disagree, startup fails until the files are reconciled or the chain is reset

- **MCP tool pins**: `~/.aep-caw/mcp-pins.json`
  - Pinned tool versions for reproducibility
  - Loss means tools may update unexpectedly

### Optional

These files are typically not backed up:

- **Session data**: `<sessions.base_dir>`
  - Ephemeral by design
  - Sessions are short-lived and recreated as needed

- **Application logs**: `/var/log/aep-caw/`
  - Useful for debugging but not critical
  - Consider log aggregation instead of backup

## Backup Procedures

### Manual Backup

For systems without the CLI backup command or for custom backup workflows:

```bash
# Stop aep-caw (optional, for consistency)
systemctl stop aep-caw

# Create backup directory with date
BACKUP_DIR="/backup/aep-caw/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# Backup audit database (most critical)
cp /var/lib/aep-caw/events.db "$BACKUP_DIR/"

# Backup audit log rotation set and sidecar
cp /var/log/aep-caw/audit.jsonl* "$BACKUP_DIR/" 2>/dev/null || true

# Backup configuration
cp /etc/aep-caw/config.yaml "$BACKUP_DIR/"

# Backup policies directory
cp -r /etc/aep-caw/policies/ "$BACKUP_DIR/"

# Create compressed archive
tar -czf "$BACKUP_DIR.tar.gz" -C /backup/aep-caw "$(date +%Y%m%d)"

# Clean up uncompressed directory (optional)
rm -rf "$BACKUP_DIR"

# Restart aep-caw
systemctl start aep-caw

# Verify backup integrity
tar -tzf "$BACKUP_DIR.tar.gz"
```

### Using aep-caw CLI (Recommended)

The CLI provides automated backup with built-in verification:

```bash
# Full backup with default filename
aep-caw backup --output /backup/aep-caw-$(date +%Y%m%d).tar.gz

# Backup with verification
aep-caw backup --output /backup/aep-caw.tar.gz --verify

# Backup with custom config path
aep-caw backup --output /backup/aep-caw.tar.gz --config /custom/path/config.yaml
```

**Note**: CLI backup commands are placeholders pending Task 8 implementation.

### Backup to Remote Storage

For production environments, backups should be stored remotely:

```bash
# Backup and upload to S3
aep-caw backup --output /tmp/backup.tar.gz --verify
aws s3 cp /tmp/backup.tar.gz s3://my-bucket/aep-caw-backups/$(date +%Y%m%d).tar.gz
rm /tmp/backup.tar.gz

# Backup and upload to GCS
aep-caw backup --output /tmp/backup.tar.gz --verify
gsutil cp /tmp/backup.tar.gz gs://my-bucket/aep-caw-backups/$(date +%Y%m%d).tar.gz
rm /tmp/backup.tar.gz
```

## Restore Procedures

### Manual Restore

```bash
# Stop aep-caw
systemctl stop aep-caw

# Create restore staging directory
mkdir -p /tmp/restore

# Extract backup
tar -xzf /backup/aep-caw-20260106.tar.gz -C /tmp/restore/

# Verify extracted contents
ls -la /tmp/restore/

# Restore audit database
cp /tmp/restore/events.db /var/lib/aep-caw/

# Restore configuration
cp /tmp/restore/config.yaml /etc/aep-caw/

# Restore policies
cp -r /tmp/restore/policies/ /etc/aep-caw/

# Restore audit log rotation set and sidecar
cp /tmp/restore/audit.jsonl* /var/log/aep-caw/ 2>/dev/null || true

# Fix permissions
chown -R aep-caw:aep-caw /var/lib/aep-caw/
chown -R root:aep-caw /etc/aep-caw/
chmod 640 /etc/aep-caw/config.yaml

# Clean up staging directory
rm -rf /tmp/restore

# Start aep-caw
systemctl start aep-caw

# Verify audit chain integrity
aep-caw audit verify --config /etc/aep-caw/config.yaml /var/log/aep-caw/audit.jsonl
```

### Using aep-caw CLI

```bash
# Restore with verification
aep-caw restore --input /backup/aep-caw.tar.gz --verify

# Dry-run (show what would be restored without making changes)
aep-caw restore --input /backup/aep-caw.tar.gz --dry-run
```

### Partial Restore

To restore only specific components:

```bash
# Extract to staging
tar -xzf /backup/aep-caw.tar.gz -C /tmp/restore/

# Restore only policies
cp -r /tmp/restore/policies/ /etc/aep-caw/

# Restore only audit database
cp /tmp/restore/events.db /var/lib/aep-caw/

# Reload aep-caw to pick up changes
systemctl reload aep-caw
```

## Backup Schedule Recommendations

| Environment | Frequency | Retention | Off-site Copy |
|-------------|-----------|-----------|---------------|
| Development | Weekly | 2 weeks | Optional |
| Staging | Daily | 1 month | Weekly |
| Production | Hourly | 90 days | Daily |

### Cron Examples

```bash
# Development: Weekly backup on Sundays at 2 AM
0 2 * * 0 /usr/local/bin/aep-caw backup --output /backup/aep-caw-$(date +\%Y\%m\%d).tar.gz

# Staging: Daily backup at 3 AM
0 3 * * * /usr/local/bin/aep-caw backup --output /backup/aep-caw-$(date +\%Y\%m\%d).tar.gz

# Production: Hourly backup
0 * * * * /usr/local/bin/aep-caw backup --output /backup/aep-caw-$(date +\%Y\%m\%d-\%H).tar.gz
```

### Retention Script

```bash
#!/bin/bash
# cleanup-backups.sh - Remove backups older than retention period

BACKUP_DIR="/backup"
RETENTION_DAYS=90

find "$BACKUP_DIR" -name "aep-caw-*.tar.gz" -mtime +$RETENTION_DAYS -delete
```

## Encryption Key Backup

**Critical**: Encryption keys must be backed up separately and securely. Never store keys alongside data backups.

### Why Separate Key Backup?

- If an attacker obtains your data backup, they cannot decrypt it without keys
- Keys change less frequently than data, enabling different backup strategies
- Key loss is catastrophic - encrypted data becomes permanently inaccessible

### Recommended: External Secret Manager

```bash
# HashiCorp Vault
vault kv put secret/aep-caw/keys \
  integrity_key=@/etc/aep-caw/audit-integrity.key \
  encryption_key=@/etc/aep-caw/audit.key

# To retrieve during restore
vault kv get -field=integrity_key secret/aep-caw/keys > /etc/aep-caw/audit-integrity.key
vault kv get -field=encryption_key secret/aep-caw/keys > /etc/aep-caw/audit.key
chmod 600 /etc/aep-caw/audit-integrity.key /etc/aep-caw/audit.key
```

```bash
# AWS Secrets Manager
aws secretsmanager create-secret \
  --name aep-caw/integrity-key \
  --secret-binary fileb:///etc/aep-caw/audit-integrity.key

aws secretsmanager create-secret \
  --name aep-caw/encryption-key \
  --secret-binary fileb:///etc/aep-caw/audit.key

# To retrieve during restore
aws secretsmanager get-secret-value --secret-id aep-caw/integrity-key \
  --query SecretBinary --output text | base64 -d > /etc/aep-caw/audit-integrity.key
```

### Alternative: Encrypted Key Backup

If using external secret managers is not possible:

```bash
# Encrypt keys with GPG before backup
gpg --symmetric --cipher-algo AES256 -o /secure-backup/audit-keys.gpg \
  <(tar -c /etc/aep-caw/audit-integrity.key /etc/aep-caw/audit.key)

# Store GPG passphrase in a separate, secure location
# Consider using hardware security modules (HSM) for high-security environments
```

### Key Rotation Backup

When rotating keys:

1. Backup old keys before rotation
2. Generate and deploy new keys
3. Re-encrypt existing data if required
4. Update key backups in secret manager
5. Verify both old and new keys are recoverable

## Troubleshooting

### Backup Fails with Permission Denied

```bash
# Ensure backup user has read access to aep-caw files
sudo chmod 640 /var/lib/aep-caw/events.db
sudo chown root:backup /var/lib/aep-caw/events.db
```

### Restore Fails with Integrity Verification Error

1. Ensure you are using the correct integrity key
2. Check if the backup was created with integrity enabled
3. Verify the backup file is not corrupted (check tar contents)

```bash
# Test backup file integrity
gzip -t /backup/aep-caw.tar.gz && echo "Backup file OK"

# List contents without extracting
tar -tzf /backup/aep-caw.tar.gz
```

### Audit Chain Broken After Restore

If the audit chain fails verification after restore:

1. This may indicate tampering or a partial restore
2. Compare the restored database with other backup copies
3. Make sure `audit.jsonl.chain` was restored together with the log rotation set
4. Before resetting, copy the full recovered audit set somewhere safe for review:

```bash
recovery_dir=/var/log/aep-caw/recovery-$(date +%Y%m%d%H%M%S)
mkdir -p "$recovery_dir"
cp /var/log/aep-caw/audit.jsonl* "$recovery_dir"/ 2>/dev/null || true
```

5. If the sidecar and log cannot be reconciled, reset explicitly:

```bash
aep-caw audit chain reset --config /etc/aep-caw/config.yaml \
  --reason "restored audit log from backup after host failure" \
  --reason-code post_tamper_recovery
```
6. If using replication, compare with replicas
7. Document the incident and investigate the cause
