import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { UploadFileDto } from './dto/create-uploadFile.dto';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from 'src/user/entity/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { FileEntity } from './entity/file.entity';
import { rename } from 'fs/promises';
import path, { join } from 'path';
import { UpdateFileDto } from './dto/update-uploadFile.dto';
import { FileResponseDto } from './dto/file-response.dto';
import { ConfigService } from '@nestjs/config';


@Injectable()
export class FileService {

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,

    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,

    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) { };


  private toResponse(file: FileEntity): FileResponseDto {
    const baseUrl = this.configService.get<string>('BASE_URL', 'http://localhost:3000');
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


  async getFiles(): Promise<[FileResponseDto[], number]> {
    const [files, count] = await this.fileRepository.createQueryBuilder('file').getManyAndCount();
    return [files.map(f => this.toResponse(f)), count];
  };


  async getFileById(id: number): Promise<FileResponseDto> {
    const file = await this.fileRepository.createQueryBuilder('file')
      .leftJoinAndSelect('file.creator', 'creator')
      .where('file.id = :id', { id })
      .getOne();

    if (!file) {
      throw new NotFoundException("No file found.");
    }

    return this.toResponse(file);
  };


  async uploadFile(uploadFileDto: UploadFileDto, userId: number): Promise<FileResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const temporaryFolder = join('file', 'temp');
      const uploadFolder = join('file', 'upload');

      const upload = await queryRunner.manager.createQueryBuilder()
        .insert()
        .into(FileEntity)
        .values({
          title: uploadFileDto.title,
          creator: { id: userId },
          filePath: path.normalize(join(uploadFolder, uploadFileDto.filePath))
            .replace('temp_', 'granted_')
            .replace(/\\/g, '/'),
        })
        .execute();

      const fileId = upload.identifiers[0].id;
      const newFilePath = uploadFileDto.filePath.replace('temp_', 'granted_');

      await rename(
        join(process.cwd(), temporaryFolder, uploadFileDto.filePath),
        join(process.cwd(), uploadFolder, newFilePath),
      );

      await queryRunner.commitTransaction();

      const saved = await this.fileRepository.findOne({ where: { id: fileId } });
      return this.toResponse(saved!);

    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException("Transaction aborted.");

    } finally {
      await queryRunner.release();
    };
  }


  async updateFile(id: number, updateFileDto: UpdateFileDto): Promise<FileResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const file = await queryRunner.manager.findOne(FileEntity, { where: { id } });

      if (!file) {
        throw new NotFoundException("No file found.");
      };

      const { title, userId, filePath } = updateFileDto;
      const updateFields: Partial<FileEntity> = {};

      if (title) {
        const duplicatedTitle = await this.fileRepository.findOne({ where: { title } });
        if (duplicatedTitle) {
          throw new BadRequestException("Title already in use.");
        };
        updateFields.title = title;
      }

      if (filePath) {
        if (filePath.startsWith('temp_')) {
          throw new BadRequestException("File must be in the upload folder.");
        }
        if (filePath.startsWith('granted_')) {
          updateFields.filePath = filePath;
        } else {
          throw new BadRequestException("Attach the file again.");
        }
      };

      if (userId) {
        const creator = await this.userRepository.findOne({ where: { id: userId } });
        if (!creator) {
          throw new NotFoundException("No user found.");
        };
        updateFields.creator = creator;
      };

      await queryRunner.manager.createQueryBuilder()
        .update(FileEntity)
        .set(updateFields)
        .where('id = :id', { id })
        .execute();

      await queryRunner.commitTransaction();

      const updated = await this.fileRepository.findOne({ where: { id }, relations: ['creator'] });
      return this.toResponse(updated!);

    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    };
  }


  async deleteFile(id: number): Promise<string> {
    const file = await this.fileRepository.findOne({ where: { id } });

    if (!file) {
      throw new NotFoundException("No file found.");
    }

    await this.fileRepository.delete(id);

    return `File ${id} deleted.`;
  };
}
