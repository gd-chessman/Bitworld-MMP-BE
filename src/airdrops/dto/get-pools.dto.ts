import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsEnum } from 'class-validator';

export enum PoolSortField {
    CREATION_DATE = 'creationDate',
    NAME = 'name',
    MEMBER_COUNT = 'memberCount',
    TOTAL_VOLUME = 'totalVolume',
    END_DATE = 'endDate'
}

export enum PoolSortOrder {
    ASC = 'asc',
    DESC = 'desc'
}

export enum PoolFilterType {
    ALL = 'all',
    CREATED = 'created',
    JOINED = 'joined'
}

export class GetPoolsDto {
    @ApiProperty({
        description: 'Bộ lọc loại pool',
        enum: PoolFilterType,
        required: false,
        example: PoolFilterType.ALL,
        default: PoolFilterType.ALL
    })
    @IsOptional()
    @IsEnum(PoolFilterType)
    filterType?: PoolFilterType = PoolFilterType.ALL;

    @ApiProperty({
        description: 'Trường để sắp xếp danh sách pools',
        enum: PoolSortField,
        required: false,
        example: PoolSortField.CREATION_DATE
    })
    @IsOptional()
    @IsEnum(PoolSortField)
    sortBy?: PoolSortField;

    @ApiProperty({
        description: 'Thứ tự sắp xếp',
        enum: PoolSortOrder,
        required: false,
        example: PoolSortOrder.DESC
    })
    @IsOptional()
    @IsEnum(PoolSortOrder)
    sortOrder?: PoolSortOrder;
} 