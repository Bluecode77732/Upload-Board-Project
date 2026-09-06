// Purpose: serves a file's stored bytes behind the visibility access check, replacing static file/upload serving.
// Usage: GET /file/:id/content — the only path a client may read granted bytes from (ADR 0025 D2).
// Rationale: public/unlisted access must reach unauthenticated visitors, which the class-level JwtAuthGuard
// on FileController forbids; a separate controller keeps that guard untouched for the other five routes.

import {
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Readable } from 'node:stream';
import { FileService } from './file.service';
import { OptionalJwtAuthGuard } from 'backend/auth/guard/optional-jwt-auth.guard';
import { OptionalAuthUser } from 'backend/auth/decorator/optional-auth-user.decorator';
import { AuthUser } from 'backend/auth/decorator/auth-user.decorator';
import { ErrorCode } from 'backend/common/error-code';
import {
  FILE_STORAGE,
  type FileStorage,
} from 'backend/storage/file-storage.interface';

// Mirrors the image/audio/video allowlist upload.controller.ts enforces (ADR 0025 D4/D5)
// — the extension is server-assigned, never client-chosen, so this is a lookup, not a
// validated allowlist.
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

@Controller('file')
@ApiTags('File API')
export class FileContentController {
  private readonly logger = new Logger(FileContentController.name);

  constructor(
    private readonly fileService: FileService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  @Get(':id/content')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiQuery({
    name: 'share',
    required: false,
    description:
      "The file's current share token — required only when its visibility is 'unlisted' (ADR 0025 D3).",
  })
  @ApiResponse({
    status: 200,
    description:
      'The stored bytes. Requires no auth for a public file, an owner/admin bearer token for a private file, and a matching ?share= token (no login required) for an unlisted file.',
  })
  @ApiResponse({
    status: 206,
    description: 'Partial content for a Range request (video/audio seeking).',
  })
  @ApiResponse({
    status: 302,
    description:
      'Under STORAGE_DRIVER=s3 only: redirects to a short-lived presigned S3 URL instead of proxying bytes (ADR 0036). Never returned under the local adapter.',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER for a private file requested by a non-owner/non-admin, or FILE_SHARE_INVALID for a missing/wrong/expired unlisted share token.',
  })
  @ApiResponse({ status: 404, description: 'FILE_NOT_FOUND.' })
  // 목적: 가시성 검사를 통과한 파일의 실제 바이트를, 가능하면 S3 리다이렉트로, 아니면 Range 요청까지
  //       지원하는 스트리밍으로 내려준다.
  // 이유: 접근 판정은 FileService가 이미 끝냈으므로 여기서는 순수 전달만 남는다. 프록시 스트리밍은
  //       바이트마다 앱 서버의 대역폭·CPU를 소모하므로, 어댑터가 서명 URL을 줄 수 있으면(S3) 302로
  //       넘기고, 못 주면(로컬) 기존 스트리밍으로 폴백한다(ADR 0036) — 실제 바이트 I/O는 이제
  //       FileStorage 포트에 위임해 어댑터에 무관하게 동작한다(ADR 0029).
  // 방법: 접근 판정 → storage.getSignedReadUrl → 값이 있으면 302 리다이렉트하고 종료(stat/스트림
  //       생략) → 없으면 storage.stat → Range 헤더가 없으면 200 전체 스트림, 있으면 파싱해 206
  //       부분 스트림(범위 밖이면 416, `bytes=-N` suffix 형태는 끝에서 N바이트로 해석) — fs를
  //       직접 호출하지 않는다. 스트림은 pipeContentStream을 통해서만 res에 연결한다.
  async getContent(
    @Param('id', ParseIntPipe) id: number,
    @Query('share') share: string | undefined,
    @OptionalAuthUser() requester: AuthUser | null,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.fileService.resolveContentAccess(
      id,
      requester,
      share,
    );

    const extension = file.filePath.split('.').pop()?.toLowerCase() ?? '';
    const contentType =
      CONTENT_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream';

    const signedUrl = await this.storage.getSignedReadUrl(
      file.filePath,
      contentType,
    );
    if (signedUrl) {
      res.redirect(302, signedUrl);
      return;
    }

    let stats: { size: number };
    try {
      stats = await this.storage.stat(file.filePath);
    } catch {
      // The row exists but the stored copy does not (orphaned metadata) — a client
      // outcome (the resource is gone), not a server fault.
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }

    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Accept-Ranges': 'bytes',
      });
      const stream = await this.storage.createReadStream(file.filePath);
      this.pipeContentStream(stream, res, file.filePath);
      return;
    }

    const match = RANGE_PATTERN.exec(range);
    const startStr = match?.[1] ?? '';
    const endStr = match?.[2] ?? '';
    // A `bytes=-N` suffix range means "the last N bytes", not "bytes 0..N" —
    // it carries no start, only a length counted back from the end.
    const isSuffixRange = startStr === '' && endStr !== '';
    const start = isSuffixRange
      ? Math.max(0, stats.size - parseInt(endStr, 10))
      : startStr
        ? parseInt(startStr, 10)
        : 0;
    const end = isSuffixRange
      ? stats.size - 1
      : endStr
        ? parseInt(endStr, 10)
        : stats.size - 1;

    if (!match || start > end || end >= stats.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${end}/${stats.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    const stream = await this.storage.createReadStream(file.filePath, {
      start,
      end,
    });
    this.pipeContentStream(stream, res, file.filePath);
  }

  // 목적: 스토리지에서 읽은 스트림을 응답에 연결하되, 중간에 끊기는 읽기 실패를 안전하게 처리한다.
  // 이유: 헤더 전송 후 읽기가 실패하면(DELETE /file/:id가 스트리밍 중인 파일과 경합하거나, 디스크
  //       오류) 'error' 리스너 없는 pipe는 처리되지 않은 'error' 이벤트로 프로세스를 죽인다(Never
  //       Do Group 1) — ADR 0026 content-endpoint follow-ups #1.
  // 방법: pipe 전에 stream.on('error', ...)을 걸어 응답을 destroy하고 warn으로 로그만 남긴다.
  private pipeContentStream(
    stream: Readable,
    res: Response,
    filePath: string,
  ): void {
    stream.on('error', (err) => {
      this.logger.warn(`Content stream failed for ${filePath}: ${err.message}`);
      res.destroy();
    });
    stream.pipe(res);
  }
}
