import { selectOrphanedGrantedFiles } from './select-orphaned-granted-files';

const now = Date.now();
const minutesAgo = (m: number): number => now - m * 60 * 1000;

describe('selectOrphanedGrantedFiles', () => {
  it('selects a granted key with no matching DB row past the age floor', () => {
    const result = selectOrphanedGrantedFiles(
      [{ key: 'file/upload/granted_orphan.mp4', mtimeMs: minutesAgo(120) }],
      new Set<string>(),
      now,
      60 * 60 * 1000,
    );

    expect(result).toEqual(['file/upload/granted_orphan.mp4']);
  });

  it('does not select a key present in the known filePath set', () => {
    const result = selectOrphanedGrantedFiles(
      [{ key: 'file/upload/granted_owned.mp4', mtimeMs: minutesAgo(120) }],
      new Set(['file/upload/granted_owned.mp4']),
      now,
      60 * 60 * 1000,
    );

    expect(result).toEqual([]);
  });

  it('does not select a key younger than the age floor (promotion-race guard)', () => {
    const result = selectOrphanedGrantedFiles(
      [{ key: 'file/upload/granted_fresh.mp4', mtimeMs: minutesAgo(1) }],
      new Set<string>(),
      now,
      60 * 60 * 1000,
    );

    expect(result).toEqual([]);
  });

  it('never selects a non-granted key even if the caller passes an unfiltered list', () => {
    const result = selectOrphanedGrantedFiles(
      [{ key: 'temp_a.mp4', mtimeMs: minutesAgo(120) }],
      new Set<string>(),
      now,
      60 * 60 * 1000,
    );

    expect(result).toEqual([]);
  });
});
