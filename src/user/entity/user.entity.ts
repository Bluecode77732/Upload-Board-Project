import { ApiHideProperty } from "@nestjs/swagger";
import { Exclude } from "class-transformer";
import { IsEmail, IsNotEmpty, IsString } from "class-validator";
import { FileEntity } from "src/file/entity/file.entity";
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class UserEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({
        unique: true,
    })
    @IsEmail()
    @IsString()
    @IsNotEmpty()
    email: string;
    
    @Column()
    @IsString()
    @IsNotEmpty()
    @Exclude({
        toPlainOnly: true,
    })
    password: string;

    // A one-to-many relation allows creating the type of relation where Entity1 can have multiple instances of Entity2, but Entity2 has only one Entity1. Entity2 is the owner of the relationship, and stores the id of Entity1 on its side of the relation.
    @OneToMany(
        () => FileEntity,
        (file) => file.creator,
    )
    creator: FileEntity[];

    @OneToMany(
        () => FileEntity,
        file => file.user,
    )
    files: FileEntity[];

    @CreateDateColumn()
    @ApiHideProperty()
    createdAt: Date;
    
    @UpdateDateColumn()
    @ApiHideProperty()
    updatedAt: Date;
}
