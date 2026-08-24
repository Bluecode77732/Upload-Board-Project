// Purpose: append-only record of privileged actions (role changes, user/file deletes) for accountability.
// Usage: written by AuditLogService.log after the primary transaction commits; read by GET /audit-log (admin).
// Rationale: RBAC grants admins power over others' resources (ADR 0013) — those actions need an audit trail.

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuditTargetType } from './audit-target-type.enum';

// Filter-by-action + newest-first ordering is the only query shape (findAll).
@Index(['action', 'createdAt'])
@Entity()
export class AuditLogEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  // actorId/targetId are deliberately NOT foreign keys: hard-deleting a user must
  // not cascade away the audit trail that records the deletion.
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
