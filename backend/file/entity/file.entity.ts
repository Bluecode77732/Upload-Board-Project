import { IsNotEmpty, IsString } from 'class-validator';
import { UserEntity } from 'backend/user/entity/user.entity';
import { FileVisibility } from './file-visibility.enum';
import { FileMediaType } from './file-media-type.enum';
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class FileEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ManyToOne(() => UserEntity, (user) => user.creator, {
    nullable: false,
    cascade: true,
  })
  creator!: UserEntity;

  @Column()
  @IsNotEmpty()
  @IsString()
  filePath!: string;

  // Which playback tag the content is (image/audio/video); server-derived from the
  // filePath extension at upload time, never client-supplied (ADR 0040 D2).
  @Column({ type: 'varchar' })
  mediaType!: FileMediaType;

  // Gates access to the stored bytes via GET /file/:id/content (ADR 0025 D1/D2).
  // Default private: a fresh upload is unreachable until the owner opts in.
  @Column({ type: 'varchar', default: FileVisibility.private })
  visibility!: FileVisibility;

  // Server-generated random opaque token (never a guessable id); set only while
  // visibility is 'unlisted', cleared otherwise. Rotation is the revocation mechanism
  // for a leaked link (ADR 0025 D3).
  @Column({ type: 'varchar', nullable: true })
  shareToken!: string | null;

  // Optional TTL on the current share token; null = no expiry (ADR 0025 D3).
  @Column({ type: 'timestamptz', nullable: true })
  shareExpiresAt!: Date | null;

  @CreateDateColumn()
  createdAt?: Date;

  @UpdateDateColumn()
  updatedAt?: Date;
}
