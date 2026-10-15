// 목적: 파일 소유권 이전(제안 → 수락/거절/취소)의 쓰기 로직만 모아 둔다.
// 사용처: FileController의 /file/:id/transfer 핸들러 4개가 호출한다 — FileModule 밖으로 export하지 않는다.
// 근거: FileService가 1,000줄을 넘었고, 이전은 다른 메서드와 상태를 공유하지 않는 독립 상태 머신이라
//       같은 모듈 안의 서비스 파일로 떼어 냈다. 읽기 쪽(toResponse, getFileById)은 FileService에 남는다(ADR 0067).

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from 'backend/user/entity/user.entity';
import { FileEntity } from './entity/file.entity';
import { FileResponseDto } from './dto/file-response.dto';
import { FileService } from './file.service';
import { ErrorCode } from 'backend/common/error-code';
import { ROLE_RANK, UserRole } from 'backend/auth/role/role';
import { AuditLogService } from 'backend/audit-log/audit-log.service';
import { AuditTargetType } from 'backend/audit-log/audit-target-type.enum';

// 행위자의 신원 + role(JWT로부터) — creator-OR-admin 판정에 필요한 만큼만 담는다.
interface Requester {
  id: number;
  role: UserRole;
}

@Injectable()
export class FileTransferService {
  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,

    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,

    private readonly auditLogService: AuditLogService,

