import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { UploadFileDto } from './dto/create-uploadFile.dto';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from 'backend/user/entity/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { FileEntity } from './entity/file.entity';
import { rename } from 'fs/promises';
import path, { join } from 'path';
import { UpdateFileDto } from './dto/update-uploadFile.dto';
import { FileResponseDto } from './dto/file-response.dto';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from 'backend/common/error-code';
import { ROLE_RANK, UserRole } from 'backend/auth/role/role';
import { AuditLogService } from 'backend/audit-log/audit-log.service';

// The acting user's identity + role (from the JWT), enough for creator-OR-admin checks.
interface Requester {
  id: number;
  role: UserRole;
}

@Injectable()
export class FileService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,

    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,

    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,

    private readonly auditLogService: AuditLogService,
  ) {}

  // A file is manageable by its creator, or by an admin/superadmin (RBAC, ADR 0013).
  private canManage(creatorId: number, requester: Requester): boolean {
    return (
      creatorId === requester.id ||
      ROLE_RANK[requester.role] >= ROLE_RANK[UserRole.admin]
    );
  }

  private toResponse(file: FileEntity): FileResponseDto {
    const baseUrl = this.configService.get<string>(
      'BASE_URL',
      'http://localhost:3000',
    );
    return {
      id: file.id,
      title: file.title,
      fileUrl: `${baseUrl}/${file.filePath}`,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      ...(file.creator && {
        creator: {
          id: file.creator.id,
          email: file.creator.email,
        },
      }),
    };
  }

  async getFiles(
    take: number,
    skip: number,
  ): Promise<[FileResponseDto[], number]> {
    const [files, count] = await this.fileRepository
      .createQueryBuilder('file')
      .leftJoinAndSelect('file.creator', 'creator')
      .take(take)
      .skip(skip)
      .getManyAndCount();
    return [files.map((f) => this.toResponse(f)), count];
  }

  async getFileById(id: number): Promise<FileResponseDto> {
    const file = await this.fileRepository
      .createQueryBuilder('file')
      .leftJoinAndSelect('file.creator', 'creator')
      .where('file.id = :id', { id })
      .getOne();

    if (!file) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }

    return this.toResponse(file);
  }

  async uploadFile(
    uploadFileDto: UploadFileDto,
    userId: number,
  ): Promise<FileResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let fileId: number;
    try {
      const temporaryFolder = join('file', 'temp');
      const uploadFolder = join('file', 'upload');

      // Title is unique — pre-check so the DB constraint surfaces as a typed
      // FILE_TITLE_TAKEN instead of being swallowed into a generic 500 (mirrors updateFile).
      const duplicatedTitle = await this.fileRepository.findOne({
        where: { title: uploadFileDto.title },
      });
      if (duplicatedTitle) {
        throw new BadRequestException({
          code: ErrorCode.FILE_TITLE_TAKEN,
          message: 'Title already in use.',
        });
      }

      const upload = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(FileEntity)
        .values({
          title: uploadFileDto.title,
          creator: { id: userId },
          filePath: path
            .normalize(join(uploadFolder, uploadFileDto.filePath))
            .replace('temp_', 'granted_')
            .replace(/\\/g, '/'),
        })
        .execute();

      const insertedId: unknown = upload.identifiers[0]?.id;
      if (typeof insertedId !== 'number') {
        throw new InternalServerErrorException({
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Transaction aborted.',
        });
      }
      fileId = insertedId;
      const newFilePath = uploadFileDto.filePath.replace('temp_', 'granted_');

      await rename(
        join(process.cwd(), temporaryFolder, uploadFileDto.filePath),
        join(process.cwd(), uploadFolder, newFilePath),
      );

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      // Preserve typed domain exceptions (e.g. FILE_TITLE_TAKEN); only opaque
      // failures collapse to a generic message so no internal detail leaks out.
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Transaction aborted.',
      });
    } finally {
      await queryRunner.release();
    }

    // Post-commit re-read stays outside the try: a read failure here must not
    // attempt a rollback of the already-committed transaction.
    const saved = await this.fileRepository.findOne({ where: { id: fileId } });
    if (!saved) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }
    return this.toResponse(saved);
  }

  async updateFile(
    id: number,
    updateFileDto: UpdateFileDto,
    requester: Requester,
  ): Promise<FileResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const file = await queryRunner.manager.findOne(FileEntity, {
        where: { id },
        relations: ['creator'],
      });

      if (!file) {
        throw new NotFoundException({
          code: ErrorCode.FILE_NOT_FOUND,
          message: 'No file found.',
        });
      }

      // Creator or admin may modify (including reassigning ownership via UpdateFileDto.userId).
      if (!this.canManage(file.creator.id, requester)) {
        throw new ForbiddenException({
          code: ErrorCode.FORBIDDEN_NOT_OWNER,
          message: 'Only the file creator or an admin can update this file.',
        });
      }

      const { title, userId, filePath } = updateFileDto;
      const updateFields: Partial<FileEntity> = {};

      if (title) {
        const duplicatedTitle = await this.fileRepository.findOne({
          where: { title },
        });
        if (duplicatedTitle) {
          throw new BadRequestException({
            code: ErrorCode.FILE_TITLE_TAKEN,
            message: 'Title already in use.',
          });
        }
        updateFields.title = title;
      }

      if (filePath) {
        if (filePath.startsWith('temp_')) {
          throw new BadRequestException({
            code: ErrorCode.FILE_INVALID_PATH,
            message: 'File must be in the upload folder.',
          });
        }
        if (filePath.startsWith('granted_')) {
          updateFields.filePath = filePath;
        } else {
          throw new BadRequestException({
            code: ErrorCode.FILE_INVALID_PATH,
            message: 'Attach the file again.',
          });
        }
      }

      if (userId) {
        const creator = await this.userRepository.findOne({
          where: { id: userId },
        });
        if (!creator) {
          throw new NotFoundException({
            code: ErrorCode.USER_NOT_FOUND,
            message: 'No user found.',
          });
        }
        updateFields.creator = creator;
      }

      await queryRunner.manager
        .createQueryBuilder()
        .update(FileEntity)
        .set(updateFields)
        .where('id = :id', { id })
        .execute();

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    // Post-commit re-read stays outside the try: a read failure here must not
    // attempt a rollback of the already-committed transaction.
    const updated = await this.fileRepository.findOne({
      where: { id },
      relations: ['creator'],
    });
    if (!updated) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }
    return this.toResponse(updated);
  }

  async deleteFile(id: number, requester: Requester): Promise<string> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['creator'],
    });

    if (!file) {
      throw new NotFoundException({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'No file found.',
      });
    }

    if (!this.canManage(file.creator.id, requester)) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_OWNER,
        message: 'Only the file creator or an admin can delete this file.',
      });
    }

    await this.fileRepository.delete(id);

    // Audit after the delete succeeds (side effect isolated from the delete).
    await this.auditLogService.log(requester.id, id, 'FILE_DELETE');

    return `File ${id} deleted.`;
  }
}
