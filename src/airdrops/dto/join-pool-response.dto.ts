import { ApiProperty } from '@nestjs/swagger';

export class StakePoolResponseDto {
    @ApiProperty({
        description: 'Trạng thái thành công',
        example: true
    })
    success: boolean;

    @ApiProperty({
        description: 'Thông báo kết quả',
        example: 'Stake pool thành công'
    })
    message: string;

    @ApiProperty({
        description: 'Dữ liệu kết quả',
        type: 'object',
        properties: {
            joinId: { type: 'number', example: 1 },
            poolId: { type: 'number', example: 1 },
            stakeAmount: { type: 'number', example: 500000 },
            status: { type: 'string', example: 'active' },
            transactionHash: { type: 'string', example: '5J7X...abc123' }
        }
    })
    data: {
        joinId: number;
        poolId: number;
        stakeAmount: number;
        status: string;
        transactionHash: string | null;
    };
} 