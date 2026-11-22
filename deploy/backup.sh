#!/bin/sh
# Nightly copy of the live database (safe while the app runs). Keeps the last 14 days.
set -eu
DB="${DB:-/var/lib/ship-or-skip/ship-or-skip.db}"
DIR="${BACKUP_DIR:-/var/backups/ship-or-skip}"

mkdir -p "$DIR"
OUT="$DIR/ship-or-skip-$(date +%F).db"
rm -f "$OUT"
sqlite3 "$DB" "VACUUM INTO '$OUT'"  # consistent snapshot as one self-contained file
find "$DIR" -name 'ship-or-skip-*.db' -mtime +14 -delete
