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

  // RBAC tier (ADR 0013). Server-assigned only — UpdateUserDto has no role field,
  // so the whitelist pipe strips any client attempt to set it. PATCH /user/:id/role
  // (superadmin) is the sole mutation path.
  @Column({ type: 'varchar', default: UserRole.user })
  role!: UserRole;

  // SHA-256 of the current refresh token (rotation/reuse detection — ADR 0012); null = no active session.
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
