// Purpose: serves a file's stored bytes behind the visibility access check, replacing static file/upload serving.
// Usage: GET /file/:id/content — the only path a client may read granted bytes from (ADR 0025 D2).
// Rationale: public/unlisted access must reach unauthenticated visitors, which the class-level JwtAuthGuard
// on FileController forbids; a separate controller keeps that guard untouched for the other five routes.

import {
  Controller,
  Get,
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
import { createReadStream, type Stats } from 'fs';
import { stat } from 'fs/promises';
import { join } from 'path';
import { FileService } from './file.service';
import { OptionalJwtAuthGuard } from 'backend/auth/guard/optional-jwt-auth.guard';
import { OptionalAuthUser } from 'backend/auth/decorator/optional-auth-user.decorator';
import { AuthUser } from 'backend/auth/decorator/auth-user.decorator';
import { ErrorCode } from 'backend/common/error-code';

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
  constructor(private readonly fileService: FileService) {}

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
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER for a private file requested by a non-owner/non-admin, or FILE_SHARE_INVALID for a missing/wrong/expired unlisted share token.',
  })
  @ApiResponse({ status: 404, description: 'FILE_NOT_FOUND.' })
  // 목적: 가시성 검사를 통과한 파일의 실제 바이트를 Range 요청까지 지원하며 스트리밍한다.
  // 이유: 정적 서빙이 공짜로 주던 부분 요청(재생 탐색)을 이 엔드포인트가 직접 구현해야 하고,
  //       접근 판정은 FileService가 이미 끝냈으므로 여기서는 순수 HTTP 스트리밍만 남는다.
  // 방법: 접근 판정 → fs/promises.stat → Range 헤더가 없으면 200 전체 스트림, 있으면 파싱해
  //       206 부분 스트림(범위 밖이면 416) — 동기 fs 호출은 쓰지 않는다(Never Do G1).
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

    const absolutePath = join(process.cwd(), file.filePath);
    let stats: Stats;
    try {
      stats = await stat(absolutePath);
    } catch {
      // The row exists but the disk copy does not (orphaned metadata) — a client
      // outcome (the resource is gone), not a server fault.
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }

    const extension = file.filePath.split('.').pop()?.toLowerCase() ?? '';
    const contentType =
      CONTENT_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream';

    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Accept-Ranges': 'bytes',
      });
      createReadStream(absolutePath).pipe(res);
      return;
    }

    const match = RANGE_PATTERN.exec(range);
    const start = match?.[1] ? parseInt(match[1], 10) : 0;
    const end = match?.[2] ? parseInt(match[2], 10) : stats.size - 1;

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
    createReadStream(absolutePath, { start, end }).pipe(res);
  }
}
