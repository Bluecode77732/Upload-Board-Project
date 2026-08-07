import { selectExpiredTempFiles } from './select-expired-temp-files';
import { StorageTempEntry } from 'backend/storage/file-storage.interface';

describe('selectExpiredTempFiles', () => {
  const now = 1_000_000_000_000; // fixed epoch ms for deterministic ages
  const ttlMs = 24 * 60 * 60 * 1000; // 24h

  const at = (hoursAgo: number): number => now - hoursAgo * 60 * 60 * 1000;

  it('selects temp_ entries strictly older than the TTL', () => {
    const entries: StorageTempEntry[] = [
      { key: 'temp_old.mp4', mtimeMs: at(25) },
      { key: 'temp_fresh.mp4', mtimeMs: at(1) },
    ];
    expect(selectExpiredTempFiles(entries, now, ttlMs)).toEqual([
      'temp_old.mp4',
    ]);
  });

  it('never selects a non-temp_ entry, even when it is old (defensive prefix guard)', () => {
    const entries: StorageTempEntry[] = [
      { key: 'granted_old.mp4', mtimeMs: at(100) },
      { key: 'random.txt', mtimeMs: at(100) },
    ];
    expect(selectExpiredTempFiles(entries, now, ttlMs)).toEqual([]);
  });

  it('excludes an entry exactly at the TTL boundary (strictly-greater comparison)', () => {
    const entries: StorageTempEntry[] = [
      { key: 'temp_edge.mp4', mtimeMs: at(24) },
    ];
    expect(selectExpiredTempFiles(entries, now, ttlMs)).toEqual([]);
  });

  it('returns an empty array for an empty input', () => {
    expect(selectExpiredTempFiles([], now, ttlMs)).toEqual([]);
  });
});
