// Purpose: pure TTL-selection of orphan temp_ files, isolated so the delete decision is unit-testable without fs/DB.
// Usage: called by TempCleanupService.sweep() after it stats the file/temp entries.
// Rationale: keeps the "which files are expired" rule out of the I/O path so it can be asserted directly.

export interface TempFileStat {
  name: string;
  /** Last-modified time in epoch milliseconds (from fs.Stats.mtimeMs). */
  mtimeMs: number;
}

/**
 * Returns the names of `temp_`-prefixed files whose age exceeds the TTL.
 *
 * Defensive by design: it re-checks the `temp_` prefix here, so a non-`temp_`
 * entry (a `granted_` file, a stray artifact) can never be selected for deletion
 * even if the caller passes an unfiltered list — the prefix guard is the last line
 * between this sweep and an irreversible unlink of a claimed file.
 */
export function selectExpiredTempFiles(
  files: TempFileStat[],
  nowMs: number,
  ttlMs: number,
): string[] {
  return files
    .filter((f) => f.name.startsWith('temp_') && nowMs - f.mtimeMs > ttlMs)
    .map((f) => f.name);
}
