import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsNumber, IsString } from "class-validator";


export class UploadFileDto {
    @IsString()
    @IsNotEmpty()
    @ApiProperty({
        description: "File title",
        example: "Name the title for each time with different titles, or it will have transaction abort!.",
    })
    title: string;
    
    @IsNumber()
    @IsNotEmpty()
    @ApiProperty({
        description: "User ID",
        example: 1,
    })
    userId: number;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({
        description: "File Path. Insert A Single File In This Prompt.",
        example: "temp_67ff0c79-a1f0-4d4f-865c-681af920378d_1764581241716.mp4",
    })
    filePath: string;
}
