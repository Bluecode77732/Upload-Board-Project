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
  getFiles(@Query() getFilesDto: GetFilesDto) {
    return this.fileService.getFiles(getFilesDto.take, getFilesDto.skip);
  }

  @Get(':id')
  getFileById(@Param('id', ParseIntPipe) id: number) {
    return this.fileService.getFileById(id);
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
