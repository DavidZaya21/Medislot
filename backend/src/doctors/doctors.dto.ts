import { IsString, MaxLength, MinLength, IsEmail, IsOptional, IsInt, Min } from "class-validator";

export class DoctorListQueryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  specialization?: string;
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

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  specialization!: string;
}

export class UpdateDoctorDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  specialization!: string;
}

export class DoctorAppointmentsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;
}
