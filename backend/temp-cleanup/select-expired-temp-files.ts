// Purpose: pure TTL-selection of orphan temp_ objects, isolated so the delete decision is unit-testable without a storage adapter.
// Usage: called by TempCleanupService.sweep() after it lists file/temp entries through the FileStorage port.
// Rationale: keeps the "which objects are expired" rule out of the I/O path so it can be asserted directly.

import { StorageTempEntry } from 'backend/storage/file-storage.interface';

/**
 * Returns the keys of `temp_`-prefixed objects whose age exceeds the TTL.
 *
 * Defensive by design: it re-checks the `temp_` prefix here, so a non-`temp_`
 * entry (a `granted_` object, a stray artifact) can never be selected for deletion
 * even if the caller passes an unfiltered list — the prefix guard is the last line
 * between this sweep and an irreversible unlink of a claimed file.
 */
export function selectExpiredTempFiles(
  entries: StorageTempEntry[],
  nowMs: number,
  ttlMs: number,
): string[] {
  return entries
    .filter((e) => e.key.startsWith('temp_') && nowMs - e.mtimeMs > ttlMs)
    .map((e) => e.key);
}
