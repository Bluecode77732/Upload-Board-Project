import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  Query,
  ClassSerializerInterceptor,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileService } from './file.service';
import { UploadFileDto } from './dto/create-uploadFile.dto';
import { UpdateFileDto } from './dto/update-uploadFile.dto';
import { GetFilesDto } from './dto/get-files.dto';
import { UserId } from 'src/user/decorator/userId.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';

@Controller('file')
@ApiTags('File API')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@UseInterceptors(ClassSerializerInterceptor)
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Get()
  getFiles(@Query() getFilesDto: GetFilesDto) {
    return this.fileService.getFiles(getFilesDto.take, getFilesDto.skip);
  }

  @Get(':id')
  getFileById(@Param('id', ParseIntPipe) id: number) {
    return this.fileService.getFileById(id);
  }

  @Post()
  uploadVideo(@Body() body: UploadFileDto, @UserId() userId: number) {
    return this.fileService.uploadFile(body, userId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateFileDto: UpdateFileDto,
    @UserId() userId: number,
  ) {
    return this.fileService.updateFile(id, updateFileDto, userId);
  }

  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number, @UserId() userId: number) {
    return this.fileService.deleteFile(id, userId);
  }
}
