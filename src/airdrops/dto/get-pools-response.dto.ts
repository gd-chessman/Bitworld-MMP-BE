import { ApiProperty } from '@nestjs/swagger';

export class PoolInfoDto {
    @ApiProperty({
        description: 'ID của pool',
        example: 1
    })
    poolId: number;

    @ApiProperty({
        description: 'Tên pool',
        example: 'My Airdrop Pool'
    })
    name: string;

    @ApiProperty({
        description: 'Slug của pool',
        example: 'my-airdrop-pool-1'
    })
    slug: string;

    @ApiProperty({
        description: 'Logo của pool',
        example: 'https://example.com/logo.png'
    })
    logo: string;

    @ApiProperty({
        description: 'Mô tả pool',
        example: 'Mô tả chi tiết về pool'
    })
    describe: string;

    @ApiProperty({
        description: 'Số lượng member tham gia',
        example: 25
    })
    memberCount: number;

    @ApiProperty({
        description: 'Tổng volume trong pool',
        example: 5000000
    })
    totalVolume: number;

    @ApiProperty({
        description: 'Ngày tạo pool',
        example: '2024-01-15T10:30:00.000Z'
    })
    creationDate: Date;

    @ApiProperty({
        description: 'Ngày kết thúc pool',
        example: '2025-01-15T10:30:00.000Z'
    })
    endDate: Date;

    @ApiProperty({
        description: 'Trạng thái pool',
        example: 'active',
        enum: ['pending', 'active', 'end', 'error']
    })
    status: string;

    @ApiProperty({
        description: 'Thông tin stake của user hiện tại (nếu có)',
        required: false
    })
    userStakeInfo?: {
        isCreator: boolean;
        joinStatus: string;
        joinDate: Date;
        totalStaked: number;
    };
}

export class GetPoolsResponseDto {
    @ApiProperty({
        description: 'Trạng thái thành công',
        example: true
    })
    success: boolean;

    @ApiProperty({
        description: 'Thông báo kết quả',
        example: 'Lấy danh sách pool thành công'
    })
    message: string;

    @ApiProperty({
        description: 'Dữ liệu danh sách pool',
        type: [PoolInfoDto]
    })
    data: PoolInfoDto[];
} 