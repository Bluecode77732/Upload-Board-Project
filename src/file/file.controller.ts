import { Controller, Get, Post, Body, Patch, Param, Delete, UseInterceptors, UploadedFile, UploadedFiles, ParseIntPipe, Req, Request, ClassSerializerInterceptor, UseGuards } from '@nestjs/common';
import { FileService } from './file.service';
import { UploadFileDto } from './dto/create-uploadFile.dto';
import { UserId } from 'src/user/decorator/userId.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';

@Controller('file')
@ApiTags("File API")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@UseInterceptors(ClassSerializerInterceptor)
export class FileController {
  constructor(
    private readonly fileService: FileService,
  ) { };
  
  
  @Get()
  getFiles() {
    return this.fileService.getFiles();
  };


  @Get(':id')
  getFileById(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.fileService.getFileById(id);
  };


  @Post('uploadFile')
  uploadVideo(
    @Body() body: UploadFileDto,
    @UserId() userId: number,
  ) {
    return this.fileService.uploadFile(body, userId);
  }


  @Patch('patch/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateFileDto: UploadFileDto,
  ) {
    return this.fileService.updateFile(id, updateFileDto);
  }


  @Delete('delete/:id')
  delete(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.fileService.deleteFile(id);
  }
}
