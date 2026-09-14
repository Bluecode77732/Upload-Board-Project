import { ScanService, ScanUnavailableError } from './scan.service';

const init = jest.fn();
const scanStream = jest.fn();

jest.mock('clamscan', () => jest.fn().mockImplementation(() => ({ init })));

const mockConfigService = {
  getOrThrow: jest.fn((key: string) => {
    if (key === 'CLAMD_HOST') return 'clamav';
    if (key === 'CLAMD_PORT') return 3310;
    throw new Error(`unexpected key ${key}`);
  }),
} as unknown as import('@nestjs/config').ConfigService;

describe('ScanService', () => {
  let service: ScanService;

  beforeEach(() => {
    jest.clearAllMocks();
    init.mockResolvedValue({ scanStream });
    service = new ScanService(mockConfigService);
  });

  describe('onModuleInit', () => {
    it('initializes clamscan in remote clamdscan-only mode with the configured host/port (ADR 0059 D1/D2)', async () => {
      await service.onModuleInit();

      expect(init).toHaveBeenCalledWith({
        removeInfected: false,
        clamscan: { active: false },
        clamdscan: {
          host: 'clamav',
          port: 3310,
          timeout: 8000,
          localFallback: false,
          bypassTest: true,
          active: true,
        },
      });
    });
  });

  describe('scanBuffer', () => {
    it('throws ScanUnavailableError if called before onModuleInit', async () => {
      await expect(service.scanBuffer(Buffer.from('x'))).rejects.toThrow(
        ScanUnavailableError,
      );
    });

    it('returns a clean result for a non-infected buffer', async () => {
      await service.onModuleInit();
      scanStream.mockResolvedValue({ isInfected: false, viruses: [] });

      const result = await service.scanBuffer(Buffer.from('clean'));

      expect(result).toEqual({ isInfected: false, viruses: [] });
      expect(scanStream).toHaveBeenCalledTimes(1);
    });

    it('returns the infected result as-is without retrying (detection is not a scan failure)', async () => {
      await service.onModuleInit();
      scanStream.mockResolvedValue({
        isInfected: true,
        viruses: ['Eicar-Test-Signature'],
      });

      const result = await service.scanBuffer(Buffer.from('eicar'));

      expect(result).toEqual({
        isInfected: true,
        viruses: ['Eicar-Test-Signature'],
      });
      expect(scanStream).toHaveBeenCalledTimes(1);
    });

    it('retries once on a transient failure and returns the result if the retry succeeds (ADR 0059 D5)', async () => {
      await service.onModuleInit();
      scanStream
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({ isInfected: false, viruses: [] });

      const result = await service.scanBuffer(Buffer.from('clean'));

      expect(result).toEqual({ isInfected: false, viruses: [] });
      expect(scanStream).toHaveBeenCalledTimes(2);
    });

    it('fails closed with ScanUnavailableError once every attempt fails (ADR 0059 D4)', async () => {
      await service.onModuleInit();
      scanStream.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.scanBuffer(Buffer.from('x'))).rejects.toThrow(
        ScanUnavailableError,
      );
      expect(scanStream).toHaveBeenCalledTimes(2);
    });
  });
});
