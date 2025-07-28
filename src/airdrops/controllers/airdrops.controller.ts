import { Controller, Post, Get, Body, UseGuards, Request, HttpStatus, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AirdropJwtAuthGuard } from '../guards/airdrop-jwt-auth.guard';
import { AirdropsService } from '../services/airdrops.service';
import { CreatePoolDto } from '../dto/create-pool.dto';
import { CreatePoolResponseDto } from '../dto/create-pool-response.dto';
import { StakePoolDto } from '../dto/join-pool.dto';
import { StakePoolResponseDto } from '../dto/join-pool-response.dto';
import { GetPoolsResponseDto } from '../dto/get-pools-response.dto';
import { GetPoolDetailResponseDto } from '../dto/get-pool-detail-response.dto';
import { GetPoolDetailDto } from '../dto/get-pool-detail.dto';
import { GetPoolsDto } from '../dto/get-pools.dto';

@ApiTags('Airdrops')
@Controller('airdrops')
@UseGuards(AirdropJwtAuthGuard)
@ApiBearerAuth()
export class AirdropsController {
    constructor(private readonly airdropsService: AirdropsService) {}

    @Post('create-pool')
    @ApiOperation({
        summary: 'Tạo airdrop pool mới',
        description: 'Tạo một airdrop pool mới với token X. Yêu cầu số lượng tối thiểu 1,000,000 token X.'
    })
    @ApiResponse({
        status: HttpStatus.OK,
        description: 'Tạo pool thành công',
        type: CreatePoolResponseDto
    })
    @ApiResponse({
        status: HttpStatus.BAD_REQUEST,
        description: 'Dữ liệu không hợp lệ hoặc số dư không đủ'
    })
    @ApiResponse({
        status: HttpStatus.UNAUTHORIZED,
        description: 'Không có quyền truy cập'
    })
    @ApiResponse({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        description: 'Lỗi server'
    })
    async createPool(@Request() req: any, @Body() createPoolDto: CreatePoolDto) {
        // Lấy wallet_id từ JWT token
        const walletId = req.user.wallet_id;
        
        if (!walletId) {
            throw new Error('Không tìm thấy wallet_id trong token');
        }

        return await this.airdropsService.createPool(walletId, createPoolDto);
    }

    @Post('stake-pool')
    @ApiOperation({
        summary: 'Stake vào airdrop pool',
        description: 'Stake token X vào một airdrop pool đã tồn tại. Có thể stake nhiều lần.'
    })
    @ApiResponse({
        status: HttpStatus.OK,
        description: 'Stake pool thành công',
        type: StakePoolResponseDto
    })
    @ApiResponse({
        status: HttpStatus.BAD_REQUEST,
        description: 'Dữ liệu không hợp lệ, pool không tồn tại, hoặc số dư không đủ'
    })
    @ApiResponse({
        status: HttpStatus.UNAUTHORIZED,
        description: 'Không có quyền truy cập'
    })
    @ApiResponse({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        description: 'Lỗi server'
    })
    async stakePool(@Request() req: any, @Body() stakePoolDto: StakePoolDto) {
        // Lấy wallet_id từ JWT token
        const walletId = req.user.wallet_id;
        
        if (!walletId) {
            throw new Error('Không tìm thấy wallet_id trong token');
        }

        return await this.airdropsService.stakePool(walletId, stakePoolDto);
    }

    @Get('pools')
    @ApiOperation({
        summary: 'Lấy danh sách airdrop pools',
        description: 'Lấy danh sách tất cả các airdrop pools đang hoạt động với thông tin chi tiết. Hỗ trợ sắp xếp theo nhiều trường.'
    })
    @ApiResponse({
        status: HttpStatus.OK,
        description: 'Lấy danh sách pool thành công',
        type: GetPoolsResponseDto
    })
    @ApiResponse({
        status: HttpStatus.UNAUTHORIZED,
        description: 'Không có quyền truy cập'
    })
    @ApiResponse({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        description: 'Lỗi server'
    })
    async getPools(@Query() query: GetPoolsDto, @Request() req: any): Promise<GetPoolsResponseDto> {
        // Lấy wallet_id từ JWT token
        const walletId = req.user.wallet_id;
        
        if (!walletId) {
            throw new Error('Không tìm thấy wallet_id trong token');
        }

        const pools = await this.airdropsService.getPools(walletId, query);

        return {
            success: true,
            message: 'Lấy danh sách pool thành công',
            data: pools
        };
    }

    @Get('pool/:id')
    @UseGuards(AirdropJwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Lấy thông tin chi tiết airdrop pool',
        description: 'Lấy thông tin chi tiết của một airdrop pool. Nếu user là creator, sẽ hiển thị thêm danh sách members.'
    })
    @ApiResponse({
        status: HttpStatus.OK,
        description: 'Lấy thông tin pool thành công',
        type: GetPoolDetailResponseDto
    })
    @ApiResponse({
        status: HttpStatus.BAD_REQUEST,
        description: 'Pool không tồn tại'
    })
    @ApiResponse({
        status: HttpStatus.UNAUTHORIZED,
        description: 'Không có quyền truy cập'
    })
    @ApiResponse({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        description: 'Lỗi server'
    })
    async getPoolDetail(
        @Param('id') poolId: string,
        @Query() query: GetPoolDetailDto,
        @Request() req: any
    ): Promise<GetPoolDetailResponseDto> {
        const walletId = req.user.wallet_id;
        
        if (!walletId) {
            throw new Error('Không tìm thấy wallet_id trong token');
        }

        const poolDetail = await this.airdropsService.getPoolDetail(
            parseInt(poolId),
            walletId,
            query
        );

        return {
            success: true,
            message: 'Lấy thông tin pool thành công',
            data: poolDetail
        };
    }
} 