    // 응답 모양(BASE_URL 합성, pendingTransferTo 노출 규칙)은 FileService 한 곳에만 둔다.
    private readonly fileService: FileService,
  ) {}

  // 목적: 요청자가 이 파일의 제안을 낼 수 있는지(creator 또는 admin) 판정한다.
  // 이유: FileService의 canManage와 같은 규칙인데, 그쪽을 public으로 열면 PostService 등 기존 소비자와의
  //       계약이 넓어진다. Post/Comment 서비스도 각자 같은 4줄을 갖고 있다.
  // 방법: creator 본인이거나 role 순위가 admin 이상이면 true.
  private canManage(creatorId: number, requester: Requester): boolean {
    return (
      creatorId === requester.id ||
      ROLE_RANK[requester.role] >= ROLE_RANK[UserRole.admin]
    );
  }

  // 목적: 이전 4개 메서드가 공통으로 쓰는 "creator + 대기중 대상 포함 파일 행"을 읽는다.
  // 이유: 조회 후 없으면 404 FILE_NOT_FOUND 블록이 쓰기 전과 쓰기 후 재조회에 그대로 반복됐다.
  // 방법: relation을 creator, pendingTransferTo로 고정해 읽고 없으면 던진다.
  private async loadWithPending(id: number): Promise<FileEntity> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['creator', 'pendingTransferTo'],
    });
    if (!file) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }
    return file;
  }

  // 목적: creator/admin이 파일 소유권을 특정 대상에게 이전하자고 제안한다 — 소유권은 이 시점에
  //       바뀌지 않는다.
  // 이유: 옛 즉시-강제 이전(UpdateFileDto.userId)은 수신자 동의 없이 소유권을 바꿔서, 그 결과가
  //       ADR 0024가 흡수해야 했던 invariant 붕괴의 유일한 원인이었다. 제안 단계를 분리해 동의
  //       없는 이전 자체를 구조적으로 불가능하게 만든다(ADR 0050 D1).
  // 방법: canManage로 권한 확인 → 자기 자신을 대상으로 지정하면 거부 → 대상 유저 존재 확인 →
  //       이미 대기중이면 409(D3 — 자동 덮어쓰기 없음, 먼저 취소해야 함) → pendingTransferToUserId만
  //       갱신, creator는 그대로.
  async proposeTransfer(
    id: number,
    targetUserId: number,
    requester: Requester,
  ): Promise<FileResponseDto> {
    const file = await this.loadWithPending(id);

    if (!this.canManage(file.creator.id, requester)) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_OWNER,
        message: 'Only the file creator or an admin can propose a transfer.',
      });
    }

    if (targetUserId === file.creator.id) {
      throw new BadRequestException({
        code: ErrorCode.FILE_TRANSFER_INVALID_TARGET,
        message: 'Cannot propose a transfer to the current owner.',
      });
    }

    if (file.pendingTransferTo) {
      throw new ConflictException({
        code: ErrorCode.FILE_TRANSFER_PENDING,
        message: `A transfer to user ${file.pendingTransferTo.id} is already pending. Cancel it before proposing a new target.`,
      });
    }

    const target = await this.userRepository.findOne({
      where: { id: targetUserId },
    });
    if (!target) {
      throw new NotFoundException({
        code: ErrorCode.USER_NOT_FOUND,
        message: 'No user found.',
      });
    }

    await this.fileRepository
      .createQueryBuilder()
      .update(FileEntity)
      .set({ pendingTransferTo: target })
      .where('id = :id', { id })
      .execute();

    const updated = await this.loadWithPending(id);
    return this.fileService.toResponse(updated, requester);
  }

  // 목적: 대기중인 이전 제안을 대상 유저 본인이 수락해 실제로 소유권을 넘긴다 — 이 시점에만
  //       creator가 실제로 바뀐다.
  // 이유: 동의 없는 강제 이전을 막는 것이 ADR 0050의 핵심이다 — admin을 포함해 오직 대상 본인만
  //       수락할 수 있다(D4). 감사 로그도 제안이 아니라 이 실제 상태 변화 시점에만 남긴다(D6) —
  //       이전 소유자의 계정이 나중에 삭제되면 이 로그가 원래 소유자를 알 수 있는 유일한 곳이다.
  // 방법: 대기중인 제안이 없으면 400 → 요청자가 대상이 아니면 403(제3자는 파일이 대기중이라는
  //       사실조차 알면 안 되므로 존재 확인보다 먼저 대상 일치부터 본다) → creator를 대상으로,
  //       pendingTransferToUserId를 null로 같은 쓰기에서 갱신 → 커밋 후 FILE_TRANSFER 감사 로그.
  async acceptTransfer(
    id: number,
    requester: Requester,
  ): Promise<FileResponseDto> {
    const file = await this.loadWithPending(id);

    if (!file.pendingTransferTo) {
      throw new BadRequestException({
        code: ErrorCode.FILE_NO_PENDING_TRANSFER,
        message: 'This file has no pending transfer.',
      });
    }

    if (file.pendingTransferTo.id !== requester.id) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_TRANSFER_TARGET,
        message: 'Only the proposed recipient can accept this transfer.',
      });
    }

    const newOwner = file.pendingTransferTo;
    await this.fileRepository
      .createQueryBuilder()
      .update(FileEntity)
      .set({ creator: newOwner, pendingTransferTo: null })
      .where('id = :id', { id })
      .execute();

    await this.auditLogService.log(
      requester.id,
      id,
      AuditTargetType.file,
      'FILE_TRANSFER',
      `from=${file.creator.id} to=${newOwner.id}`,
    );

    const updated = await this.loadWithPending(id);
    return this.fileService.toResponse(updated, requester);
  }

  // 목적: 대기중인 이전 제안을 대상 유저 본인이 거절한다 — 소유권은 바뀌지 않는다.
  // 이유: acceptTransfer와 대칭인 경로. 거절도 동의 절차의 일부이므로 오직 대상 본인만 할 수
  //       있다(ADR 0050 D1).
  // 방법: acceptTransfer와 같은 대기 상태·권한 검사 → pendingTransferToUserId만 null로 되돌림,
  //       creator는 손대지 않음. 감사 로그 없음(D6 — 실제 소유권 변화가 없으므로).
  async rejectTransfer(
    id: number,
    requester: Requester,
  ): Promise<FileResponseDto> {
    const file = await this.loadWithPending(id);

    if (!file.pendingTransferTo) {
      throw new BadRequestException({
        code: ErrorCode.FILE_NO_PENDING_TRANSFER,
        message: 'This file has no pending transfer.',
      });
    }

    if (file.pendingTransferTo.id !== requester.id) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_TRANSFER_TARGET,
        message: 'Only the proposed recipient can reject this transfer.',
      });
    }

    await this.fileRepository
      .createQueryBuilder()
      .update(FileEntity)
      .set({ pendingTransferTo: null })
      .where('id = :id', { id })
      .execute();

    const updated = await this.loadWithPending(id);
    return this.fileService.toResponse(updated, requester);
  }

  // 목적: 제안자 본인이 아직 응답 없는 제안을 취소한다 — 소유권은 바뀌지 않는다.
  // 이유: 대상의 거절을 기다리지 않고 거둘 수 있어야 한다(ADR 0050 D1). admin은 일부러 제외한다 —
  //       제안은 두 당사자 사이의 합의 절차라 제3자가 취소할 근거가 없다. 막고 싶으면 파일을 삭제하면 된다.
  // 방법: creator 본인인지 확인(admin 우회 없음) → 대기중이 아니면 400 → pendingTransferTo만 null로.
  async cancelTransfer(
    id: number,
    requester: Requester,
  ): Promise<FileResponseDto> {
    const file = await this.loadWithPending(id);

    if (file.creator.id !== requester.id) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_OWNER,
        message: 'Only the file creator can cancel a transfer.',
      });
    }

    if (!file.pendingTransferTo) {
      throw new BadRequestException({
        code: ErrorCode.FILE_NO_PENDING_TRANSFER,
        message: 'This file has no pending transfer.',
      });
    }

    await this.fileRepository
      .createQueryBuilder()
      .update(FileEntity)
      .set({ pendingTransferTo: null })
      .where('id = :id', { id })
      .execute();

    const updated = await this.loadWithPending(id);
    return this.fileService.toResponse(updated, requester);
  }
}
