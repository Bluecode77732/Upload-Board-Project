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
  HttpCode,
  HttpStatus,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileService } from './file.service';
import { UploadFileDto } from './dto/create-uploadFile.dto';
import { UpdateFileDto } from './dto/update-uploadFile.dto';
import { GetFilesDto } from './dto/get-files.dto';
import { ProposeFileTransferDto } from './dto/propose-file-transfer.dto';
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
  // 목적: 파일 메타데이터(제목/가시성/소유자 등) 수정 요청을 서비스로 넘긴다.
  // 이유: 소유자/admin 판정과 visibility·shareToken 상태 전이는 모두 FileService의 책임이다
  //       (Boundary Validation & Response Shaping).
  // 방법: 검증된 UpdateFileDto와 요청자를 그대로 전달한다 — 컨트롤러는 아무것도 해석하지 않는다.
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateFileDto: UpdateFileDto,
    @AuthUser() actor: AuthUser,
  ) {
    return this.fileService.updateFile(id, updateFileDto, actor);
  }

  @Delete(':id')
  // 목적: 파일 삭제 요청을 서비스로 넘긴다.
  // 이유: FK_file_entity 위반(게시글이 참조 중) 판정과 물리 파일 unlink는 FileService의
  //       책임이다(ADR 0023 D4).
  // 방법: 요청자를 그대로 전달 — 소유자/admin 판정은 서비스가 한다.
  delete(@Param('id', ParseIntPipe) id: number, @AuthUser() actor: AuthUser) {
    return this.fileService.deleteFile(id, actor);
  }

  @Post(':id/transfer')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description:
      'The transfer was proposed. Ownership has not moved yet — only the target user accepting it moves ownership (ADR 0050).',
  })
  @ApiResponse({
    status: 400,
    description:
      "FILE_TRANSFER_INVALID_TARGET — the target is the file's current owner.",
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — only the creator or an admin may propose a transfer.',
  })
  @ApiResponse({
    status: 404,
    description: 'FILE_NOT_FOUND, or USER_NOT_FOUND for the target.',
  })
  @ApiResponse({
    status: 409,
    description:
      'FILE_TRANSFER_PENDING — a transfer is already pending; cancel it first.',
  })
  // 목적: 소유권 이전 제안 요청을 서비스로 넘긴다.
  // 이유: 동의 없는 즉시 강제 이전이었던 옛 PATCH userId 필드를 대체한다(ADR 0050).
  // 방법: 대상 userId와 요청자를 그대로 전달 — 권한·중복 제안 판정은 서비스의 몫이다.
  proposeTransfer(
    @Param('id', ParseIntPipe) id: number,
    @Body() proposeFileTransferDto: ProposeFileTransferDto,
    @AuthUser() actor: AuthUser,
  ) {
    return this.fileService.proposeTransfer(
      id,
      proposeFileTransferDto.userId,
      actor,
    );
  }

  @Post(':id/transfer/accept')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Accepted — ownership has moved to the caller.',
  })
  @ApiResponse({
    status: 400,
    description: 'FILE_NO_PENDING_TRANSFER — nothing is pending on this file.',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_TRANSFER_TARGET — only the proposed recipient may accept.',
  })
  // 목적: 대기중인 이전 제안 수락 요청을 서비스로 넘긴다.
  // 이유: 오직 대상 본인만 수락할 수 있다 — admin도 대신 수락 못 한다(ADR 0050 D4).
  // 방법: 요청자를 그대로 전달 — 대상 일치 판정은 서비스의 몫이다.
  acceptTransfer(
    @Param('id', ParseIntPipe) id: number,
    @AuthUser() actor: AuthUser,
  ) {
    return this.fileService.acceptTransfer(id, actor);
  }

  @Post(':id/transfer/reject')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Rejected — ownership is unchanged.',
  })
  @ApiResponse({
    status: 400,
    description: 'FILE_NO_PENDING_TRANSFER — nothing is pending on this file.',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_TRANSFER_TARGET — only the proposed recipient may reject.',
  })
  // 목적: 대기중인 이전 제안 거절 요청을 서비스로 넘긴다.
  // 이유: acceptTransfer와 대칭 — 거절도 대상 본인의 동의 절차 중 하나다(ADR 0050).
  // 방법: 요청자를 그대로 전달 — 대상 일치 판정은 서비스의 몫이다.
  rejectTransfer(
    @Param('id', ParseIntPipe) id: number,
    @AuthUser() actor: AuthUser,
  ) {
    return this.fileService.rejectTransfer(id, actor);
  }

  @Delete(':id/transfer')
  @ApiResponse({
    status: 200,
    description: 'Cancelled — ownership is unchanged.',
  })
  @ApiResponse({
    status: 400,
    description: 'FILE_NO_PENDING_TRANSFER — nothing is pending on this file.',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — only the creator or an admin may cancel.',
  })
  // 목적: 아직 응답 없는 이전 제안 취소 요청을 서비스로 넘긴다.
  // 이유: 제안자가 대상 응답을 기다리지 않고 스스로 제안을 거둘 수 있어야 한다(ADR 0050 D3).
  // 방법: 요청자를 그대로 전달 — creator/admin 판정은 서비스의 몫이다.
  cancelTransfer(
    @Param('id', ParseIntPipe) id: number,
    @AuthUser() actor: AuthUser,
  ) {
    return this.fileService.cancelTransfer(id, actor);
  }
}
