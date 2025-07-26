import { Injectable, NotFoundException, OnModuleInit, UnauthorizedException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SolanaListCategoriesToken, CategoryPrioritize, CategoryStatus } from '../solana/entities/solana-list-categories-token.entity';
import { CategoryResponseDto } from './dto/category-response.dto';
import { Setting } from './entities/setting.entity';
import { DEFAULT_SETTING, DEFAULT_USER_ADMIN, DEFAULT_REFERENT_SETTING, DEFAULT_REFERENT_LEVEL_REWARDS } from './constants';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserAdmin } from './entities/user-admin.entity';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { AdminRole } from './entities/user-admin.entity';
import { Response } from 'express';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';
import { ReferentSetting } from '../referral/entities/referent-setting.entity';
import { TradingOrder } from '../trade/entities/trading-order.entity';
import { WalletReferent } from '../referral/entities/wallet-referent.entity';
import { ReferentLevelReward } from '../referral/entities/referent-level-rewards.entity';
import { BgRefService } from '../referral/bg-ref.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @InjectRepository(SolanaListCategoriesToken)
    private categoriesRepository: Repository<SolanaListCategoriesToken>,
    @InjectRepository(Setting)
    private settingRepository: Repository<Setting>,
    @InjectRepository(UserAdmin)
    private userAdminRepository: Repository<UserAdmin>,
    @InjectRepository(ListWallet)
    private listWalletRepository: Repository<ListWallet>,
    @InjectRepository(ReferentSetting)
    private referentSettingRepository: Repository<ReferentSetting>,
    @InjectRepository(WalletReferent)
    private walletReferentRepository: Repository<WalletReferent>,
    @InjectRepository(TradingOrder)
    private tradingOrderRepository: Repository<TradingOrder>,
    @InjectRepository(ReferentLevelReward)
    private referentLevelRewardRepository: Repository<ReferentLevelReward>,
    private jwtService: JwtService,
    private bgRefService: BgRefService,
    private dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.initializeDefaultSetting();
    await this.initializeDefaultAdmin();
    await this.initializeDefaultReferentSetting();
    await this.initializeDefaultReferentLevelRewards();
  }

  private async initializeDefaultSetting() {
    const count = await this.settingRepository.count();
    
    if (count === 0) {
      // Nếu chưa có dữ liệu, tạo mới với giá trị mặc định
      const setting = new Setting();
      setting.appName = DEFAULT_SETTING.appName;
      setting.logo = DEFAULT_SETTING.logo;
      setting.telegramBot = DEFAULT_SETTING.telegramBot;
      await this.settingRepository.save(setting);
    } else if (count > 1) {
      // Nếu có nhiều hơn 1 bản ghi, xóa tất cả và tạo lại
      await this.settingRepository.clear();
      const setting = new Setting();
      setting.appName = DEFAULT_SETTING.appName;
      setting.logo = DEFAULT_SETTING.logo;
      setting.telegramBot = DEFAULT_SETTING.telegramBot;
      await this.settingRepository.save(setting);
    }
  }

  private async initializeDefaultAdmin() {
    const adminCount = await this.userAdminRepository.count();
    
    if (adminCount === 0) {
      const hashedPassword = await bcrypt.hash(DEFAULT_USER_ADMIN.password, 10);
      
      await this.userAdminRepository.save({
        username: DEFAULT_USER_ADMIN.username,
        email: DEFAULT_USER_ADMIN.email,
        password: hashedPassword,
        role: AdminRole.ADMIN
      });
    }
  }

  private async initializeDefaultReferentSetting() {
    const count = await this.referentSettingRepository.count();
    
    if (count === 0) {
      // If no settings exist, create one with default values
      const setting = new ReferentSetting();
      setting.rs_ref_level = DEFAULT_REFERENT_SETTING.rs_ref_level;
      await this.referentSettingRepository.save(setting);
    } else if (count > 1) {
      // If more than one setting exists, delete all and create a new one
      await this.referentSettingRepository.clear();
      const setting = new ReferentSetting();
      setting.rs_ref_level = DEFAULT_REFERENT_SETTING.rs_ref_level;
      await this.referentSettingRepository.save(setting);
    }
  }

  private async initializeDefaultReferentLevelRewards() {
    const count = await this.referentLevelRewardRepository.count();
    
    if (count === 0) {
      // Create rewards with unique IDs using the constant
      const rewards = DEFAULT_REFERENT_LEVEL_REWARDS.map((reward, index) => {
        const timestamp = new Date().getTime();
        const random = Math.floor(Math.random() * 1000);
        return {
          ...reward,
          rlr_id: timestamp % 10000 + random + index // Ensure unique IDs
        };
      });

      await this.referentLevelRewardRepository.save(rewards);
    } else if (count > DEFAULT_REFERENT_LEVEL_REWARDS.length) {
      // If more rewards exist than in the constant, delete all and create new ones
      await this.referentLevelRewardRepository.clear();
      await this.initializeDefaultReferentLevelRewards();
    }
  }

  async getSetting(): Promise<Setting> {
    const setting = await this.settingRepository.findOne({ where: {} });
    if (!setting) {
      throw new NotFoundException('Setting not found');
    }
    return setting;
  }

  async updateSetting(data: {
    appName?: string;
    logo?: string;
    telegramBot?: string;
  }): Promise<Setting> {
    const setting = await this.settingRepository.findOne({ where: {} });
    if (!setting) {
      throw new NotFoundException('Setting not found');
    }

    if (data.appName !== undefined) {
      setting.appName = data.appName;
    }
    if (data.logo !== undefined) {
      setting.logo = data.logo;
    }
    if (data.telegramBot !== undefined) {
      setting.telegramBot = data.telegramBot;
    }

    return this.settingRepository.save(setting);
  }

  async getAllCategories(
    page: number = 1,
    limit: number = 100,
    search?: string
  ): Promise<{ data: CategoryResponseDto[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    
    const queryBuilder = this.categoriesRepository.createQueryBuilder('category');

    if (search) {
      queryBuilder.where(
        '(category.slct_name ILIKE :search OR category.slct_slug ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    const [categories, total] = await queryBuilder
      .orderBy('category.slct_created_at', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      data: categories,
      total,
      page,
      limit
    };
  }

  async createCategory(data: {
    slct_name: string;
    slct_slug?: string;
    slct_prioritize?: CategoryPrioritize;
    sltc_status?: CategoryStatus;
  }): Promise<CategoryResponseDto> {
    const category = this.categoriesRepository.create({
      slct_name: data.slct_name,
      slct_slug: data.slct_slug,
      slct_prioritize: data.slct_prioritize || CategoryPrioritize.NO,
      sltc_status: data.sltc_status || CategoryStatus.ACTIVE
    });

    return this.categoriesRepository.save(category);
  }

  async updateCategory(id: number, data: {
    slct_name?: string;
    slct_slug?: string;
    slct_prioritize?: CategoryPrioritize;
    sltc_status?: CategoryStatus;
  }): Promise<CategoryResponseDto> {
    const category = await this.categoriesRepository.findOne({ where: { slct_id: id } });
    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    if (data.slct_name !== undefined) {
      category.slct_name = data.slct_name;
    }
    if (data.slct_slug !== undefined) {
      category.slct_slug = data.slct_slug;
    }
    if (data.slct_prioritize !== undefined) {
      category.slct_prioritize = data.slct_prioritize;
    }
    if (data.sltc_status !== undefined) {
      category.sltc_status = data.sltc_status;
    }

    return this.categoriesRepository.save(category);
  }

  async deleteCategory(id: number): Promise<{ message: string }> {
    const category = await this.categoriesRepository.findOne({ where: { slct_id: id } });
    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    await this.categoriesRepository.remove(category);
    return { message: 'Category deleted successfully' };
  }

  async register(registerDto: RegisterDto): Promise<UserAdmin> {
    const { username, email, password, role } = registerDto;

    // Check if username or email already exists
    const existingUser = await this.userAdminRepository.findOne({
      where: [{ username }, { email }],
    });

    if (existingUser) {
      throw new ConflictException('Username or email already exists');
    }

    // If trying to register as ADMIN, check if admin already exists
    if (role === AdminRole.ADMIN) {
      const adminExists = await this.userAdminRepository.findOne({
        where: { role: AdminRole.ADMIN }
      });

      if (adminExists) {
        throw new ConflictException('Admin account already exists');
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const user = this.userAdminRepository.create({
      username,
      email,
      password: hashedPassword,
      role,
    });

    return this.userAdminRepository.save(user);
  }

  async login(loginDto: LoginDto, response: Response): Promise<{ message: string }> {
    const { username, password } = loginDto;

    // Tìm user theo username hoặc email
    const user = await this.userAdminRepository.findOne({
      where: [
        { username },
        { email: username }
      ],
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate JWT token
    const payload = { 
      sub: user.id, 
      username: user.username,
      role: user.role 
    };
    const token = this.jwtService.sign(payload);

    // Set HTTP-only cookie
    response.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none',
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    });

    return { message: 'Login successfully' };
  }

  async logout(response: Response): Promise<{ message: string }> {
    response.clearCookie('access_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none'
    });
    return { message: 'Logged out successfully' };
  }

  async validateUser(username: string): Promise<UserAdmin> {
    const user = await this.userAdminRepository.findOne({ where: { username } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }

  async changePassword(username: string, currentPassword: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.userAdminRepository.findOne({ where: { username } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedNewPassword;
    await this.userAdminRepository.save(user);

    return { message: 'Password changed successfully' };
  }

  async getListWallets(
    page: number = 1,
    limit: number = 100,
    search?: string,
    wallet_auth?: string,
    wallet_type?: 'main' | 'all'
  ): Promise<{ data: ListWallet[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const skip = (page - 1) * limit;
    
    const queryBuilder = this.listWalletRepository.createQueryBuilder('wallet')
      .leftJoinAndSelect('wallet.wallet_auths', 'wallet_auths')
      .select([
        'wallet.wallet_id',
        'wallet.wallet_solana_address',
        'wallet.wallet_eth_address',
        'wallet.wallet_auth',
        'wallet.wallet_stream',
        'wallet.wallet_status',
        'wallet.wallet_nick_name',
        'wallet.wallet_country',
        'wallet_auths'
      ]);

    // Build where conditions
    const whereConditions: string[] = [];
    const parameters: any = {};

    if (search) {
      whereConditions.push('(wallet.wallet_nick_name ILIKE :search OR CAST(wallet.wallet_id AS TEXT) ILIKE :search OR wallet.wallet_solana_address ILIKE :search)');
      parameters['search'] = `%${search}%`;
    }

    if (wallet_auth) {
      whereConditions.push('wallet.wallet_auth = :wallet_auth');
      parameters['wallet_auth'] = wallet_auth;
    }

    // Filter by wallet type (main or all)
    if (wallet_type === 'main') {
      whereConditions.push('EXISTS (SELECT 1 FROM wallet_auth wa WHERE wa.wa_wallet_id = wallet.wallet_id AND wa.wa_type = \'main\')');
    }

    // Apply where conditions
    if (whereConditions.length > 0) {
      queryBuilder.where(whereConditions.join(' AND '), parameters);
    }

    const [wallets, total] = await queryBuilder
      .orderBy('wallet.wallet_id', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      data: wallets,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async updateWalletAuth(id: number, wallet_auth: 'member' | 'master'): Promise<{ message: string }> {
    const wallet = await this.listWalletRepository.findOne({ where: { wallet_id: id } });
    if (!wallet) {
      throw new NotFoundException(`Wallet with ID ${id} not found`);
    }

    wallet.wallet_auth = wallet_auth;
    await this.listWalletRepository.save(wallet);
    return { message: 'Wallet auth updated successfully' };
  }

  async getReferentSettings(): Promise<ReferentSetting> {
    const setting = await this.referentSettingRepository.findOne({
      where: {},
      order: {
        rs_id: 'DESC'
      }
    });

    if (!setting) {
      throw new NotFoundException('Referent setting not found');
    }

    return setting;
  }

  async updateReferentSettings(data: {
    rs_ref_level?: number;
  }): Promise<ReferentSetting> {
    const setting = await this.referentSettingRepository.findOne({
      where: {},
      order: {
        rs_id: 'DESC'
      }
    });

    if (!setting) {
      throw new NotFoundException('Referent setting not found');
    }

    if (data.rs_ref_level !== undefined) {
      // Xử lý max level theo yêu cầu
      let processedLevel = data.rs_ref_level;
      
      // Lấy trị tuyệt đối nếu là số âm
      if (processedLevel < 0) {
        processedLevel = Math.abs(processedLevel);
      }
      
      // Giới hạn tối đa = 7
      const MAX_REF_LEVEL = 7;
      if (processedLevel > MAX_REF_LEVEL) {
        processedLevel = MAX_REF_LEVEL;
      }
      
      // Đảm bảo tối thiểu = 1
      if (processedLevel < 1) {
        processedLevel = 1;
      }
      
      setting.rs_ref_level = processedLevel;
    }

    return this.referentSettingRepository.save(setting);
  }

  async getReferentLevelRewards(): Promise<ReferentLevelReward[]> {
    return this.referentLevelRewardRepository.find({
      order: {
        rlr_level: 'ASC'
      },
      take: 7
    });
  }

  async updateReferentLevelReward(id: number, percentage: number): Promise<ReferentLevelReward> {
    // Validate percentage
    if (percentage < 0 || percentage > 100) {
      throw new BadRequestException('Percentage must be between 0 and 100');
    }

    // Find the reward to update
    const reward = await this.referentLevelRewardRepository.findOne({
      where: { rlr_id: id }
    });

    if (!reward) {
      throw new NotFoundException(`Referent level reward with ID ${id} not found`);
    }

    // Get all rewards ordered by level
    const allRewards = await this.referentLevelRewardRepository.find({
      order: { rlr_level: 'ASC' }
    });

    // Find the index of current reward
    const currentIndex = allRewards.findIndex(r => r.rlr_id === id);

    // Check with previous level
    if (currentIndex > 0) {
      const previousReward = allRewards[currentIndex - 1];
      if (percentage >= previousReward.rlr_percentage) {
        throw new BadRequestException(
          `Percentage must be lower than previous level (${previousReward.rlr_level}: ${previousReward.rlr_percentage}%)`
        );
      }
    }

    // Check with next level
    if (currentIndex < allRewards.length - 1) {
      const nextReward = allRewards[currentIndex + 1];
      if (percentage <= nextReward.rlr_percentage) {
        throw new BadRequestException(
          `Percentage must be higher than next level (${nextReward.rlr_level}: ${nextReward.rlr_percentage}%)`
        );
      }
    }

    // Update the percentage
    reward.rlr_percentage = percentage;
    return this.referentLevelRewardRepository.save(reward);
  }

  async getWalletReferents(
    page: number = 1,
    limit: number = 100,
    search?: string
  ): Promise<{ data: WalletReferent[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    
    const queryBuilder = this.walletReferentRepository.createQueryBuilder('walletReferent')
      .leftJoinAndSelect('walletReferent.invitee', 'invitee')
      .leftJoinAndSelect('walletReferent.referent', 'referent')
      .leftJoinAndSelect('walletReferent.rewards', 'rewards')
      .select([
        'walletReferent',
        'invitee.wallet_id',
        'invitee.wallet_nick_name',
        'invitee.wallet_solana_address',
        'invitee.wallet_eth_address',
        'referent.wallet_id',
        'referent.wallet_nick_name',
        'referent.wallet_solana_address',
        'referent.wallet_eth_address',
        'rewards'
      ]);

    if (search) {
      queryBuilder.where(
        '(invitee.wallet_nick_name ILIKE :search OR ' +
        'referent.wallet_nick_name ILIKE :search OR ' +
        'CAST(walletReferent.wr_id AS TEXT) ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    const [referents, total] = await queryBuilder
      .orderBy('walletReferent.wr_id', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      data: referents,
      total,
      page,
      limit
    };
  }


  async getOrderHistory(page?: number, limit?: number, search?: string, status?: string) {
    const qb = this.tradingOrderRepository.createQueryBuilder('o')
      .leftJoinAndSelect('o.wallet', 'wallet');

    // Tìm kiếm
    if (search) {
      qb.andWhere('(' +
        'o.order_id::text ILIKE :search OR ' +
        'o.order_token_name ILIKE :search OR ' +
        'o.order_token_address ILIKE :search OR ' +
        'wallet.wallet_solana_address ILIKE :search' +
      ')', { search: `%${search}%` });
    }

    // Lọc theo status, mặc định chỉ lấy executed
    if (status) {
      qb.andWhere('o.order_status = :status', { status });
    } else {
      qb.andWhere('o.order_status = :status', { status: 'executed' });
    }

    // Phân trang
    const pageNum = Number(page) > 0 ? Number(page) : 1;
    const limitNum = Number(limit) > 0 ? Number(limit) : 50;
    const offset = (pageNum - 1) * limitNum;
    qb.orderBy('o.order_created_at', 'DESC')
      .skip(offset)
      .take(limitNum);

    const [orders, total] = await qb.getManyAndCount();
    const data = orders.map(order => ({
      order_id: order.order_id,
      walletId: order.order_wallet_id,
      solAddress: order.wallet?.wallet_solana_address || null,
      order_trade_type: order.order_trade_type,
      order_token_address: order.order_token_address,
      order_token_name: order.order_token_name,
      order_qlty: order.order_qlty,
      order_price: order.order_price,
      order_total_value: order.order_total_value,
      order_type: order.order_type,
      order_status: order.order_status,
      order_tx_hash: order.order_tx_hash,
      order_error_message: order.order_error_message,
      order_created_at: order.order_created_at,
      order_executed_at: order.order_executed_at
    }));
    return {
      data,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  async getOrderStats() {
    // Tổng số order
    const total = await this.tradingOrderRepository.count();
    // Tổng số order thành công
    const executed = await this.tradingOrderRepository.count({ where: { order_status: 'executed' } });
    // Ví giao dịch nhiều nhất
    const most = await this.tradingOrderRepository
      .createQueryBuilder('o')
      .select('o.order_wallet_id', 'walletId')
      .addSelect('COUNT(*)', 'orderCount')
      .leftJoin('o.wallet', 'wallet')
      .addSelect('wallet.wallet_solana_address', 'solAddress')
      .groupBy('o.order_wallet_id')
      .addGroupBy('wallet.wallet_solana_address')
      .orderBy('COUNT(*)', 'DESC')
      .limit(1)
      .getRawOne();
    return {
      total,
      executed,
      mostActiveWallet: most ? {
        walletId: Number(most.walletId),
        solAddress: most.solAddress,
        orderCount: Number(most.orderCount)
      } : null
    };
  }

  async getWalletStats() {
    const totalWallets = await this.listWalletRepository.count();
    return { totalWallets };
  }

  /**
   * Tạo BG affiliate mới
   */
  async createBgAffiliate(data: {
    walletId: number;
    totalCommissionPercent: number;
  }): Promise<{ message: string; treeId: number; totalCommissionPercent: number }> {
    // Kiểm tra wallet có tồn tại không
    const wallet = await this.listWalletRepository.findOne({
      where: { wallet_id: data.walletId }
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet với ID ${data.walletId} không tồn tại`);
    }

    // Kiểm tra wallet đã có cây affiliate chưa (đã là root BG)
    const existingTree = await this.bgRefService.getWalletBgAffiliateInfo(data.walletId);
    if (existingTree) {
      throw new BadRequestException('Wallet đã có cây affiliate BG, không thể tạo thêm');
    }

    // Kiểm tra wallet có thuộc luồng giới thiệu của BG nào không
    const isInBgAffiliateSystem = await this.bgRefService.isWalletInBgAffiliateSystem(data.walletId);
    if (isInBgAffiliateSystem) {
      throw new BadRequestException('Wallet đã thuộc luồng giới thiệu của BG khác, không thể cấp quyền BG');
    }

    // Kiểm tra commission percent hợp lệ
    if (data.totalCommissionPercent < 0 || data.totalCommissionPercent > 100) {
      throw new BadRequestException('Commission percent phải từ 0 đến 100');
    }

    // Tạo cây affiliate mới
    const tree = await this.bgRefService.createAffiliateTree(
      data.walletId,
      data.totalCommissionPercent
    );

    return {
      message: 'Tạo BG affiliate thành công',
      treeId: tree.bat_id,
      totalCommissionPercent: data.totalCommissionPercent
    };
  }

  /**
   * Admin cập nhật hoa hồng của root BG
   * Chỉ có thể cập nhật root BG và phải đảm bảo không ảnh hưởng đến tuyến dưới
   */
  async updateBgAffiliateCommission(data: {
    rootWalletId?: number;
    treeId?: number;
    newPercent: number;
  }): Promise<{ 
    success: boolean;
    message: string;
    oldPercent: number;
    newPercent: number;
    minRequiredPercent: number | null;
    treeInfo: any;
  }> {
    // Ưu tiên sử dụng rootWalletId nếu có
    if (data.rootWalletId) {
      return await this.bgRefService.adminUpdateRootBgCommission(data.rootWalletId, data.newPercent);
    }
    
    // Fallback về treeId nếu không có rootWalletId
    if (data.treeId) {
      return await this.bgRefService.adminUpdateRootBgCommissionByTreeId(data.treeId, data.newPercent);
    }
    
    throw new BadRequestException('Phải cung cấp rootWalletId hoặc treeId');
  }

  /**
   * Lấy danh sách tất cả BG affiliate trees
   */
  async getAllBgAffiliateTrees(): Promise<any[]> {
    const trees = await this.bgRefService.getAllBgAffiliateTrees();
    
    // Format dữ liệu để trả về với thông tin wallet
    const treesWithWalletInfo = await Promise.all(
      trees.map(async (tree) => {
        // Lấy thông tin root wallet
        const rootWallet = await this.listWalletRepository.findOne({
          where: { wallet_id: tree.bat_root_wallet_id },
          select: ['wallet_id', 'wallet_solana_address', 'wallet_nick_name', 'wallet_eth_address']
        });

        // Tìm root node để lấy status
        const rootNode = tree.nodes?.find(node => node.ban_wallet_id === tree.bat_root_wallet_id);

        // Xây dựng cấu trúc cây để đếm total members
        const treeStructure = await this.buildHierarchicalTree(tree.bat_root_wallet_id, tree.nodes || []);

        return {
          treeId: tree.bat_id,
          rootWallet: rootWallet ? {
            walletId: rootWallet.wallet_id,
            solanaAddress: rootWallet.wallet_solana_address,
            nickName: rootWallet.wallet_nick_name,
            ethAddress: rootWallet.wallet_eth_address
          } : null,
          totalCommissionPercent: tree.bat_total_commission_percent,
          createdAt: tree.bat_created_at,
          nodeCount: tree.nodes?.length || 0,
          totalMembers: this.countTotalMembers(treeStructure),
          status: rootNode ? rootNode.ban_status : true
        };
      })
    );
    
    return treesWithWalletInfo;
  }

  /**
   * Lấy thông tin chi tiết BG affiliate tree theo wallet ID
   */
  async getBgAffiliateTreeByWallet(walletId: number): Promise<any> {
    // Kiểm tra wallet có tồn tại không
    const wallet = await this.listWalletRepository.findOne({
      where: { wallet_id: walletId }
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet với ID ${walletId} không tồn tại`);
    }

    // Lấy thông tin BG affiliate của wallet
    const bgAffiliateInfo = await this.bgRefService.getWalletBgAffiliateInfo(walletId);
    if (!bgAffiliateInfo) {
      throw new BadRequestException('Wallet không thuộc hệ thống BG affiliate');
    }

    // Lấy thông tin cây
    const tree = await this.bgRefService.getAffiliateTree(bgAffiliateInfo.treeId);
    
    // Lấy tất cả nodes trong cây (bao gồm cả status)
    const allNodes = await this.bgRefService['bgAffiliateNodeRepository'].find({
      where: { ban_tree_id: bgAffiliateInfo.treeId },
      order: { ban_effective_from: 'ASC' }
    });

    // Kiểm tra xem wallet có phải là root BG không
    const isRootBg = bgAffiliateInfo.parentWalletId === null;

    if (isRootBg) {
      // Nếu là root BG, lấy tất cả tuyến dưới
      return await this.getRootBgTreeStructure(walletId, tree, allNodes);
    } else {
      // Nếu là ví thường, lấy thông tin ví giới thiệu và tuyến dưới
      return await this.getMemberTreeStructure(walletId, bgAffiliateInfo, tree, allNodes);
    }
  }

  /**
   * Lấy cấu trúc cây cho root BG
   */
  private async getRootBgTreeStructure(rootWalletId: number, tree: any, allNodes: any[]): Promise<any> {
    // Lấy thông tin root wallet
    const rootWallet = await this.listWalletRepository.findOne({
      where: { wallet_id: rootWalletId },
      select: ['wallet_id', 'wallet_solana_address', 'wallet_nick_name', 'wallet_eth_address']
    });

    // Tìm root node để lấy status
    const rootNode = allNodes.find(node => node.ban_wallet_id === rootWalletId);

    // Tạo cấu trúc cây phân theo nhánh
    const treeStructure = await this.buildHierarchicalTree(rootWalletId, allNodes);

    return {
      walletType: 'root_bg',
      currentWallet: rootWallet ? {
        walletId: rootWallet.wallet_id,
        solanaAddress: rootWallet.wallet_solana_address,
        nickName: rootWallet.wallet_nick_name,
        ethAddress: rootWallet.wallet_eth_address,
        status: rootNode ? rootNode.ban_status : true
      } : null,
      treeInfo: {
        treeId: tree.bat_id,
        totalCommissionPercent: tree.bat_total_commission_percent,
        createdAt: tree.bat_created_at
      },
      downlineStructure: treeStructure,
      totalMembers: this.countTotalMembers(treeStructure),
      activeMembers: this.countActiveMembers(treeStructure)
    };
  }

  /**
   * Lấy cấu trúc cây cho member thường
   */
  private async getMemberTreeStructure(memberWalletId: number, bgAffiliateInfo: any, tree: any, allNodes: any[]): Promise<any> {
    // Lấy thông tin member wallet
    const memberWallet = await this.listWalletRepository.findOne({
      where: { wallet_id: memberWalletId },
      select: ['wallet_id', 'wallet_solana_address', 'wallet_nick_name', 'wallet_eth_address']
    });

    // Tìm member node để lấy status
    const memberNode = allNodes.find(node => node.ban_wallet_id === memberWalletId);

    // Lấy thông tin ví giới thiệu (parent)
    let referrerWallet: any = null;
    let referrerNode: any = null;
    if (bgAffiliateInfo.parentWalletId) {
      referrerWallet = await this.listWalletRepository.findOne({
        where: { wallet_id: bgAffiliateInfo.parentWalletId },
        select: ['wallet_id', 'wallet_solana_address', 'wallet_nick_name', 'wallet_eth_address']
      });
      referrerNode = allNodes.find(node => node.ban_wallet_id === bgAffiliateInfo.parentWalletId);
    }

    // Tạo cấu trúc cây phân theo nhánh cho tuyến dưới của member
    const downlineStructure = await this.buildHierarchicalTree(memberWalletId, allNodes);

    return {
      walletType: 'member',
      currentWallet: memberWallet ? {
        walletId: memberWallet.wallet_id,
        solanaAddress: memberWallet.wallet_solana_address,
        nickName: memberWallet.wallet_nick_name,
        ethAddress: memberWallet.wallet_eth_address,
        status: memberNode ? memberNode.ban_status : true
      } : null,
      referrerInfo: referrerWallet ? {
        walletId: referrerWallet.wallet_id,
        solanaAddress: referrerWallet.wallet_solana_address,
        nickName: referrerWallet.wallet_nick_name,
        ethAddress: referrerWallet.wallet_eth_address,
        commissionPercent: bgAffiliateInfo.commissionPercent,
        level: bgAffiliateInfo.level,
        status: referrerNode ? referrerNode.ban_status : true
      } : null,
      treeInfo: {
        treeId: tree.bat_id,
        totalCommissionPercent: tree.bat_total_commission_percent,
        createdAt: tree.bat_created_at
      },
      downlineStructure: downlineStructure,
      totalMembers: this.countTotalMembers(downlineStructure),
      activeMembers: this.countActiveMembers(downlineStructure)
    };
  }

  /**
   * Xây dựng cấu trúc cây phân theo nhánh
   */
  private async buildHierarchicalTree(parentWalletId: number, allNodes: any[]): Promise<any[]> {
    const children = allNodes.filter(node => node.ban_parent_wallet_id === parentWalletId);
    
    if (children.length === 0) {
      return [];
    }

    const hierarchicalStructure: any[] = [];

    for (const child of children) {
      // Lấy thông tin wallet
      const wallet = await this.listWalletRepository.findOne({
        where: { wallet_id: child.ban_wallet_id },
        select: ['wallet_id', 'wallet_solana_address', 'wallet_nick_name', 'wallet_eth_address']
      });

      // Lấy thống kê cho node này
      const nodeStats = await this.getNodeStats(child.ban_wallet_id);

      const childNode = {
        nodeId: child.ban_id,
        walletId: child.ban_wallet_id,
        commissionPercent: child.ban_commission_percent,
        status: child.ban_status,
        effectiveFrom: child.ban_effective_from,
        totalVolume: nodeStats.totalVolume,
        totalTrans: nodeStats.totalTrans,
        walletInfo: wallet ? {
          nickName: wallet.wallet_nick_name,
          solanaAddress: wallet.wallet_solana_address,
          ethAddress: wallet.wallet_eth_address
        } : null,
        children: await this.buildHierarchicalTree(child.ban_wallet_id, allNodes)
      };

      hierarchicalStructure.push(childNode);
    }

    return hierarchicalStructure;
  }

  /**
   * Đếm tổng số thành viên trong cấu trúc cây
   */
  private countTotalMembers(treeStructure: any[]): number {
    let count = 0;
    
    for (const node of treeStructure) {
      count += 1; // Đếm node hiện tại
      count += this.countTotalMembers(node.children); // Đếm các node con
    }
    
    return count;
  }

  /**
   * Đếm số thành viên active trong cấu trúc cây
   */
  private countActiveMembers(treeStructure: any[]): number {
    let count = 0;
    
    for (const node of treeStructure) {
      if (node.status === true) {
        count += 1; // Đếm node active hiện tại
      }
      count += this.countActiveMembers(node.children); // Đếm các node con active
    }
    
    return count;
  }

  /**
   * Lấy thống kê cho một node
   */
  private async getNodeStats(nodeWalletId: number): Promise<{
    totalVolume: number;
    totalTrans: number;
  }> {
    // Lấy tổng khối lượng giao dịch và số giao dịch của node
    const volumeStats = await this.dataSource.createQueryBuilder()
      .select('COALESCE(SUM(orders.order_total_value), 0)', 'totalVolume')
      .addSelect('COUNT(orders.order_id)', 'totalTrans')
      .from('trading_orders', 'orders')
      .where('orders.order_wallet_id = :walletId', { walletId: nodeWalletId })
      .getRawOne();

    return {
      totalVolume: parseFloat(volumeStats?.totalVolume || '0'),
      totalTrans: parseInt(volumeStats?.totalTrans || '0')
    };
  }

  /**
   * Lấy thông tin chi tiết BG affiliate tree (giữ lại để tương thích)
   */
  async getBgAffiliateTreeDetail(treeId: number): Promise<any> {
    const tree = await this.bgRefService.getAffiliateTree(treeId);
    if (!tree) {
      throw new NotFoundException('Cây affiliate không tồn tại');
    }

    // Lấy thông tin chi tiết của từng node (chỉ lấy nodes active)
    const nodesWithDetails = await Promise.all(
      tree.nodes.filter(node => node.ban_status).map(async (node) => {
        const wallet = await this.listWalletRepository.findOne({
          where: { wallet_id: node.ban_wallet_id }
        });

        return {
          nodeId: node.ban_id,
          walletId: node.ban_wallet_id,
          parentWalletId: node.ban_parent_wallet_id,
          commissionPercent: node.ban_commission_percent,
          status: node.ban_status,
          effectiveFrom: node.ban_effective_from,
          walletInfo: wallet ? {
            nickName: wallet.wallet_nick_name,
            solanaAddress: wallet.wallet_solana_address,
            ethAddress: wallet.wallet_eth_address
          } : null
        };
      })
    );

    // Lấy thông tin root wallet
    const rootWallet = await this.listWalletRepository.findOne({
      where: { wallet_id: tree.bat_root_wallet_id },
      select: ['wallet_id', 'wallet_solana_address', 'wallet_nick_name', 'wallet_eth_address']
    });

    return {
      treeId: tree.bat_id,
      rootWallet: rootWallet ? {
        walletId: rootWallet.wallet_id,
        solanaAddress: rootWallet.wallet_solana_address,
        nickName: rootWallet.wallet_nick_name,
        ethAddress: rootWallet.wallet_eth_address
      } : null,
      totalCommissionPercent: tree.bat_total_commission_percent,
      createdAt: tree.bat_created_at,
      nodes: nodesWithDetails
    };
  }

  /**
   * Lấy thống kê BG affiliate của wallet
   */
  async getWalletBgAffiliateStats(walletId: number): Promise<any> {
    return await this.bgRefService.getWalletBgAffiliateStats(walletId);
  }

  /**
   * Lấy thống kê tổng quan BG affiliate - tập trung vào phần thưởng
   */
  async getBgAffiliateOverview(): Promise<{
    totalTrees: number;
    totalMembers: number;
    totalCommissionDistributed: number;
    totalVolume: number;
    topEarners: Array<{
      walletId: number;
      nickName: string;
      solanaAddress: string;
      totalEarned: number;
    }>;
  }> {
    // Lấy tất cả trees
    const allTrees = await this.bgRefService.getAllBgAffiliateTrees();
    
    // Lấy tất cả commission rewards
    const allRewards = await this.bgRefService['bgAffiliateCommissionRewardRepository'].find();

    // Lấy tất cả nodes để đếm members
    const allNodes = await this.bgRefService['bgAffiliateNodeRepository'].find();
    const totalMembers = allNodes.filter(node => node.ban_parent_wallet_id !== null).length;

    // Tính tổng commission đã phân phối
    const totalCommissionDistributed = allRewards.reduce((sum, reward) => 
      sum + Number(reward.bacr_commission_amount), 0
    );

    // Tính tổng volume từ trading_orders
    const volumeStats = await this.dataSource.createQueryBuilder()
      .select('COALESCE(SUM(orders.order_total_value), 0)', 'totalVolume')
      .from('trading_orders', 'orders')
      .getRawOne();

    const totalVolume = parseFloat(volumeStats?.totalVolume || '0');

    // Tính top earners
    const walletEarnings = new Map();
    
    allRewards.forEach(reward => {
      const currentEarning = walletEarnings.get(reward.bacr_wallet_id) || 0;
      walletEarnings.set(reward.bacr_wallet_id, currentEarning + Number(reward.bacr_commission_amount));
    });

    const topEarners = await Promise.all(
      Array.from(walletEarnings.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(async ([walletId, totalEarned]) => {
          const wallet = await this.listWalletRepository.findOne({
            where: { wallet_id: walletId },
            select: ['wallet_id', 'wallet_nick_name', 'wallet_solana_address']
          });

          return {
            walletId: walletId,
            nickName: wallet?.wallet_nick_name || '',
            solanaAddress: wallet?.wallet_solana_address || '',
            totalEarned: Number(totalEarned.toFixed(5))
          };
        })
    );

    return {
      totalTrees: allTrees.length,
      totalMembers,
      totalCommissionDistributed: Number(totalCommissionDistributed.toFixed(5)),
      totalVolume: Number(totalVolume.toFixed(2)),
      topEarners
    };
  }

  /**
   * Lấy thống kê tổng quan cho dashboard
   */
  async getDashboardStatistics(): Promise<{
    wallets: {
      totalWallets: number;
      activeWallets: number;
      newWalletsToday: number;
      newWalletsThisWeek: number;
    };
    orders: {
      totalOrders: number;
      executedOrders: number;
      pendingOrders: number;
      totalVolume: number;
      averageOrderValue: number;
      mostActiveWallet: {
        walletId: number;
        nickName: string;
        solanaAddress: string;
        orderCount: number;
      } | null;
    };
    referrals: {
      traditionalReferrals: {
        totalRelations: number;
        totalRewards: number;
        totalWallets: number;
        totalVolume: number;
        averageRewardPerWallet: number;
      };
      bgAffiliate: {
        totalTrees: number;
        totalMembers: number;
        totalCommissionDistributed: number;
        totalVolume: number;
      };
    };
  }> {
    // ==================== WALLET STATISTICS ====================
    const totalWallets = await this.listWalletRepository.count();
    
    const activeWallets = await this.listWalletRepository.count({
      where: { wallet_status: true }
    });

    // Tính ví mới hôm nay và tuần này (giả định dựa trên wallet_id)
    // Vì không có timestamp, tạm thời đặt là 0
    const newWalletsToday = 0;
    const newWalletsThisWeek = 0;

    // ==================== ORDER STATISTICS ====================
    const totalOrders = await this.tradingOrderRepository.count();
    const executedOrders = await this.tradingOrderRepository.count({
      where: { order_status: 'executed' }
    });
    const pendingOrders = await this.tradingOrderRepository.count({
      where: { order_status: 'pending' }
    });

    // Tính tổng volume và average order value
    const orderStats = await this.dataSource.createQueryBuilder()
      .select('COALESCE(SUM(orders.order_total_value), 0)', 'totalVolume')
      .addSelect('COALESCE(AVG(orders.order_total_value), 0)', 'averageValue')
      .from('trading_orders', 'orders')
      .where('orders.order_status = :status', { status: 'executed' })
      .getRawOne();

    const totalVolume = parseFloat(orderStats?.totalVolume || '0');
    const averageOrderValue = parseFloat(orderStats?.averageValue || '0');

    // Tìm ví giao dịch nhiều nhất
    const mostActiveWallet = await this.tradingOrderRepository
      .createQueryBuilder('o')
      .select('o.order_wallet_id', 'walletId')
      .addSelect('COUNT(*)', 'orderCount')
      .leftJoin('o.wallet', 'wallet')
      .addSelect('wallet.wallet_nick_name', 'nickName')
      .addSelect('wallet.wallet_solana_address', 'solanaAddress')
      .groupBy('o.order_wallet_id')
      .addGroupBy('wallet.wallet_nick_name')
      .addGroupBy('wallet.wallet_solana_address')
      .orderBy('COUNT(*)', 'DESC')
      .limit(1)
      .getRawOne();

    // ==================== REFERRAL STATISTICS ====================
    
    // Traditional Referral Stats - sử dụng logic giống hệt getTraditionalReferralStatistics
    const traditionalReferrals = await this.walletReferentRepository.find({
      relations: ['invitee', 'referent', 'rewards']
    });

    const uniqueTraditionalWallets = new Set();
    const walletStats = new Map();

    traditionalReferrals.forEach(referral => {
      const inviteeId = referral.invitee.wallet_id;
      const referentId = referral.referent.wallet_id;
      
      uniqueTraditionalWallets.add(inviteeId);
      uniqueTraditionalWallets.add(referentId);

      // Tính reward cho referral này
      const referralReward = (referral.rewards || []).reduce((sum, reward) => {
        return sum + (parseFloat(String(reward.wrr_use_reward)) || 0);
      }, 0);

      // Cập nhật thống kê theo wallet
      if (!walletStats.has(inviteeId)) {
        walletStats.set(inviteeId, {
          walletId: inviteeId,
          totalInviteeReward: 0,
          totalReferrerReward: 0
        });
      }

      if (!walletStats.has(referentId)) {
        walletStats.set(referentId, {
          walletId: referentId,
          totalInviteeReward: 0,
          totalReferrerReward: 0
        });
      }

      const inviteeWallet = walletStats.get(inviteeId);
      const referentWallet = walletStats.get(referentId);

      // Cập nhật thống kê wallet
      inviteeWallet.totalInviteeReward += referralReward;
      referentWallet.totalReferrerReward += referralReward;
    });

    // Tính tổng phần thưởng của tất cả ví (giống hệt getTraditionalReferralStatistics)
    const walletArray = Array.from(walletStats.values());
    const totalTraditionalRewards = walletArray.reduce((sum, wallet) => {
      return sum + wallet.totalInviteeReward + wallet.totalReferrerReward;
    }, 0);

    // BG Affiliate Stats
    const bgAffiliateOverview = await this.getBgAffiliateOverview();

    // Tính volume cho traditional referrals
    const traditionalWalletsArray = Array.from(uniqueTraditionalWallets);
    let traditionalVolume = 0;
    
    if (traditionalWalletsArray.length > 0) {
      const traditionalVolumeStats = await this.dataSource.createQueryBuilder()
        .select('COALESCE(SUM(orders.order_total_value), 0)', 'totalVolume')
        .from('trading_orders', 'orders')
        .where('orders.order_wallet_id IN (:...walletIds)', { 
          walletIds: traditionalWalletsArray 
        })
        .andWhere('orders.order_status = :status', { status: 'executed' })
        .getRawOne();

      traditionalVolume = parseFloat(traditionalVolumeStats?.totalVolume || '0');
    }

    return {
      wallets: {
        totalWallets,
        activeWallets,
        newWalletsToday,
        newWalletsThisWeek
      },
      orders: {
        totalOrders,
        executedOrders,
        pendingOrders,
        totalVolume: Number(totalVolume.toFixed(2)),
        averageOrderValue: Number(averageOrderValue.toFixed(2)),
        mostActiveWallet: mostActiveWallet ? {
          walletId: Number(mostActiveWallet.walletId),
          nickName: mostActiveWallet.nickName || '',
          solanaAddress: mostActiveWallet.solanaAddress || '',
          orderCount: Number(mostActiveWallet.orderCount)
        } : null
      },
      referrals: {
        traditionalReferrals: {
          totalRelations: traditionalReferrals.length,
          totalRewards: Number(totalTraditionalRewards.toFixed(5)),
          totalWallets: uniqueTraditionalWallets.size,
          totalVolume: Number(traditionalVolume.toFixed(2)),
          averageRewardPerWallet: uniqueTraditionalWallets.size > 0 
            ? Number((totalTraditionalRewards / uniqueTraditionalWallets.size).toFixed(5)) 
            : 0
        },
        bgAffiliate: {
          totalTrees: bgAffiliateOverview.totalTrees,
          totalMembers: bgAffiliateOverview.totalMembers,
          totalCommissionDistributed: bgAffiliateOverview.totalCommissionDistributed,
          totalVolume: bgAffiliateOverview.totalVolume
        }
      }
    };
  }

  /**
   * Lấy thông tin wallet
   */
  async getWalletInfo(walletId: number): Promise<any> {
    const wallet = await this.listWalletRepository.findOne({
      where: { wallet_id: walletId }
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet với ID ${walletId} không tồn tại`);
    }

    return {
      walletId: wallet.wallet_id,
      nickName: wallet.wallet_nick_name,
      solanaAddress: wallet.wallet_solana_address,
      ethAddress: wallet.wallet_eth_address,
      auth: wallet.wallet_auth,
      status: wallet.wallet_status
    };
  }

  async createUser(createUserDto: CreateUserDto, currentUser: UserAdmin): Promise<{ message: string; user: any }> {
    // Kiểm tra quyền - chỉ admin mới được tạo user
    if (currentUser.role !== AdminRole.ADMIN) {
      throw new ForbiddenException('Only admin can create new users');
    }

    // Kiểm tra username và email đã tồn tại chưa
    const existingUser = await this.userAdminRepository.findOne({
      where: [
        { username: createUserDto.username },
        { email: createUserDto.email }
      ]
    });

    if (existingUser) {
      throw new ConflictException('Username or email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    // Tạo user mới
    const newUser = this.userAdminRepository.create({
      username: createUserDto.username,
      email: createUserDto.email,
      password: hashedPassword,
      role: createUserDto.role
    });

    const savedUser = await this.userAdminRepository.save(newUser);

    // Trả về thông tin user (không bao gồm password)
    const { password, ...userInfo } = savedUser;

    return {
      message: 'User created successfully',
      user: userInfo
    };
  }

  async getUsers(page: number = 1, limit: number = 20, role?: 'admin' | 'member' | 'partner', search?: string) {
    const query = this.userAdminRepository.createQueryBuilder('user')
      .select(['user.id', 'user.username', 'user.email', 'user.role', 'user.createdAt', 'user.updatedAt'])
      .orderBy('user.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (role) query.andWhere('user.role = :role', { role });
    if (search) query.andWhere('(user.username ILIKE :search OR user.email ILIKE :search)', { search: `%${search}%` });

    const [users, total] = await query.getManyAndCount();

    return {
      data: users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getUserStats() {
    // Tổng số user
    const total = await this.userAdminRepository.count();
    // Số user theo từng role
    const adminCount = await this.userAdminRepository.count({ where: { role: AdminRole.ADMIN } });
    const memberCount = await this.userAdminRepository.count({ where: { role: AdminRole.MEMBER } });
    const partnerCount = await this.userAdminRepository.count({ where: { role: AdminRole.PARTNER } });
    // Số user tạo mới 7 ngày gần nhất
    const recent = await this.userAdminRepository.createQueryBuilder('user')
      .where('user.createdAt >= NOW() - INTERVAL \'7 days\'')
      .getCount();
    return {
      total,
      byRole: {
        admin: adminCount,
        member: memberCount,
        partner: partnerCount
      },
      createdLast7Days: recent
    };
  }

  /**
   * Cập nhật trạng thái của BG affiliate node
   */
  async updateBgAffiliateNodeStatus(data: {
    walletId: number;
    status: boolean;
  }): Promise<{ 
    success: boolean;
    message: string;
    walletId: number;
    oldStatus: boolean;
    newStatus: boolean;
    nodeInfo?: any;
  }> {
    // Kiểm tra wallet có tồn tại không
    const wallet = await this.listWalletRepository.findOne({
      where: { wallet_id: data.walletId }
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet với ID ${data.walletId} không tồn tại`);
    }

    // Kiểm tra wallet có trong hệ thống BG affiliate không
    const bgAffiliateInfo = await this.bgRefService.getWalletBgAffiliateInfo(data.walletId);
    if (!bgAffiliateInfo) {
      throw new BadRequestException('Wallet không thuộc hệ thống BG affiliate');
    }

    // Lấy node hiện tại
    const node = await this.bgRefService['bgAffiliateNodeRepository'].findOne({
      where: { ban_wallet_id: data.walletId }
    });

    if (!node) {
      throw new NotFoundException('Không tìm thấy node BG affiliate');
    }

    const oldStatus = node.ban_status;

    // Cho phép cập nhật trạng thái của cả root BG và các node thường
    // Chỉ cảnh báo nếu đang tắt root BG
    if (!data.status && node.ban_parent_wallet_id === null) {
      // Cảnh báo nhưng vẫn cho phép thực hiện
      console.warn(`Warning: Admin is disabling root BG wallet ${data.walletId}`);
    }

    // Cập nhật trạng thái
    node.ban_status = data.status;
    await this.bgRefService['bgAffiliateNodeRepository'].save(node);

    // Lấy thông tin wallet để trả về
    const walletInfo = {
      walletId: wallet.wallet_id,
      nickName: wallet.wallet_nick_name,
      solanaAddress: wallet.wallet_solana_address,
      ethAddress: wallet.wallet_eth_address
    };

    const isRoot = node.ban_parent_wallet_id === null;
    const statusMessage = isRoot && !data.status 
      ? `Cập nhật trạng thái root BG thành công: ${data.status ? 'Bật' : 'Tắt'} (Cảnh báo: Root BG đã bị tắt)`
      : `Cập nhật trạng thái BG affiliate node thành công: ${data.status ? 'Bật' : 'Tắt'}`;

    return {
      success: true,
      message: statusMessage,
      walletId: data.walletId,
      oldStatus,
      newStatus: data.status,
      nodeInfo: {
        ...walletInfo,
        treeId: bgAffiliateInfo.treeId,
        parentWalletId: bgAffiliateInfo.parentWalletId,
        commissionPercent: bgAffiliateInfo.commissionPercent,
        level: bgAffiliateInfo.level,
        isRoot: isRoot
      }
    };
  }

  // ==================== TRADITIONAL REFERRAL MANAGEMENT ====================

  /**
   * Lấy danh sách referral truyền thống với phân trang và tìm kiếm
   * Cấu trúc dữ liệu được tối ưu để nhóm theo wallet và hiển thị referral tree
   */
  async getTraditionalReferrals(
    page: number = 1,
    limit: number = 100,
    search?: string,
    level?: number
  ): Promise<{ 
    data: any[]; 
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    // Lấy tất cả dữ liệu referral trước để nhóm theo wallet
    const queryBuilder = this.walletReferentRepository.createQueryBuilder('referral')
      .leftJoinAndSelect('referral.invitee', 'invitee')
      .leftJoinAndSelect('referral.referent', 'referent')
      .leftJoinAndSelect('referral.rewards', 'rewards')
      .select([
        'referral.wr_id',
        'referral.wr_wallet_invitee',
        'referral.wr_wallet_referent',
        'referral.wr_wallet_level',
        'invitee.wallet_id',
        'invitee.wallet_nick_name',
        'invitee.wallet_solana_address',
        'invitee.wallet_eth_address',
        'invitee.wallet_code_ref',
        'referent.wallet_id',
        'referent.wallet_nick_name',
        'referent.wallet_solana_address',
        'referent.wallet_eth_address',
        'referent.wallet_code_ref',
        'rewards'
      ]);

    // Build where conditions
    const whereConditions: string[] = [];
    const parameters: any = {};

    // Không cần filter trong query vì sẽ filter sau khi nhóm theo wallet

    if (level) {
      whereConditions.push('referral.wr_wallet_level = :level');
      parameters['level'] = level;
    }

    // Apply where conditions
    if (whereConditions.length > 0) {
      queryBuilder.where(whereConditions.join(' AND '), parameters);
    }

    const allReferrals = await queryBuilder
      .orderBy('referral.wr_id', 'DESC')
      .getMany();

    // Nhóm dữ liệu theo wallet để tránh trùng lặp
    const walletMap = new Map();

    allReferrals.forEach(referral => {
      const totalReward = (referral.rewards || []).reduce((sum, reward) => {
        return sum + (parseFloat(String(reward.wrr_use_reward)) || 0);
      }, 0);

      const referralInfo = {
        referralId: referral.wr_id,
        level: referral.wr_wallet_level,
        totalReward: Number(totalReward.toFixed(5)),
        rewardCount: referral.rewards?.length || 0
      };

      // Xử lý invitee
      const inviteeId = referral.invitee.wallet_id;
      if (!walletMap.has(inviteeId)) {
        walletMap.set(inviteeId, {
          walletId: inviteeId,
          nickName: referral.invitee.wallet_nick_name,
          solanaAddress: referral.invitee.wallet_solana_address,
          ethAddress: referral.invitee.wallet_eth_address,
          refCode: referral.invitee.wallet_code_ref,
          asInvitee: [], // Các mối quan hệ khi wallet này được giới thiệu
          asReferrer: [] // Các mối quan hệ khi wallet này giới thiệu người khác
        });
      }

      // Xử lý referent
      const referentId = referral.referent.wallet_id;
      if (!walletMap.has(referentId)) {
        walletMap.set(referentId, {
          walletId: referentId,
          nickName: referral.referent.wallet_nick_name,
          solanaAddress: referral.referent.wallet_solana_address,
          ethAddress: referral.referent.wallet_eth_address,
          refCode: referral.referent.wallet_code_ref,
          asInvitee: [],
          asReferrer: []
        });
      }

      // Thêm thông tin referral vào wallet tương ứng
      const inviteeWallet = walletMap.get(inviteeId);
      const referentWallet = walletMap.get(referentId);

      // Thêm vào asInvitee của invitee
      inviteeWallet.asInvitee.push({
        ...referralInfo,
        referent: {
          walletId: referentId,
          nickName: referentWallet.nickName,
          solanaAddress: referentWallet.solanaAddress,
          ethAddress: referentWallet.ethAddress,
          refCode: referentWallet.refCode
        }
      });

      // Thêm vào asReferrer của referent
      referentWallet.asReferrer.push({
        ...referralInfo,
        invitee: {
          walletId: inviteeId,
          nickName: inviteeWallet.nickName,
          solanaAddress: inviteeWallet.solanaAddress,
          ethAddress: inviteeWallet.ethAddress,
          refCode: inviteeWallet.refCode
        }
      });
    });

    // Chuyển đổi Map thành Array và tính toán thống kê
    const allFormattedData = Array.from(walletMap.values()).map(wallet => {
      // Tính tổng reward khi là invitee
      const totalInviteeReward = wallet.asInvitee.reduce((sum, rel) => sum + rel.totalReward, 0);
      const totalInviteeCount = wallet.asInvitee.reduce((sum, rel) => sum + rel.rewardCount, 0);

      // Tính tổng reward khi là referrer
      const totalReferrerReward = wallet.asReferrer.reduce((sum, rel) => sum + rel.totalReward, 0);
      const totalReferrerCount = wallet.asReferrer.reduce((sum, rel) => sum + rel.rewardCount, 0);

      // Sắp xếp theo level
      wallet.asInvitee.sort((a, b) => a.level - b.level);
      wallet.asReferrer.sort((a, b) => a.level - b.level);

      return {
        walletId: wallet.walletId,
        nickName: wallet.nickName,
        solanaAddress: wallet.solanaAddress,
        ethAddress: wallet.ethAddress,
        refCode: wallet.refCode,
        stats: {
          totalInviteeReward: Number(totalInviteeReward.toFixed(5)),
          totalInviteeCount,
          totalReferrerReward: Number(totalReferrerReward.toFixed(5)),
          totalReferrerCount,
          totalReward: Number((totalInviteeReward + totalReferrerReward).toFixed(5))
        },
        asInvitee: wallet.asInvitee, // Các mối quan hệ khi được giới thiệu
        asReferrer: wallet.asReferrer // Các mối quan hệ khi giới thiệu người khác
      };
    });

    // Sắp xếp theo tổng reward giảm dần
    allFormattedData.sort((a, b) => b.stats.totalReward - a.stats.totalReward);

    // Lọc theo search nếu có - chỉ lấy wallet có solanaAddress khớp
    let filteredData = allFormattedData;
    if (search) {
      filteredData = allFormattedData.filter(wallet => 
        wallet.solanaAddress && wallet.solanaAddress.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Áp dụng phân trang cho dữ liệu đã được nhóm và lọc
    const total = filteredData.length;
    const skip = (page - 1) * limit;
    const formattedData = filteredData.slice(skip, skip + limit);

    return {
      data: formattedData,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Lấy thống kê tổng quan về hệ thống referral truyền thống
   */
  async getTraditionalReferralStatistics(): Promise<{
    overview: {
      totalWallets: number;
      totalReferralRelations: number;
      totalRewards: number;
      totalTransactions: number;
      averageRewardPerWallet: number;
      averageRewardPerTransaction: number;
    };
    byLevel: {
      [key: string]: {
        count: number;
        totalReward: number;
        averageReward: number;
        totalTransactions: number;
      };
    };
    topPerformers: {
      topReferrers: Array<{
        walletId: number;
        nickName: string;
        solanaAddress: string;
        totalReferrerReward: number;
        totalInvitees: number;
      }>;
      topInvitees: Array<{
        walletId: number;
        nickName: string;
        solanaAddress: string;
        totalInviteeReward: number;
        totalReferrers: number;
      }>;
    };
    recentActivity: {
      last7Days: {
        newReferrals: number;
        newRewards: number;
        totalRewardAmount: number;
      };
      last30Days: {
        newReferrals: number;
        newRewards: number;
        totalRewardAmount: number;
      };
    };
  }> {
    // Lấy tất cả dữ liệu referral
    const allReferrals = await this.walletReferentRepository.find({
      relations: ['invitee', 'referent', 'rewards']
    });

    // Tính toán tổng quan
    const uniqueWallets = new Set();
    let totalTransactions = 0;
    const levelStats: { [key: string]: { count: number; totalReward: number; totalTransactions: number } } = {};
    const walletStats = new Map();

    allReferrals.forEach(referral => {
      const inviteeId = referral.invitee.wallet_id;
      const referentId = referral.referent.wallet_id;
      const level = referral.wr_wallet_level;
      const levelKey = `level_${level}`;

      // Thêm vào danh sách unique wallets
      uniqueWallets.add(inviteeId);
      uniqueWallets.add(referentId);

      // Tính reward cho referral này
      const referralReward = (referral.rewards || []).reduce((sum, reward) => {
        return sum + (parseFloat(String(reward.wrr_use_reward)) || 0);
      }, 0);

      const transactionCount = referral.rewards?.length || 0;

      // Cập nhật thống kê theo level
      if (!levelStats[levelKey]) {
        levelStats[levelKey] = { count: 0, totalReward: 0, totalTransactions: 0 };
      }
      levelStats[levelKey].count++;
      levelStats[levelKey].totalReward += referralReward;
      levelStats[levelKey].totalTransactions += transactionCount;

      // Cập nhật tổng transactions
      totalTransactions += transactionCount;

      // Cập nhật thống kê theo wallet
      if (!walletStats.has(inviteeId)) {
        walletStats.set(inviteeId, {
          walletId: inviteeId,
          nickName: referral.invitee.wallet_nick_name,
          solanaAddress: referral.invitee.wallet_solana_address,
          totalInviteeReward: 0,
          totalReferrerReward: 0,
          inviteeCount: 0,
          referrerCount: 0
        });
      }

      if (!walletStats.has(referentId)) {
        walletStats.set(referentId, {
          walletId: referentId,
          nickName: referral.referent.wallet_nick_name,
          solanaAddress: referral.referent.wallet_solana_address,
          totalInviteeReward: 0,
          totalReferrerReward: 0,
          inviteeCount: 0,
          referrerCount: 0
        });
      }

      const inviteeWallet = walletStats.get(inviteeId);
      const referentWallet = walletStats.get(referentId);

      // Cập nhật thống kê wallet
      inviteeWallet.totalInviteeReward += referralReward;
      inviteeWallet.inviteeCount++;
      referentWallet.totalReferrerReward += referralReward;
      referentWallet.referrerCount++;
    });

    // Tính toán thống kê theo level
    const byLevel: { [key: string]: { count: number; totalReward: number; averageReward: number; totalTransactions: number } } = {};
    Object.keys(levelStats).forEach(levelKey => {
      const stats = levelStats[levelKey];
      byLevel[levelKey] = {
        count: stats.count,
        totalReward: Number(stats.totalReward.toFixed(5)),
        averageReward: stats.count > 0 ? Number((stats.totalReward / stats.count).toFixed(5)) : 0,
        totalTransactions: stats.totalTransactions
      };
    });

    // Tìm top performers
    const walletArray = Array.from(walletStats.values());
    
    // Tính tổng phần thưởng của tất cả ví
    const totalRewards = walletArray.reduce((sum, wallet) => {
      return sum + wallet.totalInviteeReward + wallet.totalReferrerReward;
    }, 0);
    
    const topReferrers = walletArray
      .filter(wallet => wallet.totalReferrerReward > 0)
      .sort((a, b) => b.totalReferrerReward - a.totalReferrerReward)
      .slice(0, 10)
      .map(wallet => ({
        walletId: wallet.walletId,
        nickName: wallet.nickName,
        solanaAddress: wallet.solanaAddress,
        totalReferrerReward: Number(wallet.totalReferrerReward.toFixed(5)),
        totalInvitees: wallet.referrerCount
      }));

    const topInvitees = walletArray
      .filter(wallet => wallet.totalInviteeReward > 0)
      .sort((a, b) => b.totalInviteeReward - a.totalInviteeReward)
      .slice(0, 10)
      .map(wallet => ({
        walletId: wallet.walletId,
        nickName: wallet.nickName,
        solanaAddress: wallet.solanaAddress,
        totalInviteeReward: Number(wallet.totalInviteeReward.toFixed(5)),
        totalReferrers: wallet.inviteeCount
      }));

    // Tính toán hoạt động gần đây (giả định dựa trên rewards)
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Lấy rewards gần đây (giả định rewards có timestamp)
    const recentRewards = await this.walletReferentRepository
      .createQueryBuilder('referral')
      .leftJoinAndSelect('referral.rewards', 'rewards')
      .where('rewards.wrr_id IS NOT NULL')
      .getMany();

    let last7DaysRewards = 0;
    let last7DaysCount = 0;
    let last30DaysRewards = 0;
    let last30DaysCount = 0;

    recentRewards.forEach(referral => {
      referral.rewards.forEach(reward => {
        // Giả định reward có timestamp, nếu không có thì bỏ qua phần này
        const rewardAmount = parseFloat(String(reward.wrr_use_reward)) || 0;
        
        // Đếm tất cả rewards (vì không có timestamp)
        last7DaysRewards += rewardAmount;
        last7DaysCount++;
        last30DaysRewards += rewardAmount;
        last30DaysCount++;
      });
    });

    return {
      overview: {
        totalWallets: uniqueWallets.size,
        totalReferralRelations: allReferrals.length,
        totalRewards: Number(totalRewards.toFixed(5)),
        totalTransactions,
        averageRewardPerWallet: uniqueWallets.size > 0 ? Number((totalRewards / uniqueWallets.size).toFixed(5)) : 0,
        averageRewardPerTransaction: totalTransactions > 0 ? Number((totalRewards / totalTransactions).toFixed(5)) : 0
      },
      byLevel,
      topPerformers: {
        topReferrers,
        topInvitees
      },
      recentActivity: {
        last7Days: {
          newReferrals: 0, // Không có timestamp để tính
          newRewards: last7DaysCount,
          totalRewardAmount: Number(last7DaysRewards.toFixed(5))
        },
        last30Days: {
          newReferrals: 0, // Không có timestamp để tính
          newRewards: last30DaysCount,
          totalRewardAmount: Number(last30DaysRewards.toFixed(5))
        }
      }
    };
  }

  async updateUser(id: number, updateUserDto: Partial<{ username: string; email: string; password: string; role: string }>, currentUser: UserAdmin) {
    // Chỉ admin mới được cập nhật
    if (currentUser.role !== AdminRole.ADMIN) {
      throw new ForbiddenException('Only admin can update users');
    }
    // Không cho phép cập nhật admin khác
    const user = await this.userAdminRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === AdminRole.ADMIN && user.id !== currentUser.id) {
      throw new ForbiddenException('Cannot update another admin');
    }
    // Không cho phép đổi role thành admin nếu không phải chính mình
    if (updateUserDto.role === AdminRole.ADMIN && user.id !== currentUser.id) {
      throw new ForbiddenException('Cannot grant admin role to another user');
    }
    // Nếu có password thì hash lại
    if (updateUserDto.password) {
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
    }
    Object.assign(user, updateUserDto);
    await this.userAdminRepository.save(user);
    const { password, ...userInfo } = user;
    return { message: 'User updated successfully', user: userInfo };
  }

  async deleteUser(id: number, currentUser: UserAdmin) {
    if (currentUser.role !== AdminRole.ADMIN) {
      throw new ForbiddenException('Only admin can delete users');
    }
    const user = await this.userAdminRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === AdminRole.ADMIN) {
      throw new ForbiddenException('Cannot delete admin accounts');
    }
    await this.userAdminRepository.remove(user);
    return { message: 'User deleted successfully' };
  }

}
