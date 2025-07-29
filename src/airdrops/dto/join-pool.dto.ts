import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsNotEmpty, Min } from 'class-validator';

export class StakePoolDto {
    @ApiProperty({
        description: 'ID of the pool to stake',
        example: 1
    })
    @IsNumber()
    @IsNotEmpty()
    poolId: number;

    @ApiProperty({
        description: 'Amount of tokens to stake in the pool',
        example: 500000,
        minimum: 1
    })
    @IsNumber()
    @Min(1)
    stakeAmount: number;
} 