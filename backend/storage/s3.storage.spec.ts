import { Readable } from 'stream';
import { S3Storage } from './s3.storage';

const send = jest.fn();
const getSignedUrl = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  const actual =
    jest.requireActual<typeof import('@aws-sdk/client-s3')>(
      '@aws-sdk/client-s3',
    );
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send })),
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) =>
    (getSignedUrl as (...args: unknown[]) => unknown)(...args),
}));

const mockConfigService = {
  getOrThrow: jest.fn((key: string) => {
    if (key === 'AWS_REGION') return 'ap-northeast-2';
    if (key === 'S3_BUCKET') return 'upload-board-test-bucket';
    if (key === 'CONTENT_SIGNED_URL_TTL_SECONDS') return 300;
    throw new Error(`unexpected key ${key}`);
  }),
} as unknown as import('@nestjs/config').ConfigService;

describe('S3Storage', () => {
  let storage: S3Storage;

  beforeEach(() => {
    jest.clearAllMocks();
    storage = new S3Storage(mockConfigService);
  });

  describe('saveTemp', () => {
    it('sends a PutObjectCommand with the temp key', async () => {
      send.mockResolvedValue({});

      await storage.saveTemp('temp_a.mp4', Buffer.from('data'));

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'upload-board-test-bucket',
            Key: 'temp_a.mp4',
            Body: Buffer.from('data'),
          },
        }),
      );
    });
  });

  describe('existsTemp', () => {
    it('returns true when HeadObject succeeds', async () => {
      send.mockResolvedValue({});
      await expect(storage.existsTemp('temp_a.mp4')).resolves.toBe(true);
    });

    it('returns false on any HeadObject failure', async () => {
      send.mockRejectedValue(new Error('NotFound'));
      await expect(storage.existsTemp('temp_a.mp4')).resolves.toBe(false);
    });
  });

  describe('promote', () => {
    it('copies then deletes the temp source', async () => {
      send.mockResolvedValue({});

      await storage.promote('temp_a.mp4', 'file/upload/granted_a.mp4');

      expect(send).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          input: {
            Bucket: 'upload-board-test-bucket',
            CopySource: 'upload-board-test-bucket/temp_a.mp4',
            Key: 'file/upload/granted_a.mp4',
          },
        }),
      );
      expect(send).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          input: {
            Bucket: 'upload-board-test-bucket',
            Key: 'temp_a.mp4',
          },
        }),
      );
    });
  });

  describe('stat', () => {
    it('returns ContentLength as size', async () => {
      send.mockResolvedValue({ ContentLength: 5678 });

      await expect(storage.stat('file/upload/granted_a.mp4')).resolves.toEqual({
        size: 5678,
      });
    });

    it('defaults to 0 when ContentLength is missing', async () => {
      send.mockResolvedValue({});

      await expect(storage.stat('file/upload/granted_a.mp4')).resolves.toEqual({
        size: 0,
      });
    });
  });

  describe('createReadStream', () => {
    it('returns the Body stream for a full read', async () => {
      const body = new Readable({ read() {} });
      send.mockResolvedValue({ Body: body });

      const result = await storage.createReadStream(
        'file/upload/granted_a.mp4',
      );

      expect(result).toBe(body);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'upload-board-test-bucket',
            Key: 'file/upload/granted_a.mp4',
          },
        }),
      );
    });

    it('sends a Range header for a partial read', async () => {
      const body = new Readable({ read() {} });
      send.mockResolvedValue({ Body: body });

      await storage.createReadStream('file/upload/granted_a.mp4', {
        start: 0,
        end: 9,
      });

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'upload-board-test-bucket',
            Key: 'file/upload/granted_a.mp4',
            Range: 'bytes=0-9',
          },
        }),
      );
    });

    it('throws when the SDK returns a non-stream Body', async () => {
      send.mockResolvedValue({ Body: 'not-a-stream' });

      await expect(
        storage.createReadStream('file/upload/granted_a.mp4'),
      ).rejects.toThrow('was not a Node stream');
    });
  });

  describe('unlink', () => {
    it('deletes recognized keys and reports an unrecognized key as a failure', async () => {
      send.mockResolvedValue({ Errors: [] });

      const result = await storage.unlink([
        'file/upload/granted_a.mp4',
        'temp_b.mp4',
        'not/a/known/prefix.mp4',
      ]);

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'upload-board-test-bucket',
            Delete: {
              Objects: [
                { Key: 'file/upload/granted_a.mp4' },
                { Key: 'temp_b.mp4' },
              ],
            },
          },
        }),
      );
      expect(result.deleted).toBe(2);
      expect(result.failures).toEqual([
        {
          key: 'not/a/known/prefix.mp4',
          reason: 'not a recognized storage key',
        },
      ]);
    });

    it('reports per-key errors returned by DeleteObjects', async () => {
      send.mockResolvedValue({
        Errors: [{ Key: 'file/upload/granted_a.mp4', Message: 'AccessDenied' }],
      });

      const result = await storage.unlink(['file/upload/granted_a.mp4']);

      expect(result.deleted).toBe(0);
      expect(result.failures).toEqual([
        { key: 'file/upload/granted_a.mp4', reason: 'AccessDenied' },
      ]);
    });

    it('reports every key in a batch as failed when the whole request throws', async () => {
      send.mockRejectedValue(new Error('network error'));

      const result = await storage.unlink(['file/upload/granted_a.mp4']);

      expect(result.deleted).toBe(0);
      expect(result.failures).toEqual([
        { key: 'file/upload/granted_a.mp4', reason: 'network error' },
      ]);
    });
  });

  describe('listTemp', () => {
    it('paginates through ListObjectsV2 and collects temp entries', async () => {
      const lastModified = new Date('2026-08-01T00:00:00Z');
      send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'temp_a.mp4', LastModified: lastModified }],
          NextContinuationToken: 'token-2',
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: 'temp_b.mp4', LastModified: lastModified }],
        });

      const result = await storage.listTemp();

      expect(send).toHaveBeenCalledTimes(2);
      expect(result).toEqual([
        { key: 'temp_a.mp4', mtimeMs: lastModified.getTime() },
        { key: 'temp_b.mp4', mtimeMs: lastModified.getTime() },
      ]);
    });

    it('returns an empty list and logs when ListObjectsV2 fails', async () => {
      send.mockRejectedValue(new Error('network error'));

      await expect(storage.listTemp()).resolves.toEqual([]);
    });
  });

  describe('getSignedReadUrl', () => {
    it('signs a GetObjectCommand with the response content type and configured TTL (ADR 0036)', async () => {
      getSignedUrl.mockResolvedValue('https://bucket.s3.amazonaws.com/signed');

      const result = await storage.getSignedReadUrl(
        'file/upload/granted_a.mp4',
        'video/mp4',
      );

      expect(result).toBe('https://bucket.s3.amazonaws.com/signed');
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: {
            Bucket: 'upload-board-test-bucket',
            Key: 'file/upload/granted_a.mp4',
            ResponseContentType: 'video/mp4',
          },
        }),
        { expiresIn: 300 },
      );
    });
  });
});
