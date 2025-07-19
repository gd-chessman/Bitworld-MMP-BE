import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe, Query, UseGuards, Request, Res, HttpCode, UseInterceptors, UploadedFile } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CategoryPrioritize, CategoryStatus } from '../solana/entities/solana-list-categories-token.entity';
import { Setting } from './entities/setting.entity';
import { AdminGateway } from './admin.gateway';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Response } from 'express';
import { JwtAuthAdminGuard } from './guards/jwt-auth.guard';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import { ReferentSetting } from '../referral/entities/referent-setting.entity';
import { WalletReferent } from '../referral/entities/wallet-referent.entity';
import { ReferentLevelReward } from '../referral/entities/referent-level-rewards.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { ConflictException, HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminGateway: AdminGateway
  ) {}

  // @Post('register')
  // register(@Body() registerDto: RegisterDto) {
  //   return this.adminService.register(registerDto);
  // }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.adminService.login(loginDto, response);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) response: Response) {
    return this.adminService.logout(response);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('me')
  @ApiOperation({ summary: 'Get admin profile' })
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  getProfile(@Request() req): ProfileResponseDto {
    const { password, ...profile } = req.user;
    return profile;
  }

  @UseGuards(JwtAuthAdminGuard)
  @Put('change-password')
  @HttpCode(200)
  async changePassword(
    @Request() req,
    @Body() changePasswordDto: ChangePasswordDto
  ) {
    return this.adminService.changePassword(
      req.user.username,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword
    );
  }

  // Setting endpoints
  @Get('setting')
  async getSetting(): Promise<Setting> {
    return this.adminService.getSetting();
  }

  @UseGuards(JwtAuthAdminGuard)
  @Put('setting')
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: diskStorage({
        destination: './public/uploads',
        filename: (req, file, cb) => {
          cb(null, `logo${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async updateSetting(
    @Body() data: {
      appName?: string;
      telegramBot?: string;
    },
    @UploadedFile() file: any,
  ): Promise<Setting> {
    try {
      // Get current settings to check for existing logo
      const currentSettings = await this.adminService.getSetting();
      
      // If there's a new file and an old logo exists, delete the old file
      if (file && currentSettings?.logo) {
        const oldLogoPath = path.join(process.cwd(), 'public', 'uploads', path.basename(currentSettings.logo));
        if (fs.existsSync(oldLogoPath)) {
          fs.unlinkSync(oldLogoPath);
        }
      }

      const updateData = {
        ...data,
        logo: file ? `/uploads/logo${extname(file.originalname)}` : currentSettings?.logo,
      };
      return this.adminService.updateSetting(updateData);
    } catch (error) {
      // If there's an error and we uploaded a new file, try to delete it
      if (file) {
        const newLogoPath = path.join(process.cwd(), 'public', 'uploads', `logo${extname(file.originalname)}`);
        if (fs.existsSync(newLogoPath)) {
          fs.unlinkSync(newLogoPath);
        }
      }
      throw error;
    }
  }

  // Category endpoints
  @UseGuards(JwtAuthAdminGuard)
  @Get('categories-token')
  async getAllCategories(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 100,
    @Query('search') search?: string
  ): Promise<{ data: CategoryResponseDto[]; total: number; page: number; limit: number }> {
    return this.adminService.getAllCategories(page, limit, search);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Post('categories-token')
  async createCategory(
    @Body() data: {
      slct_name: string;
      slct_slug: string;
    }
  ): Promise<CategoryResponseDto> {
    return this.adminService.createCategory(data);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Put('categories-token/:id')
  async updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: {
      slct_name?: string;
      slct_slug?: string;
      slct_prioritize?: CategoryPrioritize;
      sltc_status?: CategoryStatus;
    }
  ): Promise<CategoryResponseDto> {
    return this.adminService.updateCategory(id, data);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Delete('categories-token/:id')
  async deleteCategory(@Param('id', ParseIntPipe) id: number): Promise<{ message: string }> {
    return this.adminService.deleteCategory(id);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('online-stats')
  @ApiOperation({ summary: 'Get online users statistics' })
  @ApiResponse({ status: 200, description: 'Returns online users statistics' })
  async getOnlineStats(@Request() req) {
    return this.adminGateway.handleGetOnlineStats(req.user);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('list-wallets')
  @ApiOperation({ summary: 'Get list of user wallets' })
  @ApiResponse({ status: 200, description: 'Returns list of user wallets with pagination' })
  async getListWallets(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 100,
    @Query('search') search?: string,
    @Query('wallet_auth') wallet_auth?: string,
    @Query('wallet_type') wallet_type?: 'main' | 'all'
  ): Promise<{ data: ListWallet[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    return this.adminService.getListWallets(page, limit, search, wallet_auth, wallet_type);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Put('list-wallets/:id/auth')
  @ApiOperation({ summary: 'Update wallet auth type' })
  @ApiResponse({ status: 200, description: 'Returns success message' })
  async updateWalletAuth(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { wallet_auth: 'member' | 'master' }
  ): Promise<{ message: string }> {
    return this.adminService.updateWalletAuth(id, data.wallet_auth);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('referent-settings')
  @ApiOperation({ summary: 'Get referent setting' })
  @ApiResponse({ status: 200, type: ReferentSetting })
  async getReferentSettings(): Promise<ReferentSetting> {
    return this.adminService.getReferentSettings();
  }

  @UseGuards(JwtAuthAdminGuard)
  @Put('referent-settings')
  @ApiOperation({ summary: 'Update referent setting' })
  @ApiResponse({ status: 200, type: ReferentSetting })
  async updateReferentSettings(
    @Body() data: {
      rs_ref_level?: number;
    }
  ): Promise<ReferentSetting> {
    return this.adminService.updateReferentSettings(data);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('referent-level-rewards')
  @ApiOperation({ summary: 'Get all referent level rewards' })
  @ApiResponse({ status: 200, type: [ReferentLevelReward] })
  async getReferentLevelRewards(): Promise<ReferentLevelReward[]> {
    return this.adminService.getReferentLevelRewards();
  }

  @UseGuards(JwtAuthAdminGuard)
  @Put('referent-level-rewards/:id')
  @ApiOperation({ summary: 'Update referent level reward percentage' })
  @ApiResponse({ status: 200, type: ReferentLevelReward })
  async updateReferentLevelReward(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { rlr_percentage: number }
  ): Promise<ReferentLevelReward> {
    return this.adminService.updateReferentLevelReward(id, data.rlr_percentage);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('wallet-referents')
  @ApiOperation({ summary: 'Get list of wallet referents' })
  @ApiResponse({ status: 200, description: 'Returns list of wallet referents with pagination' })
  async getWalletReferents(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 100,
    @Query('search') search?: string
  ): Promise<{ data: WalletReferent[]; total: number; page: number; limit: number }> {
    return this.adminService.getWalletReferents(page, limit, search);
  }

  // BG Affiliate Management Endpoints
  @UseGuards(JwtAuthAdminGuard)
  @Post('bg-affiliate')
  @ApiOperation({ summary: 'Create new BG affiliate (allows wallets in traditional referral system, but not in other BG systems)' })
  @ApiResponse({ status: 201, description: 'BG affiliate created successfully' })
  @ApiResponse({ status: 400, description: 'Wallet already in BG affiliate system or invalid commission percent' })
  async createBgAffiliate(
    @Body() data: {
      walletId: number;
      totalCommissionPercent: number;
    }
  ): Promise<{ message: string; treeId: number; totalCommissionPercent: number; walletInfo: any }> {
    const result = await this.adminService.createBgAffiliate(data);
    
    // Lấy thông tin wallet để trả về
    const wallet = await this.adminService.getWalletInfo(data.walletId);
    
    return {
      ...result,
      walletInfo: wallet
    };
  }

  @UseGuards(JwtAuthAdminGuard)
  @Put('bg-affiliate/commission')
  @ApiOperation({ summary: 'Admin update root BG commission (only root BG, with minimum check)' })
  @ApiResponse({ status: 200, description: 'Root BG commission updated successfully' })
  async updateBgAffiliateCommission(
    @Body() data: {
      rootWalletId?: number;
      treeId?: number;
      newPercent: number;
    }
  ): Promise<{ 
    success: boolean;
    message: string;
    oldPercent: number;
    newPercent: number;
    minRequiredPercent: number | null;
    treeInfo: any;
  }> {
    return this.adminService.updateBgAffiliateCommission(data);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('bg-affiliate/trees')
  @ApiOperation({ summary: 'Get all BG affiliate trees' })
  @ApiResponse({ status: 200, description: 'Returns list of BG affiliate trees' })
  async getAllBgAffiliateTrees(): Promise<any[]> {
    return this.adminService.getAllBgAffiliateTrees();
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('bg-affiliate/trees/wallet/:walletId')
  @ApiOperation({ summary: 'Get BG affiliate tree detail by wallet ID' })
  @ApiResponse({ status: 200, description: 'Returns BG affiliate tree detail with hierarchical structure' })
  async getBgAffiliateTreeByWallet(
    @Param('walletId', ParseIntPipe) walletId: number
  ): Promise<any> {
    return this.adminService.getBgAffiliateTreeByWallet(walletId);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('bg-affiliate/wallet/:walletId/stats')
  @ApiOperation({ summary: 'Get wallet BG affiliate stats' })
  @ApiResponse({ status: 200, description: 'Returns wallet BG affiliate statistics' })
  async getWalletBgAffiliateStats(
    @Param('walletId', ParseIntPipe) walletId: number
  ): Promise<any> {
    return this.adminService.getWalletBgAffiliateStats(walletId);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('bg-affiliate/statistics')
  @ApiOperation({ summary: 'Get BG affiliate system overview' })
  @ApiResponse({ status: 200, description: 'Returns BG affiliate system overview' })
  async getBgAffiliateOverview(): Promise<any> {
    return this.adminService.getBgAffiliateOverview();
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('dashboard/statistics')
  @ApiOperation({ summary: 'Get dashboard overview statistics' })
  @ApiResponse({ status: 200, description: 'Returns comprehensive dashboard statistics' })
  async getDashboardStatistics(): Promise<any> {
    return this.adminService.getDashboardStatistics();
  }


  @UseGuards(JwtAuthAdminGuard)
  @Put('bg-affiliate/nodes/status')
  @ApiOperation({ summary: 'Update BG affiliate node status' })
  @ApiResponse({ status: 200, description: 'Node status updated successfully' })
  async updateBgAffiliateNodeStatus(
    @Body() data: {
      walletId: number;
      status: boolean;
    }
  ): Promise<{ 
    success: boolean;
    message: string;
    walletId: number;
    oldStatus: boolean;
    newStatus: boolean;
    nodeInfo?: any;
  }> {
    return this.adminService.updateBgAffiliateNodeStatus(data);
  }


  @UseGuards(JwtAuthAdminGuard)
  @Get('order-history')
  @ApiOperation({ summary: 'Get all order history' })
  @ApiResponse({ status: 200, description: 'Returns all order history with filters' })
  async getOrderHistory(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('status') status?: string
  ) {
    return this.adminService.getOrderHistory(page, limit, search, status);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('order-statistics')
  @ApiOperation({ summary: 'Get order statistics' })
  @ApiResponse({ status: 200, description: 'Returns order statistics' })
  async getOrderStats() {
    return this.adminService.getOrderStats();
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('wallet-statistics')
  @ApiOperation({ summary: 'Get wallet statistics' })
  @ApiResponse({ status: 200, description: 'Returns wallet statistics' })
  async getWalletStats() {
    return this.adminService.getWalletStats();
  }

  // ==================== TRADITIONAL REFERRAL MANAGEMENT ====================

  @UseGuards(JwtAuthAdminGuard)
  @Get('traditional-referrals')
  @ApiOperation({ summary: 'Get traditional referral list with pagination and search' })
  @ApiResponse({ status: 200, description: 'Returns traditional referral list with stats' })
  async getTraditionalReferrals(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 100,
    @Query('search') search?: string,
    @Query('level', new ParseIntPipe({ optional: true })) level?: number
  ) {
    return this.adminService.getTraditionalReferrals(page, limit, search, level);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('traditional-referrals/statistics')
  @ApiOperation({ summary: 'Get traditional referral system statistics' })
  @ApiResponse({ status: 200, description: 'Returns comprehensive traditional referral statistics' })
  async getTraditionalReferralStatistics() {
    return this.adminService.getTraditionalReferralStatistics();
  }

  @UseGuards(JwtAuthAdminGuard)
  @Post('users')
  @ApiOperation({ summary: 'Create new user (Admin only)' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Only admin can create users' })
  @ApiResponse({ status: 409, description: 'Username or email already exists' })
  async createUser(@Body() createUserDto: CreateUserDto, @Request() req) {
    try {
      return await this.adminService.createUser(createUserDto, req.user);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw new HttpException({
          status: HttpStatus.CONFLICT,
          error: error.message,
          message: 'Username or email already exists'
        }, HttpStatus.CONFLICT);
      }
      
      if (error instanceof UnauthorizedException) {
        throw new HttpException({
          status: HttpStatus.UNAUTHORIZED,
          error: error.message,
          message: 'Only admin can create new users'
        }, HttpStatus.UNAUTHORIZED);
      }
      
      throw new HttpException({
        status: error.status || HttpStatus.INTERNAL_SERVER_ERROR,
        error: error.message,
        message: 'Failed to create user'
      }, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

}
