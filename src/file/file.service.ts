import { BadRequestException, ClassSerializerInterceptor, Injectable, InternalServerErrorException, NotFoundException, UseInterceptors } from '@nestjs/common';
import { UploadFileDto } from './dto/create-uploadFile.dto';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from 'src/user/entity/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { FileEntity } from './entity/file.entity';
import { rename } from 'fs/promises';
import path, { join } from 'path';
import { UpdateFileDto } from './dto/update-uploadFile.dto';


@Injectable()
@UseInterceptors(ClassSerializerInterceptor)
export class FileService {

  constructor(
    // Declaring TypeORM dependency injection pattern
    private readonly dataSource: DataSource,

    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,

    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) { };


  async getFiles() {
    return await this.fileRepository.createQueryBuilder('file')
      .getManyAndCount();
  };


  async getFileById(id: number) {
    const file = await this.fileRepository.createQueryBuilder('file')
      .leftJoinAndSelect('file.creator', 'creator')
      .where('file.id = :id', { id })
      .getOne();

    if (!file) {
      throw new NotFoundException("Where's your file?! There ain't file!");
    }

    return file;
  };


  async uploadFile(uploadFileDto: UploadFileDto, userId: number) {

    // Create QueryRunner, for transactional consistency to build and execute PostgreSQL queries
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    // Using try/catch for transaction-based operation to ensure data integrity, consistency, and prevent of leaks
    try {
      // Creates two relative file paths, to store file before processing.
      const temporaryFolder = join('file', 'temp');
      const uploadFolder = join('file', 'upload');

      // Creates a QueryBuilder, which allows to build and execute PostgreSQL queries.
      const upload = await queryRunner.manager.createQueryBuilder()
        .insert()
        .into(FileEntity)
        .values({
          title: uploadFileDto.title,
          creator: {
            id: userId,
          },
          // `path.normalize` is a Node.Js built-in function in 'path' module that standardize file path string to avoid path conflict when joining or comparing.
          // `join()` is also a Node.Js built-in utility function in 'path' module that uses correct OS file path separator, `/`(POSIX) or `\`(Windows), then concatenates path string and normalize string path.
          filePath: path.normalize(join(uploadFolder, uploadFileDto.filePath))
            .replace('temp_', 'granted_')
            .replace(/\\/g, '/'),
        })
        .execute();


      // Create file Id
      const fileId = upload.identifiers[0].id;

      // Verify upload file existence
      if (!upload) {
        throw new NotFoundException(`No Uploads Found.`);
      };

      // Replace file path for a label validation
      const newFilePath = uploadFileDto.filePath.replace('temp_', 'granted_');

      // Relocate file from 'temp' folder to 'upload' folder.
      await rename(
        join(process.cwd(), temporaryFolder, uploadFileDto.filePath),
        join(process.cwd(), uploadFolder, newFilePath),
      );

      // Commit Transaction
      await queryRunner.commitTransaction();

      console.log("Video Uploaded");

      return this.fileRepository.findOne({
        where: {
          id: fileId,
        },
      });

    } catch (error) {
      console.log(error);

      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException("Transaction Abort");

    } finally {
      await queryRunner.release();
    };
  }


  async updateFile(id: number, updateFileDto: UpdateFileDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    // Using try/catch for transaction-based operation to ensure data integrity, consistency, and prevent of leaks
    try {
      // Find File
      const file = await queryRunner.manager.findOne(FileEntity, {
        where: {
          id,
        },
      });

      // Verify File
      if (!file) {
        throw new NotFoundException("No File Found.");
      };

      // Extract Specific Arguments
      const { title, userId, filePath } = updateFileDto;

      // Title Update
      if (updateFileDto.title) {
        const duplicatedTitle = await this.fileRepository.findOne({
          where: {
            title: updateFileDto.title,
          },
        });
        
        if (duplicatedTitle) {
          throw new BadRequestException("The title is duplicated!");
        };
      };

      // Create Update Object
      const updateFields: Partial<FileEntity> = {};

      updateFields.title = title;

      // File path label validation
      if (filePath) {
        if (filePath.startsWith('temp_')) {
          // Throw error if the file doesn't exist in 'temp' folder
          throw new BadRequestException("The file must be in upload folder.");
        }
        if (filePath.startsWith(`granted_`)) {
          // Proceed upload if file exist in 'upload' folder
          updateFields.filePath = filePath;
        }
        else {
          throw new BadRequestException("Attach file again.");
        }
      };

      // userId Update
      if (userId) {
        const creator = await this.userRepository.findOne({
          where: { id: userId },
        });

        if (!creator) {
          throw new NotFoundException("No User Found.");
        };

        updateFields.creator = creator;
      };

      // Total Update
      await queryRunner.manager.createQueryBuilder()
        .update(FileEntity)
        .set(updateFields)
        .where('id = :id', { id })
        .execute();

      // Commit Transaction 
      await queryRunner.commitTransaction();

      // Return Update Result
      return await this.fileRepository.findOne({
        where: {
          id,
        },
        relations: ['creator'],
      });

    } catch (error) {
      // ? It rollbacks the changes were made to start all over again.
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      //? It releases manually occupied DB connections by queryRunner.
      await queryRunner.release();
    };
  }


  async deleteFile(id: number) {
    const file = await this.fileRepository.findOne({
      where: {
        id,
      },
    });

    if (!file) {
      throw new NotFoundException("No File Found.");
    }

    await this.fileRepository.delete(id);

    return `The file ${id} is deleted`;
  };
}
