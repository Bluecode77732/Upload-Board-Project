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

  @Column()
  action!: string;

  @Column({ type: 'varchar', nullable: true })
  detail!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
