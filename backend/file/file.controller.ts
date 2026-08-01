import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  Query,
  ClassSerializerInterceptor,
  HttpStatus,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileService } from './file.service';
import { UploadFileDto } from './dto/create-uploadFile.dto';
import { UpdateFileDto } from './dto/update-uploadFile.dto';
import { GetFilesDto } from './dto/get-files.dto';
import { UserId } from 'backend/user/decorator/userId.decorator';
import { AuthUser } from 'backend/auth/decorator/auth-user.decorator';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'backend/auth/guard/jwt-auth.guard';
import type { Response } from 'express';

@Controller('file')
@ApiTags('File API')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@UseInterceptors(ClassSerializerInterceptor)
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Get()
  @ApiResponse({
    status: 200,
    description:
      'A [files, totalCount] tuple. Defaults to the 20 newest files (createdAt DESC); take/skip paginate, search matches the title, creatorId filters by author, sortBy/order sort (ADR 0021).',
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED — take is out of 1–100, skip is negative, search exceeds 100 characters, or sortBy/order is not one of the accepted values.',
  })
  // 목적: 검증된 목록 조회 조건을 DTO 한 덩어리로 서비스에 넘긴다.
  // 이유: 조건이 take/skip에서 검색·정렬·필터까지 늘어나, 위치 인자로 풀면 호출부가 인자 순서 실수에 노출된다.
  //       요청자 신원도 넘겨야 private/unlisted 행을 소유자·admin 기준으로 필터링할 수 있다(ADR 0025).
  // 방법: @Query()로 바인딩된 GetFilesDto를 그대로 전달한다 — 컨트롤러는 조회 조건을 해석하지 않는다.
  getFiles(@Query() getFilesDto: GetFilesDto, @AuthUser() actor: AuthUser) {
    return this.fileService.getFiles(getFilesDto, actor);
  }

  @Get(':id')
  // 목적: 단일 파일 메타데이터를 조회한다.
  // 이유: private/unlisted 파일의 존재·제목이 요청자 신원 없이는 접근 판정을 내릴 수 없다(ADR 0025).
  // 방법: @AuthUser()로 얻은 요청자를 그대로 서비스에 넘긴다 — 판정은 FileService의 몫이다.
  getFileById(
    @Param('id', ParseIntPipe) id: number,
    @AuthUser() actor: AuthUser,
  ) {
    return this.fileService.getFileById(id, actor);
  }

  @Post()
  @ApiResponse({ status: 201, description: 'The temp upload was promoted.' })
  @ApiResponse({
    status: 200,
    description:
      'Idempotent replay: this filename was already promoted by the same user, so the existing file is returned unchanged (ADR 0019).',
  })
  @ApiResponse({
    status: 400,
    description:
      'filePath is not an attach-issued filename (VALIDATION_FAILED), no longer exists (FILE_INVALID_PATH), or the title is taken (FILE_TITLE_TAKEN).',
  })
  @ApiResponse({
    status: 409,
    description:
      'FILE_ALREADY_CLAIMED — a different user already promoted this filename.',
  })
  // 목적: temp 업로드 승격 요청을 서비스로 넘기고, 멱등 재시도는 200으로 응답한다.
  // 이유: 재시도가 새 리소스를 만든 것처럼 201을 돌려주면 클라이언트가 생성/재생을 구분할 수 없다.
  // 방법: 서비스가 돌려준 replayed 플래그로만 상태코드를 바꾸고(@Res passthrough), 본문은 동일하게 반환한다.
  async uploadVideo(
    @Body() body: UploadFileDto,
    @UserId() userId: number,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { replayed, file } = await this.fileService.uploadFile(body, userId);

    if (replayed) {
      response.status(HttpStatus.OK);
    }

    return file;
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateFileDto: UpdateFileDto,
    @AuthUser() actor: AuthUser,
  ) {
    return this.fileService.updateFile(id, updateFileDto, actor);
  }

  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number, @AuthUser() actor: AuthUser) {
    return this.fileService.deleteFile(id, actor);
  }
}
