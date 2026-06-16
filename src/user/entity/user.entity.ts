import { ApiHideProperty } from "@nestjs/swagger";
import { Exclude } from "class-transformer";
import { IsEmail, IsNotEmpty, IsString } from "class-validator";
import { FileEntity } from "src/file/entity/file.entity";
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class UserEntity {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ unique: true })
    @IsEmail()
    @IsString()
    @IsNotEmpty()
    email!: string;

    @Column()
    @IsString()
    @IsNotEmpty()
    @Exclude({ toPlainOnly: true })
    password!: string;

    @OneToMany(
        () => FileEntity,
        (file) => file.creator,
    )
    creator!: FileEntity[];

    @CreateDateColumn()
    @ApiHideProperty()
    createdAt!: Date;

    @UpdateDateColumn()
    @ApiHideProperty()
    updatedAt!: Date;
}
