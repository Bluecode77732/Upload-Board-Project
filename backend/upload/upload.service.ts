// Purpose: generates a temp key for a newly attached upload and stages its bytes through the FileStorage port.
// Usage: called by UploadController.uploadMedia() — the only service UploadModule now has (ADR 0029 D4).
// Rationale: Multer moved to memoryStorage (no longer writes to disk itself), so something must push the buffered bytes through the port; a bare controller cannot hold that dependency.

import { Inject, Injectable } from '@nestjs/common';
import { v4 } from 'uuid';
import {
  FILE_STORAGE,
  type FileStorage,
} from 'backend/storage/file-storage.interface';

@Injectable()
export class UploadService {
  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  // 목적: 첨부된 파일에 1회용 temp 키를 부여하고 FileStorage 포트를 통해 저장한다.
  // 이유: Multer가 이제 메모리로만 파일을 받으므로(ADR 0029 D4), 예전 diskStorage 콜백이 하던
  //       이름 생성 + 물리 쓰기를 대신할 자리가 필요하다.
  // 방법: diskStorage 콜백과 동일한 temp_{uuid}_{timestamp}.{ext} 이름을 생성한 뒤 storage.saveTemp를 호출한다.
  async stageTemp(file: Express.Multer.File): Promise<{ filename: string }> {
    const split = file.originalname.split('.');
    const fileType = split.length > 1 ? split[split.length - 1] : 'mp4';
    const filename = `temp_${v4()}_${Date.now()}.${fileType}`;

    await this.storage.saveTemp(filename, file.buffer);

    return { filename };
  }
}
