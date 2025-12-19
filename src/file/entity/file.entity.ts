import { Expose, Transform } from "class-transformer";
import { IsNotEmpty, IsString } from "class-validator";
import { UserEntity } from "src/user/entity/user.entity";
import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class FileEntity {
    @PrimaryGeneratedColumn()
    id: number;

    // Create a column in the table
    @Column({
        unique: true,
    })
    @IsString()
    @IsNotEmpty()
    title: string;

    // A `many-to-one` relation allows creating the type of relation where Entity1 can have a single instance of Entity2
    @ManyToOne(
        () => UserEntity,
        (user) => user.creator,
        {
            // Block null value in related table
            nullable: false,
            // Automatically allow to insert or update data into related entities
            cascade: true,
        }
    )
    creator: UserEntity;

    @ManyToOne(
        () => UserEntity,
        user => user.id
    )
    user: UserEntity;

    @Column()
    // Argument to be able to show up as result
    @Expose()
    @IsNotEmpty()
    // Automatically processes when requested data during conversion as DTO
    @Transform(({value}) => `http://localhost:3000/${value}`)
    filePath: string;

    @CreateDateColumn()
    createdAt?: Date;

    @UpdateDateColumn()
    updatedAt?: Date;
}
