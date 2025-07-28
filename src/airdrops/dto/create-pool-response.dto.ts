import { ApiProperty } from '@nestjs/swagger';

export class CreatePoolResponseDto {
    @ApiProperty({
        description: 'Trạng thái thành công',
        example: true
    })
    success: boolean;

    @ApiProperty({
        description: 'Thông báo',
        example: 'Tạo pool thành công'
    })
    message: string;

    @ApiProperty({
        description: 'Dữ liệu pool được tạo',
        example: {
            poolId: 1,
            name: 'My Airdrop Pool',
            slug: 'my-airdrop-pool-1',
            status: 'active',
            initialAmount: 1000000
        }
    })
    data?: {
        poolId: number;
        name: string;
        slug: string;
        logo: string;
        status: string;
        initialAmount: number;
        transactionHash?: string;
    };
} 