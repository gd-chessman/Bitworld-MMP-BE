import { IsString, IsNumber, IsNotEmpty, Min, IsOptional, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePoolDto {
    @ApiProperty({
        description: 'Tên của airdrop pool',
        example: 'My Airdrop Pool'
    })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({
        description: 'Logo URL của pool (hỗ trợ URL hoặc file upload)',
        example: 'https://example.com/logo.png',
        required: false
    })
    @IsOptional()
    @IsString()
    @IsUrl({}, { message: 'Logo phải là URL hợp lệ' })
    logo?: string;

    @ApiProperty({
        description: 'Mô tả chi tiết về pool',
        example: 'This is a description of the airdrop pool'
    })
    @IsString()
    @IsOptional()
    describe?: string;

    @ApiProperty({
        description: 'Số lượng token X để khởi tạo pool (tối thiểu 1,000,000)',
        example: 1000000,
        minimum: 1000000
    })
    @IsNumber()
    @Min(1000000, { message: 'Số lượng khởi tạo phải tối thiểu là 1,000,000' })
    initialAmount: number;
} 