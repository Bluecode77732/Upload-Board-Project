import * as fsPromises from 'fs/promises';
import * as fsSync from 'fs';
import { join } from 'path';
import { LocalDiskStorage } from './local-disk.storage';

jest.mock('fs/promises');
jest.mock('fs');

const access = fsPromises.access as unknown as jest.Mock;
const readdir = fsPromises.readdir as unknown as jest.Mock;
const rename = fsPromises.rename as unknown as jest.Mock;
const stat = fsPromises.stat as unknown as jest.Mock;
const unlink = fsPromises.unlink as unknown as jest.Mock;
const writeFile = fsPromises.writeFile as unknown as jest.Mock;
const createReadStream = fsSync.createReadStream as unknown as jest.Mock;

const tempPath = (name: string): string =>
  join(process.cwd(), 'file', 'temp', name);
const uploadPath = (name: string): string => join(process.cwd(), name);

describe('LocalDiskStorage', () => {
  let storage: LocalDiskStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    storage = new LocalDiskStorage();
  });

  describe('saveTemp', () => {
    it('writes the buffer under file/temp using the temp key', async () => {
      writeFile.mockResolvedValue(undefined);

      await storage.saveTemp('temp_a.mp4', Buffer.from('data'));

      expect(writeFile).toHaveBeenCalledWith(
        tempPath('temp_a.mp4'),
        Buffer.from('data'),
      );
    });
  });

  describe('existsTemp', () => {
    it('returns true when the temp file is accessible', async () => {
      access.mockResolvedValue(undefined);
      await expect(storage.existsTemp('temp_a.mp4')).resolves.toBe(true);
    });

    it('returns false on any access failure', async () => {
      access.mockRejectedValue(new Error('ENOENT'));
      await expect(storage.existsTemp('temp_a.mp4')).resolves.toBe(false);
    });
  });

  describe('promote', () => {
    it('renames the temp key to the granted key', async () => {
      rename.mockResolvedValue(undefined);

      await storage.promote('temp_a.mp4', 'file/upload/granted_a.mp4');

      expect(rename).toHaveBeenCalledWith(
        tempPath('temp_a.mp4'),
        uploadPath('file/upload/granted_a.mp4'),
      );
    });
  });

  describe('stat', () => {
    it('returns the byte size of the stored object', async () => {
      stat.mockResolvedValue({ size: 1234 });

      await expect(storage.stat('file/upload/granted_a.mp4')).resolves.toEqual({
        size: 1234,
      });
    });
  });

  describe('createReadStream', () => {
    it('creates a full stream with no range', async () => {
      const fakeStream = {};
      createReadStream.mockReturnValue(fakeStream);

      const result = await storage.createReadStream(
        'file/upload/granted_a.mp4',
      );

      expect(createReadStream).toHaveBeenCalledWith(
        uploadPath('file/upload/granted_a.mp4'),
      );
      expect(result).toBe(fakeStream);
    });

    it('passes start/end through for a range request', async () => {
      const fakeStream = {};
      createReadStream.mockReturnValue(fakeStream);

      await storage.createReadStream('file/upload/granted_a.mp4', {
        start: 0,
        end: 9,
      });

      expect(createReadStream).toHaveBeenCalledWith(
        uploadPath('file/upload/granted_a.mp4'),
        { start: 0, end: 9 },
      );
    });
  });

  describe('unlink', () => {
    it('deletes granted and temp keys, reporting an unrecognized key as a failure', async () => {
      unlink.mockResolvedValue(undefined);

      const result = await storage.unlink([
        'file/upload/granted_a.mp4',
        'temp_b.mp4',
        'not/a/known/prefix.mp4',
      ]);

      expect(unlink).toHaveBeenCalledTimes(2);
      expect(unlink).toHaveBeenCalledWith(
        uploadPath('file/upload/granted_a.mp4'),
      );
      expect(unlink).toHaveBeenCalledWith(tempPath('temp_b.mp4'));
      expect(result.deleted).toBe(2);
      expect(result.failures).toEqual([
        {
          key: 'not/a/known/prefix.mp4',
          reason: 'not a recognized storage key',
        },
      ]);
    });

    it('continues past one failed unlink and reports its reason', async () => {
      unlink
        .mockRejectedValueOnce(new Error('EBUSY'))
        .mockResolvedValueOnce(undefined);

      const result = await storage.unlink([
        'file/upload/granted_a.mp4',
        'file/upload/granted_b.mp4',
      ]);

      expect(result.deleted).toBe(1);
      expect(result.failures).toEqual([
        { key: 'file/upload/granted_a.mp4', reason: 'EBUSY' },
      ]);
    });
  });

  describe('listTemp', () => {
    it('lists only temp_ files with their mtime', async () => {
      readdir.mockResolvedValue([
        'temp_a.mp4',
        'granted_keep.mp4',
        'random.txt',
      ]);
      stat.mockResolvedValue({ isFile: () => true, mtimeMs: 111 });

      const result = await storage.listTemp();

      expect(result).toEqual([{ key: 'temp_a.mp4', mtimeMs: 111 }]);
      expect(stat).not.toHaveBeenCalledWith(tempPath('granted_keep.mp4'));
    });

    it('treats an absent file/temp directory as empty, not an error', async () => {
      readdir.mockRejectedValue(
        Object.assign(new Error('missing'), { code: 'ENOENT' }),
      );

      await expect(storage.listTemp()).resolves.toEqual([]);
    });

    it('skips an entry that vanishes mid-list', async () => {
      readdir.mockResolvedValue(['temp_gone.mp4']);
      stat.mockRejectedValue(new Error('ENOENT'));

      await expect(storage.listTemp()).resolves.toEqual([]);
    });
  });

  describe('getSignedReadUrl', () => {
    it('always returns null — local disk has no presign concept (ADR 0036)', async () => {
      await expect(
        storage.getSignedReadUrl('file/upload/granted_a.mp4', 'video/mp4'),
      ).resolves.toBeNull();
    });
  });
});
