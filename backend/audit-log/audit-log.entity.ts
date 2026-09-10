// 목적: 권한 필요 작업(역할 변경, 유저/파일 삭제)을 추적 가능하도록 추가 전용으로 기록한다.
// 사용처: AuditLogService.log가 주 트랜잭션 커밋 후 기록; GET /audit-log(관리자)가 조회.
// 근거: RBAC로 관리자가 타인 리소스에 권한을 갖게 되므로(ADR 0013) 그 행위에 감사 로그가 필요하다.

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuditTargetType } from './audit-target-type.enum';

// action 필터링 + 최신순 정렬이 유일한 조회 형태다(findAll).
@Index(['action', 'createdAt'])
@Entity()
export class AuditLogEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  // actorId/targetId는 의도적으로 외래키가 아니다: 유저를 하드 삭제해도
  // 그 삭제를 기록한 감사 로그가 함께 사라지면 안 되기 때문이다.
  @Column()
  actorId!: number;

  @Column({ type: 'int', nullable: true })
  targetId!: number | null;

  // 위 targetId가 어떤 종류를 가리키는지 나타내는 판별자다(ADR 0045). 이 칸이 없으면
  // 파일·게시글·댓글 id를 유저 id와 구별할 수 없어, userId 필터가 모든 targetId를
  // 유저 id로 읽는 오탐이 생긴다. nullable인 것은 targetId를 그대로 따르기 위해서이며,
  // 불변식은 "targetType IS NULL ⟺ targetId IS NULL" — 별개로 선택적인 필드가 아니다.
  // 숫자 코드가 아니라 varchar인 이유는 role/visibility/mediaType과 같다(ADR 0013).
  @Column({ type: 'varchar', nullable: true })
  targetType!: AuditTargetType | null;

  @Column()
  action!: string;

  @Column({ type: 'varchar', nullable: true })
  detail!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
