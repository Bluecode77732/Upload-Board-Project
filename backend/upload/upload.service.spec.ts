import { UploadService } from './upload.service';
import { FileStorage } from 'backend/storage/file-storage.interface';
import { ScanService, ScanUnavailableError } from './scan.service';
import { ErrorCode } from 'backend/common/error-code';

// uuid v13은 ESM-only로 배포되는데, ts-jest 기본 CJS 트랜스폼은 이를 파싱하지 못한다
// (node_modules는 기본적으로 트랜스폼 대상이 아니다) — mock 처리하면 Jest 아래서
// 실제 모듈을 로드하는 일 자체가 없어진다, 이 파일의 실제 런타임 동작과는 무관하다.
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
    listGranted: jest.fn(),
    getSignedReadUrl: jest.fn(),
  };
  const mockScanService: jest.Mocked<Pick<ScanService, 'scanBuffer'>> = {
    scanBuffer: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UploadService(
      mockStorage,
      mockScanService as unknown as ScanService,
    );
  });

  describe('stageTemp', () => {
    it('generates a temp_{uuid}_{timestamp}.{ext} name and saves the buffer through the port', async () => {
      mockScanService.scanBuffer.mockResolvedValue({
        isInfected: false,
        viruses: [],
      });
      mockStorage.saveTemp.mockResolvedValue(undefined);
      const file = {
        originalname: 'clip.mp4',
        buffer: Buffer.from('bytes'),
      } as Express.Multer.File;

      const result = await service.stageTemp(file);

      expect(result.filename).toMatch(/^temp_[0-9a-f-]{36}_\d+\.mp4$/);
      expect(mockScanService.scanBuffer).toHaveBeenCalledWith(file.buffer);
      expect(mockStorage.saveTemp).toHaveBeenCalledWith(
        result.filename,
        file.buffer,
      );
    });

    it('defaults the extension to mp4 when the original name has none', async () => {
      mockScanService.scanBuffer.mockResolvedValue({
        isInfected: false,
        viruses: [],
      });
      mockStorage.saveTemp.mockResolvedValue(undefined);
      const file = {
        originalname: 'clip',
        buffer: Buffer.from('bytes'),
      } as Express.Multer.File;

      const result = await service.stageTemp(file);

      expect(result.filename).toMatch(/\.mp4$/);
    });

    it('rejects an infected file with UPLOAD_MALWARE_DETECTED and never saves it (ADR 0059 D3)', async () => {
      mockScanService.scanBuffer.mockResolvedValue({
        isInfected: true,
        viruses: ['Eicar-Test-Signature'],
      });
      const file = {
        originalname: 'clip.mp4',
        buffer: Buffer.from('bytes'),
      } as Express.Multer.File;

      await expect(service.stageTemp(file)).rejects.toMatchObject({
        response: { code: ErrorCode.UPLOAD_MALWARE_DETECTED },
      });
      expect(mockStorage.saveTemp).not.toHaveBeenCalled();
    });

    it('fails closed with UPLOAD_SCAN_UNAVAILABLE when the scanner cannot be reached and never saves the file (ADR 0059 D4)', async () => {
      mockScanService.scanBuffer.mockRejectedValue(
        new ScanUnavailableError('connection refused'),
      );
      const file = {
        originalname: 'clip.mp4',
        buffer: Buffer.from('bytes'),
      } as Express.Multer.File;

      await expect(service.stageTemp(file)).rejects.toMatchObject({
        response: { code: ErrorCode.UPLOAD_SCAN_UNAVAILABLE },
      });
      expect(mockStorage.saveTemp).not.toHaveBeenCalled();
    });
  });
});
