import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class LoginDto {
    @IsEmail({}, { message: 'Please provide a valid email address' })
    email: string;

    @IsString({ message: 'Password must be a string' })
    password: string;
}
