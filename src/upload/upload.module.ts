import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { MulterModule } from '@nestjs/platform-express';
import { join } from 'node:path';
import { diskStorage } from 'multer';
import { v4 } from 'uuid';

@Module({
    imports: [
        MulterModule.register({
            storage: diskStorage({
                // `join()` is an utility function that disinguishes OS file path between `/` or `\`.
                destination: join(process.cwd(), 'file', 'temp'),
                // To make this function callable, require those parameters: req, file
                filename: (req, file, cb) => {
                    const split = file.originalname.split('.');

                    let tempLabel = 'temp';
                    let fileType = 'mp4';

                    if (split.length > 1) {
                        fileType = split[split.length - 1];
                    }

                    cb(null, `${tempLabel}_${v4()}_${Date.now()}.${fileType}`);
                }
            }),
        }),
    ],
    controllers: [UploadController],
})
export class UploadModule { }
