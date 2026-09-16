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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'backend/auth/guard/jwt-auth.guard';
import type { Response } from 'express';

@Controller('file')
@ApiTags('파일 API (File API)')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@UseInterceptors(ClassSerializerInterceptor)
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Get()
  @ApiOperation({
    summary: '파일 목록을 조회한다. (List files.)',
  })
  @ApiResponse({
    status: 200,
    description:
      '[files, totalCount] 튜플. 기본값은 최신 20건(createdAt DESC)이며, take/skip으로 ' +
      '페이지네이션하고, search는 제목을 매칭하며, creatorId는 작성자로 필터링하고, ' +
      'sortBy/order로 정렬한다(ADR 0021). (A [files, totalCount] tuple. Defaults to the ' +
      '20 newest files (createdAt DESC); take/skip paginate, search matches the title, ' +
      'creatorId filters by author, sortBy/order sort (ADR 0021).)',
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED — take가 1–100 범위를 벗어나거나, skip이 음수이거나, ' +
      'search가 100자를 초과하거나, sortBy/order가 허용된 값이 아니다. ' +
      '(VALIDATION_FAILED — take is out of 1–100, skip is negative, search exceeds 100 ' +
      'characters, or sortBy/order is not one of the accepted values.)',
  })
  // 목적: 검증된 목록 조회 조건을 DTO 한 덩어리로 서비스에 넘긴다.
  // 이유: 조건이 take/skip에서 검색·정렬·필터까지 늘어나, 위치 인자로 풀면 호출부가 인자 순서 실수에 노출된다.
  //       요청자 신원도 넘겨야 private/unlisted 행을 소유자·admin 기준으로 필터링할 수 있다(ADR 0025).
  // 방법: @Query()로 바인딩된 GetFilesDto를 그대로 전달한다 — 컨트롤러는 조회 조건을 해석하지 않는다.
  getFiles(@Query() getFilesDto: GetFilesDto, @AuthUser() actor: AuthUser) {
    return this.fileService.getFiles(getFilesDto, actor);
  }

  @Get(':id')
  @ApiOperation({
    summary: "단일 파일 메타데이터를 조회한다. (Get one file's metadata.)",
  })
  @ApiResponse({
    status: 200,
    description: '파일 메타데이터. (The file metadata.)',
  })
  @ApiResponse({
    status: 404,
    description:
      'FILE_NOT_FOUND — 존재하지 않거나, private/unlisted 파일에 소유자·admin· ' +
      '대기중인 이전 대상 본인이 아닌 요청자가 접근했다(존재 자체를 숨긴다, ADR 0025/0026). ' +
      '(FILE_NOT_FOUND — the file does not exist, or a private/unlisted file was requested ' +
      "by someone who isn't its owner, an admin, or the pending transfer target — " +
      'existence itself is hidden, ADR 0025/0026.)',
  })
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
  @ApiOperation({
    summary:
      'temp 업로드를 소유 파일로 승격한다. (Promote a temp upload to an owned file.)',
  })
  @ApiResponse({
    status: 201,
    description: 'temp 업로드가 승격됐다. (The temp upload was promoted.)',
  })
  @ApiResponse({
    status: 200,
    description:
      '멱등 재생: 같은 유저가 이 파일명을 이미 승격했으므로 기존 파일을 그대로 반환한다' +
      '(ADR 0019). (Idempotent replay: this filename was already promoted by the same ' +
      'user, so the existing file is returned unchanged (ADR 0019).)',
  })
  @ApiResponse({
    status: 400,
    description:
      'filePath가 attach가 발급한 파일명이 아니거나(VALIDATION_FAILED), 더 이상 ' +
      '존재하지 않거나(FILE_INVALID_PATH), 제목이 이미 사용 중이다(FILE_TITLE_TAKEN). ' +
      '(filePath is not an attach-issued filename (VALIDATION_FAILED), no longer exists ' +
      '(FILE_INVALID_PATH), or the title is taken (FILE_TITLE_TAKEN).)',
  })
  @ApiResponse({
    status: 409,
    description:
      'FILE_ALREADY_CLAIMED — 다른 유저가 이미 이 파일명을 승격했다. ' +
      '(FILE_ALREADY_CLAIMED — a different user already promoted this filename.)',
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
  @ApiOperation({
    summary:
      '파일 메타데이터(제목/가시성/소유자 등)를 수정한다. (Update a file’s metadata ' +
      '(title/visibility/owner/etc).)',
  })
  @ApiResponse({
    status: 200,
    description: '파일이 수정됐다. (The file was updated.)',
  })
  @ApiResponse({
    status: 400,
    description:
      'FILE_TITLE_TAKEN — 제목이 이미 사용 중이다. FILE_INVALID_PATH — filePath가 ' +
      'granted_ 파일명이 아니거나(temp_는 이 엔드포인트에서 거부된다) 존재하지 않는다. ' +
      '(FILE_TITLE_TAKEN — the title is already taken. FILE_INVALID_PATH — filePath is ' +
      'not a granted_ filename (a temp_ one is rejected here) or no longer exists.)',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — 파일 소유자 또는 admin만 수정할 수 있다. ' +
      '(FORBIDDEN_NOT_OWNER — only the file creator or an admin may edit it.)',
  })
  @ApiResponse({
    status: 404,
    description:
      'FILE_NOT_FOUND — 존재하지 않는 파일이다. (FILE_NOT_FOUND — no such file.)',
  })
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
  @ApiOperation({
    summary: '파일을 삭제한다. (Delete a file.)',
  })
  @ApiResponse({
    status: 200,
    description:
      '파일 행과 저장된 실물이 함께 삭제됐다, 비가역적으로. (The file row and its stored ' +
      'bytes are gone, irreversibly.)',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — 파일 소유자 또는 admin만 삭제할 수 있다. ' +
      '(FORBIDDEN_NOT_OWNER — only the file creator or an admin may delete it.)',
  })
  @ApiResponse({
    status: 404,
    description:
      'FILE_NOT_FOUND — 존재하지 않는 파일이다. (FILE_NOT_FOUND — no such file.)',
  })
  @ApiResponse({
    status: 409,
    description:
      'FILE_IN_USE — 이 파일을 참조하는 게시글이 있어 삭제할 수 없다; 게시글을 먼저 ' +
      '지워야 한다(ADR 0023 D4). (FILE_IN_USE — a post still references this file; delete ' +
      'that post first, ADR 0023 D4.)',
  })
  // 목적: 파일 삭제 요청을 서비스로 넘긴다.
  // 이유: FK_file_entity 위반(게시글이 참조 중) 판정과 물리 파일 unlink는 FileService의
  //       책임이다(ADR 0023 D4).
  // 방법: 요청자를 그대로 전달 — 소유자/admin 판정은 서비스가 한다.
  delete(@Param('id', ParseIntPipe) id: number, @AuthUser() actor: AuthUser) {
    return this.fileService.deleteFile(id, actor);
  }

  @Post(':id/transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '파일 소유권 이전을 제안한다. (Propose a file ownership transfer.)',
  })
  @ApiResponse({
    status: 200,
    description:
      '이전이 제안됐다. 소유권은 아직 옮겨가지 않았다 — 대상 유저가 수락해야만 소유권이 ' +
      '이동한다(ADR 0050). (The transfer was proposed. Ownership has not moved yet — ' +
      'only the target user accepting it moves ownership (ADR 0050).)',
  })
  @ApiResponse({
    status: 400,
    description:
      'FILE_TRANSFER_INVALID_TARGET — 대상이 이 파일의 현재 소유자다. ' +
      "(FILE_TRANSFER_INVALID_TARGET — the target is the file's current owner.)",
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — 파일 소유자 또는 admin만 이전을 제안할 수 있다. ' +
      '(FORBIDDEN_NOT_OWNER — only the creator or an admin may propose a transfer.)',
  })
  @ApiResponse({
    status: 404,
    description:
      'FILE_NOT_FOUND, 또는 대상 유저에 대한 USER_NOT_FOUND. ' +
      '(FILE_NOT_FOUND, or USER_NOT_FOUND for the target.)',
  })
  @ApiResponse({
    status: 409,
    description:
      'FILE_TRANSFER_PENDING — 이미 대기중인 이전이 있다; 먼저 취소해야 한다. ' +
      '(FILE_TRANSFER_PENDING — a transfer is already pending; cancel it first.)',
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
  @ApiOperation({
    summary:
      '대기중인 소유권 이전을 수락한다. (Accept a pending ownership transfer.)',
  })
  @ApiResponse({
    status: 200,
    description:
      '수락됨 — 소유권이 호출자에게 이동했다. (Accepted — ownership has moved to the ' +
      'caller.)',
  })
  @ApiResponse({
    status: 400,
    description:
      'FILE_NO_PENDING_TRANSFER — 이 파일에 대기중인 이전이 없다. ' +
      '(FILE_NO_PENDING_TRANSFER — nothing is pending on this file.)',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_TRANSFER_TARGET — 제안된 수신자만 수락할 수 있다. ' +
      '(FORBIDDEN_NOT_TRANSFER_TARGET — only the proposed recipient may accept.)',
  })
  @ApiResponse({
    status: 404,
    description:
      'FILE_NOT_FOUND — 존재하지 않는 파일이다. (FILE_NOT_FOUND — no such file.)',
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
  @ApiOperation({
    summary:
      '대기중인 소유권 이전을 거절한다. (Reject a pending ownership transfer.)',
  })
  @ApiResponse({
    status: 200,
    description:
      '거절됨 — 소유권은 변경되지 않는다. (Rejected — ownership is unchanged.)',
  })
  @ApiResponse({
    status: 400,
    description:
      'FILE_NO_PENDING_TRANSFER — 이 파일에 대기중인 이전이 없다. ' +
      '(FILE_NO_PENDING_TRANSFER — nothing is pending on this file.)',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_TRANSFER_TARGET — 제안된 수신자만 거절할 수 있다. ' +
      '(FORBIDDEN_NOT_TRANSFER_TARGET — only the proposed recipient may reject.)',
  })
  @ApiResponse({
    status: 404,
    description:
      'FILE_NOT_FOUND — 존재하지 않는 파일이다. (FILE_NOT_FOUND — no such file.)',
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
  @ApiOperation({
    summary:
      '아직 응답 없는 소유권 이전 제안을 취소한다. (Cancel an unanswered ownership transfer proposal.)',
  })
  @ApiResponse({
    status: 200,
    description:
      '취소됨 — 소유권은 변경되지 않는다. (Cancelled — ownership is unchanged.)',
  })
  @ApiResponse({
    status: 400,
    description:
      'FILE_NO_PENDING_TRANSFER — 이 파일에 대기중인 이전이 없다. ' +
      '(FILE_NO_PENDING_TRANSFER — nothing is pending on this file.)',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN_NOT_OWNER — 파일 소유자만 취소할 수 있다(admin은 남의 제안을 취소할 ' +
      '수 없다 — propose의 소유자-또는-admin보다 좁은 규칙이다, file.service.ts의 ' +
      'cancelTransfer 참고). (FORBIDDEN_NOT_OWNER — only the file creator may cancel ' +
      "(admin cannot cancel another user's proposal — a narrower rule than propose's " +
      'creator-or-admin, see file.service.ts cancelTransfer).)',
  })
  @ApiResponse({
    status: 404,
    description:
      'FILE_NOT_FOUND — 존재하지 않는 파일이다. (FILE_NOT_FOUND — no such file.)',
  })
  // 목적: 아직 응답 없는 이전 제안 취소 요청을 서비스로 넘긴다.
  // 이유: 제안자가 대상 응답을 기다리지 않고 스스로 제안을 거둘 수 있어야 한다(ADR 0050 D3).
  // 방법: 요청자를 그대로 전달 — creator 본인 여부 판정은 서비스의 몫이다(admin 예외 없음).
  cancelTransfer(
    @Param('id', ParseIntPipe) id: number,
    @AuthUser() actor: AuthUser,
  ) {
    return this.fileService.cancelTransfer(id, actor);
  }
}
