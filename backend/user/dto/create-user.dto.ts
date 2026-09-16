import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({
    description: '유저 이메일. (User Email.)',
    example: 'x@gmail.com',
    type: String,
  })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({
    description: '유저 비밀번호. (User Password.)',
    example: 'test@!$!13',
    type: String,
  })
  @IsNotEmpty()
  @IsString()
  password: string;
}
