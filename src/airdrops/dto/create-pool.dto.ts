import { IsString, IsNumber, IsNotEmpty, Min, IsOptional, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePoolDto {
    @ApiProperty({
        description: 'Name of the airdrop pool',
        example: 'My Airdrop Pool'
    })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({
        description: 'Logo URL of the pool (supports URL or file upload)',
        example: 'https://example.com/logo.png',
        required: false
    })
    @IsOptional()
    @IsString()
    @IsUrl({}, { message: 'Logo must be a valid URL' })
    logo?: string;

    @ApiProperty({
        description: 'Detailed description of the pool',
        example: 'This is a description of the airdrop pool'
    })
    @IsString()
    @IsOptional()
    describe?: string;

    @ApiProperty({
        description: 'Amount of token X to initialize pool (minimum 1,000,000)',
        example: 1000000,
        minimum: 1000000
    })
    @IsNumber()
    @Min(1000000, { message: 'Initial amount must be at least 1,000,000' })
    initialAmount: number;
} 