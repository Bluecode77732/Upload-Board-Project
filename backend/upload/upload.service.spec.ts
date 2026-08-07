import { UploadService } from './upload.service';
import { FileStorage } from 'backend/storage/file-storage.interface';

// uuid v13 ships ESM-only, which ts-jest's default CJS transform cannot parse
// (node_modules is untransformed by default) — mocking it avoids ever loading the
// real module under Jest, unrelated to this file's actual runtime behavior.
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));

describe('UploadService', () => {
  let service: UploadService;
  const mockStorage: jest.Mocked<FileStorage> = {
    saveTemp: jest.fn(),
    existsTemp: jest.fn(),
    promote: jest.fn(),
    stat: jest.fn(),
    createReadStream: jest.fn(),
    unlink: jest.fn(),
    listTemp: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UploadService(mockStorage);
  });

  describe('stageTemp', () => {
    it('generates a temp_{uuid}_{timestamp}.{ext} name and saves the buffer through the port', async () => {
      mockStorage.saveTemp.mockResolvedValue(undefined);
      const file = {
        originalname: 'clip.mp4',
        buffer: Buffer.from('bytes'),
      } as Express.Multer.File;

      const result = await service.stageTemp(file);

      expect(result.filename).toMatch(/^temp_[0-9a-f-]{36}_\d+\.mp4$/);
      expect(mockStorage.saveTemp).toHaveBeenCalledWith(
        result.filename,
        file.buffer,
      );
    });

    it('defaults the extension to mp4 when the original name has none', async () => {
      mockStorage.saveTemp.mockResolvedValue(undefined);
      const file = {
        originalname: 'clip',
        buffer: Buffer.from('bytes'),
      } as Express.Multer.File;

      const result = await service.stageTemp(file);

      expect(result.filename).toMatch(/\.mp4$/);
    });
  });
});
