import { IsNotEmpty, IsString } from "class-validator";
import { UserEntity } from "src/user/entity/user.entity";
import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class FileEntity {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ unique: true })
    @IsString()
    @IsNotEmpty()
    title!: string;

    @ManyToOne(
        () => UserEntity,
        (user) => user.creator,
        {
            nullable: false,
            cascade: true,
        }
    )
    creator!: UserEntity;

    @Column()
    @IsNotEmpty()
    filePath!: string;

    @CreateDateColumn()
    createdAt?: Date;

    @UpdateDateColumn()
    updatedAt?: Date;
}
