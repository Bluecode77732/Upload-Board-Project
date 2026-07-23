import { ApiHideProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { FileEntity } from 'src/file/entity/file.entity';
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
