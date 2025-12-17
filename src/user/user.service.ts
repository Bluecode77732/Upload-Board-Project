import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UserService {

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,

    private readonly configService: ConfigService,
  ) { };


  async create(createUserDto: CreateUserDto) {

    const { email, password } = createUserDto;

    const user = await this.userRepository.findOne({
      where: {
        email,
      },
    });

    if (user) {
      throw new BadRequestException('Registration failed');
    };


    // Hashing user password
    const hash = await bcrypt.hash(password, this.configService.getOrThrow<number>("HASH_ROUNDS"));


    await this.userRepository.save({
      email,
      password: hash,
    });

    return await this.userRepository.findOne({
      where: {
        email,
      },
    });
  };


  async findAll() {
    return await this.userRepository.findAndCount();
  };


  async findOne(id: number) {
    const user = await this.userRepository.findOne({
      where: {
        id,
      },
    });

    if (!user) {
      throw new NotFoundException(`User Cannot Found`);
    };

    return user;
  }


  async update(id: number, updateUserDto: UpdateUserDto) {

    // Bring password from DTO
    const { password } = updateUserDto;

    // Find the user by id
    const user = await this.userRepository.findOne({
      where: {
        id,
      },
    });

    // Checking the user 
    if (!user) {
      throw new NotFoundException('No User Found.');
    };
    
    // Password verify
    if (password) {

      // Password
      const hash = await bcrypt.hash(password, this.configService.getOrThrow<number>("HASH_ROUNDS"));

      // Apply hash to password
      updateUserDto.password = hash;
    };

    // Update
    await this.userRepository.update(
      { id },
      {
        email: updateUserDto.email,
        password: updateUserDto.password,
      },
    );

    // Returning result to client
    return await this.userRepository.findOne({
      where: {
        id,
      },
    });
  }


  async remove(id: number) {
    const user = await this.userRepository.findOne({
      where: {
        id,
      },
    });

    if (!user) {
      throw new NotFoundException(`User Not Found.`);
    }

    await this.userRepository.delete(id);

    return `The user ${id} is deleted`;
  };
}
