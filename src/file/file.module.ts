import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { FileController } from './file.controller';
import { UserEntity } from 'src/user/entity/user.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileEntity } from './entity/file.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FileEntity,
      UserEntity,
    ]),
  ],
  controllers: [FileController],
  providers: [FileService],
})
export class FileModule {};
