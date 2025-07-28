import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsNotEmpty, Min } from 'class-validator';

export class StakePoolDto {
    @ApiProperty({
        description: 'ID của pool muốn stake',
        example: 1
    })
    @IsNumber()
    @IsNotEmpty()
    poolId: number;

    @ApiProperty({
        description: 'Số lượng token stake vào pool',
        example: 500000,
        minimum: 1
    })
    @IsNumber()
    @Min(1)
    stakeAmount: number;
} 