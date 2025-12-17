import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString } from "class-validator";

export class CreateUserDto {

    @ApiProperty({
        description: "User Email",
        example: "x1@gmail.com",
        type: String,
    })
    @IsNotEmpty()
    @IsEmail()
    email: string;
    
    @ApiProperty({
        description: "User Password",
        example: "test@!$!13",
        type: String,
    })
    @IsNotEmpty()
    @IsString()
    password: string;
}
