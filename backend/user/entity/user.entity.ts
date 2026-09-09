import { ApiHideProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { FileEntity } from 'backend/file/entity/file.entity';
import { UserRole } from 'backend/auth/role/role';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class UserEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  @IsEmail()
  @IsString()
  @IsNotEmpty()
  email!: string;

  @Column()
  @IsString()
  @IsNotEmpty()
  @Exclude({ toPlainOnly: true })
  password!: string;

  // RBAC 등급 (ADR 0013). 오직 서버만 부여한다 — UpdateUserDto에는 role 필드가 없어서
  // 화이트리스트 파이프가 클라이언트의 설정 시도를 모두 걸러낸다. PATCH /user/:id/role
  // (superadmin 전용)이 이를 바꾸는 유일한 경로다.
  @Column({ type: 'varchar', default: UserRole.user })
  role!: UserRole;

  // 현재 refresh token의 SHA-256 해시 (rotation/재사용 탐지 — ADR 0012); null이면 활성 세션 없음.
  @Column({ type: 'varchar', nullable: true })
  @Exclude({ toPlainOnly: true })
  @ApiHideProperty()
  refreshTokenHash!: string | null;

  @OneToMany(() => FileEntity, (file) => file.creator)
  creator!: FileEntity[];

  @CreateDateColumn()
  @ApiHideProperty()
  createdAt!: Date;

  @UpdateDateColumn()
  @ApiHideProperty()
  updatedAt!: Date;
}
