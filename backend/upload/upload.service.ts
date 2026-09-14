// 목적: 새로 첨부된 업로드를 스캔하고, 통과하면 temp 키를 발급해 FileStorage 포트를 통해 바이트를 임시 저장한다.
// 사용처: UploadController.uploadMedia()가 호출한다 — 이제 UploadModule이 가진 유일한 서비스다(ADR 0029 D4).
// 근거: Multer가 memoryStorage로 바뀌면서(더 이상 스스로 디스크에 쓰지 않는다) 버퍼링된 바이트를 포트로 밀어넣을
// 무언가가 필요해졌다; 컨트롤러만으로는 그 의존성을 가질 수 없다. 악성코드 스캔(ADR 0059)도 같은 이유로
// 여기 자리한다 — storage.saveTemp() 전에 버퍼를 검사해야 감염 파일이 temp 저장소에 도달하지 않는다.

import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { v4 } from 'uuid';
import {
  FILE_STORAGE,
  type FileStorage,
} from 'backend/storage/file-storage.interface';
import { ErrorCode } from 'backend/common/error-code';
import {
  ScanService,
  ScanUnavailableError,
  type ScanResult,
} from './scan.service';

@Injectable()
export class UploadService {
  constructor(
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly scanService: ScanService,
  ) {}

  // 목적: 첨부된 파일을 스캔하고, 통과하면 1회용 temp 키를 부여해 FileStorage 포트를 통해 저장한다.
  // 이유: Multer가 이제 메모리로만 파일을 받으므로(ADR 0029 D4), 예전 diskStorage 콜백이 하던
  //       이름 생성 + 물리 쓰기를 대신할 자리가 필요하다. 확장자/mimetype 허용목록은 내용물을
  //       보지 않으므로(ADR 0059), 실제 저장 전에 콘텐츠 검사를 끼워 넣을 지점도 여기뿐이다.
  // 방법: storage.saveTemp() 호출 전에 scanService.scanBuffer()로 먼저 검사한다 — 감염이면
  //       400 UPLOAD_MALWARE_DETECTED, 스캐너 접속 불가/재시도 소진이면 503
  //       UPLOAD_SCAN_UNAVAILABLE로 fail-closed(ADR 0059 D3/D4). 통과한 경우에만 diskStorage
  //       콜백과 동일한 temp_{uuid}_{timestamp}.{ext} 이름을 생성해 storage.saveTemp를 호출한다.
  async stageTemp(file: Express.Multer.File): Promise<{ filename: string }> {
    let scanResult: ScanResult;
    try {
      scanResult = await this.scanService.scanBuffer(file.buffer);
    } catch (error) {
      if (error instanceof ScanUnavailableError) {
        throw new ServiceUnavailableException({
          code: ErrorCode.UPLOAD_SCAN_UNAVAILABLE,
          message: 'Could not scan the uploaded file. Please try again.',
        });
      }
      throw error;
    }

    if (scanResult.isInfected) {
      throw new BadRequestException({
        code: ErrorCode.UPLOAD_MALWARE_DETECTED,
        message: 'The uploaded file was rejected by malware scanning.',
      });
    }

    const split = file.originalname.split('.');
    const fileType = split.length > 1 ? split[split.length - 1] : 'mp4';
    const filename = `temp_${v4()}_${Date.now()}.${fileType}`;

    await this.storage.saveTemp(filename, file.buffer);

    return { filename };
  }
}
