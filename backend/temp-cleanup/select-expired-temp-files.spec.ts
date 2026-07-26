import {
  selectExpiredTempFiles,
  TempFileStat,
} from './select-expired-temp-files';

describe('selectExpiredTempFiles', () => {
  const now = 1_000_000_000_000; // fixed epoch ms for deterministic ages
  const ttlMs = 24 * 60 * 60 * 1000; // 24h

  const at = (hoursAgo: number): number => now - hoursAgo * 60 * 60 * 1000;

  it('selects temp_ files strictly older than the TTL', () => {
    const files: TempFileStat[] = [
      { name: 'temp_old.mp4', mtimeMs: at(25) },
      { name: 'temp_fresh.mp4', mtimeMs: at(1) },
    ];
    expect(selectExpiredTempFiles(files, now, ttlMs)).toEqual(['temp_old.mp4']);
  });

  it('never selects a non-temp_ entry, even when it is old (defensive prefix guard)', () => {
    const files: TempFileStat[] = [
      { name: 'granted_old.mp4', mtimeMs: at(100) },
      { name: 'random.txt', mtimeMs: at(100) },
    ];
    expect(selectExpiredTempFiles(files, now, ttlMs)).toEqual([]);
  });

  it('excludes a file exactly at the TTL boundary (strictly-greater comparison)', () => {
    const files: TempFileStat[] = [{ name: 'temp_edge.mp4', mtimeMs: at(24) }];
    expect(selectExpiredTempFiles(files, now, ttlMs)).toEqual([]);
  });

  it('returns an empty array for an empty input', () => {
    expect(selectExpiredTempFiles([], now, ttlMs)).toEqual([]);
  });
});
