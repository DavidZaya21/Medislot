import { Specialization } from "@prisma/client";
import { IsEnum, IsString, MaxLength, MinLength, IsEmail, IsOptional } from "class-validator";

export class DoctorListQueryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(Specialization)
  specialization?: Specialization;
}

export class CreateDoctorDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(255)
  password!: string;

  @IsEnum(Specialization)
  specialization!: Specialization;
}

export class UpdateDoctorDto {
  @IsEnum(Specialization)
  specialization!: Specialization;
}

export class DoctorAppointmentsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;
}
