import { Controller, Post, Get, Body, UseGuards, Request, HttpStatus, Param, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiConsumes } from '@nestjs/swagger';
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
    @UseInterceptors(FileInterceptor('logo'))
    @ApiOperation({
        summary: 'Create new airdrop pool',
        description: 'Create a new airdrop pool with token X. Supports logo file upload or URL. Requires minimum 1,000,000 token X.'
    })
    @ApiConsumes('multipart/form-data')
    @ApiResponse({
        status: HttpStatus.OK,
        description: 'Pool created successfully',
        type: CreatePoolResponseDto
    })
    @ApiResponse({
        status: HttpStatus.BAD_REQUEST,
        description: 'Invalid data or insufficient balance'
    })
    @ApiResponse({
        status: HttpStatus.UNAUTHORIZED,
        description: 'Unauthorized access'
    })
    @ApiResponse({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        description: 'Server error'
    })
    async createPool(
        @Request() req: any, 
        @Body() createPoolDto: CreatePoolDto,
        @UploadedFile() logoFile?: Express.Multer.File
    ) {
        // Get wallet_id from JWT token
        const walletId = req.user.wallet_id;
        
        if (!walletId) {
            throw new Error('Wallet ID not found in token');
        }

        return await this.airdropsService.createPool(walletId, createPoolDto, logoFile);
    }

    @Post('stake-pool')
    @ApiOperation({
        summary: 'Stake into airdrop pool',
        description: 'Stake token X into an existing airdrop pool. Can stake multiple times.'
    })
    @ApiResponse({
        status: HttpStatus.OK,
        description: 'Stake pool successfully',
        type: StakePoolResponseDto
    })
    @ApiResponse({
        status: HttpStatus.BAD_REQUEST,
        description: 'Invalid data, pool not found, or insufficient balance'
    })
    @ApiResponse({
        status: HttpStatus.UNAUTHORIZED,
        description: 'Unauthorized access'
    })
    @ApiResponse({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        description: 'Server error'
    })
    async stakePool(@Request() req: any, @Body() stakePoolDto: StakePoolDto) {
        // Get wallet_id from JWT token
        const walletId = req.user.wallet_id;
        
        if (!walletId) {
            throw new Error('Wallet ID not found in token');
        }

        return await this.airdropsService.stakePool(walletId, stakePoolDto);
    }

    @Get('pools')
    @ApiOperation({
        summary: 'Get airdrop pools list',
        description: 'Get list of airdrop pools with filtering and sorting. Supports filtering by: all pools, created pools, joined pools.'
    })
    @ApiResponse({
        status: HttpStatus.OK,
        description: 'Get pools list successfully',
        type: GetPoolsResponseDto
    })
    @ApiResponse({
        status: HttpStatus.UNAUTHORIZED,
        description: 'Unauthorized access'
    })
    @ApiResponse({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        description: 'Server error'
    })
    async getPools(@Query() query: GetPoolsDto, @Request() req: any): Promise<GetPoolsResponseDto> {
        // Get wallet_id from JWT token
        const walletId = req.user.wallet_id;
        
        if (!walletId) {
            throw new Error('Wallet ID not found in token');
        }

        const pools = await this.airdropsService.getPools(walletId, query);

        return {
            success: true,
            message: 'Get pools list successfully',
            data: pools
        };
    }

    @Get('pool/:idOrSlug')
    @UseGuards(AirdropJwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get airdrop pool details',
        description: 'Get detailed information of an airdrop pool by ID or slug. If user is creator, will show additional members list.'
    })
    @ApiParam({
        name: 'idOrSlug',
        description: 'ID or slug of the pool (e.g., 1 or "my-airdrop-pool-1")',
        example: 'my-airdrop-pool-1'
    })
    @ApiResponse({
        status: HttpStatus.OK,
        description: 'Get pool details successfully',
        type: GetPoolDetailResponseDto
    })
    @ApiResponse({
        status: HttpStatus.BAD_REQUEST,
        description: 'Pool not found'
    })
    @ApiResponse({
        status: HttpStatus.UNAUTHORIZED,
        description: 'Unauthorized access'
    })
    @ApiResponse({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        description: 'Server error'
    })
    async getPoolDetail(
        @Param('idOrSlug') idOrSlug: string,
        @Query() query: GetPoolDetailDto,
        @Request() req: any
    ): Promise<GetPoolDetailResponseDto> {
        const walletId = req.user.wallet_id;
        
        if (!walletId) {
            throw new Error('Wallet ID not found in token');
        }

        const poolDetail = await this.airdropsService.getPoolDetailByIdOrSlug(
            idOrSlug,
            walletId,
            query
        );

        return {
            success: true,
            message: 'Get pool details successfully',
            data: poolDetail
        };
    }
} 