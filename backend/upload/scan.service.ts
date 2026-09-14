// 목적: 첨부된 업로드 버퍼를 clamd에 보내 악성 콘텐츠 여부를 확인한다.
// 사용처: UploadService.stageTemp()가 storage.saveTemp() 호출 전에 부른다 — 이 모듈
// 밖에서 쓸 일이 없다.
// 근거: 확장자/mimetype 허용목록만으로는 파일 내용물을 검증하지 못한다(ADR 0059) —
// clamscan을 원격 clamd TCP 모드로 감싸 동기 스캔 게이트를 추가한다. FileStorage 같은
// 포트가 아니라 평범한 서비스인 이유는 구현체와 소비자가 각각 하나뿐이라서다(ADR 0059 D2).

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import NodeClam from 'clamscan';

// 총 시도 횟수(최초 1회 + 재시도 1회)와 시도 사이 고정 지연, 시도당 타임아웃(ADR 0059 D5).
const SCAN_MAX_ATTEMPTS = 2;
const SCAN_RETRY_DELAY_MS = 200;
const SCAN_TIMEOUT_MS = 8000;

export interface ScanResult {
  isInfected: boolean;
  viruses: string[];
}

// clamd에 연결할 수 없었거나 모든 재시도가 타임아웃됐다는 뜻이다 — 파일 자체에 대해서는
// 아무것도 확인되지 않았다(감염 여부와는 다른 실패, ADR 0059 D3/D4).
export class ScanUnavailableError extends Error {}

@Injectable()
export class ScanService implements OnModuleInit {
  private readonly logger = new Logger(ScanService.name);
  private clam: NodeClam | undefined;

  constructor(private readonly configService: ConfigService) {}

  // 목적: clamd TCP 연결로 설정된 clamscan 인스턴스를 만들어 재사용한다.
  // 이유: NodeClam.init()은 비동기이며 매 스캔마다 새로 만들 이유가 없다 — 모듈
  //       부팅 시 한 번만 초기화한다.
  // 방법: clamdscan(원격 TCP)만 active로 두고 clamscan(로컬 바이너리)은 비활성화한다
  //       (ADR 0059 D1/D2 — 로컬 바이너리 모드는 애초에 쓰지 않는다). bypassTest:true로
  //       초기화 시점의 연결 확인은 건너뛴다 — 부팅 순서상 clamd가 아직 안 떠 있어도
  //       앱 자체는 죽지 않게 하고, 실제 가용성 확인은 스캔 호출마다의 재시도/타임아웃에
  //       맡긴다(D5) — fail-closed(D4)는 "스캔을 시도했는데 실패"에만 적용되어야 한다.
  async onModuleInit(): Promise<void> {
    this.clam = await new NodeClam().init({
      removeInfected: false,
      clamscan: { active: false },
      clamdscan: {
        host: this.configService.getOrThrow<string>('CLAMD_HOST'),
        port: this.configService.getOrThrow<number>('CLAMD_PORT'),
        timeout: SCAN_TIMEOUT_MS,
        localFallback: false,
        bypassTest: true,
        active: true,
      },
    });
  }

  // 목적: 업로드 버퍼를 스캔해 감염 여부를 확정한다.
  // 이유: 이게 이 기능이 추가하는 유일한 실제 콘텐츠 검사다 — 확장자/mimetype
  //       허용목록은 내용물을 보지 않는다(ADR 0059 Context).
  // 방법: 버퍼를 Readable로 감싸 scanStream에 넘긴다. 연결 실패/타임아웃은 고정
  //       지연(SCAN_RETRY_DELAY_MS)을 두고 최대 SCAN_MAX_ATTEMPTS번 재시도하고, 그래도
  //       실패하면 ScanUnavailableError를 던져 호출자가 fail-closed로 매핑하게 한다
  //       (D4) — 반면 감염 탐지는 정상 응답이므로 재시도 대상이 아니라 그대로 반환한다.
  async scanBuffer(buffer: Buffer): Promise<ScanResult> {
    if (!this.clam) {
      throw new ScanUnavailableError('Scanner not initialized.');
    }
    const clam = this.clam;

    let lastError: unknown;
    for (let attempt = 1; attempt <= SCAN_MAX_ATTEMPTS; attempt++) {
      try {
        const result = await clam.scanStream(Readable.from(buffer));
        return { isInfected: result.isInfected, viruses: result.viruses };
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `Malware scan attempt ${attempt}/${SCAN_MAX_ATTEMPTS} failed: ` +
            (error instanceof Error ? error.message : String(error)),
        );
        if (attempt < SCAN_MAX_ATTEMPTS) {
          await new Promise((resolve) =>
            setTimeout(resolve, SCAN_RETRY_DELAY_MS),
          );
        }
      }
    }

    throw new ScanUnavailableError(
      lastError instanceof Error ? lastError.message : 'Scanner unreachable.',
    );
  }
}
