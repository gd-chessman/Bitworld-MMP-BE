import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { AirdropListToken, AirdropListTokenStatus } from '../airdrops/entities/airdrop-list-token.entity';
import { AirdropListPool, AirdropPoolStatus } from '../airdrops/entities/airdrop-list-pool.entity';
import { AirdropPoolJoin, AirdropPoolJoinStatus } from '../airdrops/entities/airdrop-pool-join.entity';
import { AirdropReward, AirdropRewardStatus, AirdropRewardType } from '../airdrops/entities/airdrop-reward.entity';
import { AirdropPoolRound, AirdropPoolRoundStatus } from '../airdrops/entities/airdrop-pool-round.entity';
import { AirdropRoundDetail } from '../airdrops/entities/airdrop-round-detail.entity';
import { CreateAirdropTokenDto } from './dto/create-airdrop-token.dto';
import { UpdateAirdropTokenDto } from './dto/update-airdrop-token.dto';
import { GetAirdropTokensDto } from './dto/get-airdrop-tokens.dto';
import { AirdropCalculateDto } from './dto/airdrop-calculate.dto';
import { UserAdmin, AdminRole } from './entities/user-admin.entity';
import { RedisLockService } from '../common/services/redis-lock.service';
import { GetAirdropRewardsDto } from './dto/get-airdrop-rewards.dto';

@Injectable()
export class AirdropAdminService {
  private readonly logger = new Logger(AirdropAdminService.name);

  constructor(
    @InjectRepository(AirdropListToken)
    private readonly airdropListTokenRepository: Repository<AirdropListToken>,
    @InjectRepository(AirdropListPool)
    private readonly airdropListPoolRepository: Repository<AirdropListPool>,
    @InjectRepository(AirdropPoolJoin)
    private readonly airdropPoolJoinRepository: Repository<AirdropPoolJoin>,
    @InjectRepository(AirdropReward)
    private readonly airdropRewardRepository: Repository<AirdropReward>,
    @InjectRepository(AirdropPoolRound)
    private readonly airdropPoolRoundRepository: Repository<AirdropPoolRound>,
    @InjectRepository(AirdropRoundDetail)
    private readonly airdropRoundDetailRepository: Repository<AirdropRoundDetail>,
    private readonly redisLockService: RedisLockService,
  ) {}

  async createAirdropToken(createAirdropTokenDto: CreateAirdropTokenDto, currentUser: UserAdmin) {
    // Check if user has highest admin role
    if (currentUser.role !== AdminRole.ADMIN) {
      throw new ForbiddenException('Only highest admin role can create airdrop tokens');
    }

    const { token_name, token_mint, amount_round_1, amount_round_2 } = createAirdropTokenDto;

    // Check if token already exists with active or pause status in either round
    const existingToken = await this.airdropListTokenRepository.findOne({
      where: [
        {
          alt_token_mint: token_mint,
          alt_status_1: AirdropListTokenStatus.ACTIVE,
        },
        {
          alt_token_mint: token_mint,
          alt_status_1: AirdropListTokenStatus.PAUSE,
        },
        {
          alt_token_mint: token_mint,
          alt_status_2: AirdropListTokenStatus.ACTIVE,
        },
        {
          alt_token_mint: token_mint,
          alt_status_2: AirdropListTokenStatus.PAUSE,
        },
      ],
    });

    if (existingToken) {
      throw new BadRequestException('Airdrop program for this token already exists');
    }

    // Create new airdrop token
    const newAirdropToken = new AirdropListToken();
    newAirdropToken.alt_token_name = token_name;
    newAirdropToken.alt_token_mint = token_mint;
    newAirdropToken.alt_amount_airdrop_1 = amount_round_1;
    newAirdropToken.alt_status_1 = AirdropListTokenStatus.ACTIVE;

    // Handle round 2
    if (amount_round_2 && amount_round_2 > 0) {
      newAirdropToken.alt_amount_airdrop_2 = amount_round_2;
      newAirdropToken.alt_status_2 = AirdropListTokenStatus.ACTIVE;
    } else {
      newAirdropToken.alt_amount_airdrop_2 = null;
      newAirdropToken.alt_status_2 = AirdropListTokenStatus.CANCEL;
    }

    const savedToken = await this.airdropListTokenRepository.save(newAirdropToken);

    this.logger.log(`Created airdrop token: ${token_name} (${token_mint}) by admin: ${currentUser.username}`);

    return {
      success: true,
      message: 'Airdrop token created successfully',
      data: {
        alt_id: savedToken.alt_id,
        alt_token_name: savedToken.alt_token_name,
        alt_token_mint: savedToken.alt_token_mint,
        alt_amount_airdrop_1: savedToken.alt_amount_airdrop_1,
        alt_status_1: savedToken.alt_status_1,
        alt_amount_airdrop_2: savedToken.alt_amount_airdrop_2,
        alt_status_2: savedToken.alt_status_2,
      },
    };
  }

  async updateAirdropToken(tokenId: number, updateAirdropTokenDto: UpdateAirdropTokenDto, currentUser: UserAdmin) {
    // Check if user has highest admin role
    if (currentUser.role !== AdminRole.ADMIN) {
      throw new ForbiddenException('Only highest admin role can update airdrop tokens');
    }

    // Find the token
    const existingToken = await this.airdropListTokenRepository.findOne({
      where: { alt_id: tokenId }
    });

    if (!existingToken) {
      throw new NotFoundException('Airdrop token not found');
    }

    // Check if both rounds are ended or cancelled
    const isRound1Ended = existingToken.alt_status_1 === AirdropListTokenStatus.END || existingToken.alt_status_1 === AirdropListTokenStatus.CANCEL;
    const isRound2Ended = existingToken.alt_status_2 === AirdropListTokenStatus.END || existingToken.alt_status_2 === AirdropListTokenStatus.CANCEL;

    if (isRound1Ended && isRound2Ended) {
      throw new BadRequestException('Cannot update airdrop token when both rounds are ended or cancelled');
    }

    // Check if one round is ended and the other is cancelled
    if ((existingToken.alt_status_1 === AirdropListTokenStatus.END && existingToken.alt_status_2 === AirdropListTokenStatus.CANCEL) ||
        (existingToken.alt_status_1 === AirdropListTokenStatus.CANCEL && existingToken.alt_status_2 === AirdropListTokenStatus.END)) {
      throw new BadRequestException('Cannot update airdrop token when one round is ended and the other is cancelled');
    }

    const updateData: Partial<AirdropListToken> = {};

    // Handle round 1 updates
    if (existingToken.alt_status_1 === AirdropListTokenStatus.ACTIVE || existingToken.alt_status_1 === AirdropListTokenStatus.PAUSE) {
      // Can update token_name, token_mint, amount_round_1, and status_round_1
      if (updateAirdropTokenDto.token_name !== undefined) {
        updateData.alt_token_name = updateAirdropTokenDto.token_name;
      }
      if (updateAirdropTokenDto.token_mint !== undefined) {
        updateData.alt_token_mint = updateAirdropTokenDto.token_mint;
      }
      if (updateAirdropTokenDto.amount_round_1 !== undefined) {
        updateData.alt_amount_airdrop_1 = updateAirdropTokenDto.amount_round_1;
      }
      if (updateAirdropTokenDto.status_round_1 !== undefined) {
        updateData.alt_status_1 = updateAirdropTokenDto.status_round_1;
      }
    } else if (existingToken.alt_status_1 === AirdropListTokenStatus.END || existingToken.alt_status_1 === AirdropListTokenStatus.CANCEL) {
      // Can only update round 2
      if (updateAirdropTokenDto.token_name !== undefined || 
          updateAirdropTokenDto.token_mint !== undefined || 
          updateAirdropTokenDto.amount_round_1 !== undefined || 
          updateAirdropTokenDto.status_round_1 !== undefined) {
        throw new BadRequestException('Cannot update round 1 fields when round 1 is ended or cancelled');
      }
    }

    // Handle round 2 updates
    if (existingToken.alt_status_2 === AirdropListTokenStatus.ACTIVE || existingToken.alt_status_2 === AirdropListTokenStatus.PAUSE) {
      // Can update amount_round_2 and status_round_2
      if (updateAirdropTokenDto.amount_round_2 !== undefined) {
        updateData.alt_amount_airdrop_2 = updateAirdropTokenDto.amount_round_2;
      }
      if (updateAirdropTokenDto.status_round_2 !== undefined) {
        updateData.alt_status_2 = updateAirdropTokenDto.status_round_2;
      }
    } else if (existingToken.alt_status_2 === AirdropListTokenStatus.END || existingToken.alt_status_2 === AirdropListTokenStatus.CANCEL) {
      // Cannot update round 2
      if (updateAirdropTokenDto.amount_round_2 !== undefined || updateAirdropTokenDto.status_round_2 !== undefined) {
        throw new BadRequestException('Cannot update round 2 fields when round 2 is ended or cancelled');
      }
    }

    // If no updates to make, return current data
    if (Object.keys(updateData).length === 0) {
      return {
        success: true,
        message: 'No updates to apply',
        data: {
          alt_id: existingToken.alt_id,
          alt_token_name: existingToken.alt_token_name,
          alt_token_mint: existingToken.alt_token_mint,
          alt_amount_airdrop_1: existingToken.alt_amount_airdrop_1,
          alt_status_1: existingToken.alt_status_1,
          alt_amount_airdrop_2: existingToken.alt_amount_airdrop_2,
          alt_status_2: existingToken.alt_status_2,
        },
      };
    }

    // Update the token
    await this.airdropListTokenRepository.update({ alt_id: tokenId }, updateData);

    // Get the updated token
    const updatedToken = await this.airdropListTokenRepository.findOne({
      where: { alt_id: tokenId }
    });

    if (!updatedToken) {
      throw new NotFoundException('Failed to retrieve updated airdrop token');
    }

    this.logger.log(`Updated airdrop token: ${updatedToken.alt_token_name} (${updatedToken.alt_token_mint}) by admin: ${currentUser.username}`);

    return {
      success: true,
      message: 'Airdrop token updated successfully',
      data: {
        alt_id: updatedToken.alt_id,
        alt_token_name: updatedToken.alt_token_name,
        alt_token_mint: updatedToken.alt_token_mint,
        alt_amount_airdrop_1: updatedToken.alt_amount_airdrop_1,
        alt_status_1: updatedToken.alt_status_1,
        alt_amount_airdrop_2: updatedToken.alt_amount_airdrop_2,
        alt_status_2: updatedToken.alt_status_2,
      },
    };
  }

  async getAirdropTokens(getAirdropTokensDto: GetAirdropTokensDto) {
    const { page = 1, limit = 20, status_1, status_2, search } = getAirdropTokensDto;

    // Build query
    const queryBuilder = this.airdropListTokenRepository.createQueryBuilder('token');

    // Default filter: if no status_1 is provided, only show active or pause tokens
    if (!status_1) {
      queryBuilder.where('token.alt_status_1 IN (:...status1)', { 
        status1: [AirdropListTokenStatus.ACTIVE, AirdropListTokenStatus.PAUSE] 
      });
    } else {
      queryBuilder.where('token.alt_status_1 = :status1', { status1: status_1 });
    }

    // Add status_2 filter if provided
    if (status_2) {
      queryBuilder.andWhere('token.alt_status_2 = :status2', { status2: status_2 });
    }

    // Add search condition
    if (search) {
      queryBuilder.andWhere(
        '(LOWER(token.alt_token_name) LIKE LOWER(:search) OR LOWER(token.alt_token_mint) LIKE LOWER(:search))',
        { search: `%${search}%` }
      );
    }

    // Add ordering
    queryBuilder.orderBy('token.alt_id', 'DESC');

    // Add pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    // Execute query
    const [tokens, total] = await queryBuilder.getManyAndCount();

    // Calculate pagination info
    const totalPages = Math.ceil(total / limit);

    this.logger.log(`Retrieved ${tokens.length} airdrop tokens (page ${page}/${totalPages})`);

    return {
      success: true,
      message: 'Airdrop tokens retrieved successfully',
      data: tokens.map(token => ({
        alt_id: token.alt_id,
        alt_token_name: token.alt_token_name,
        alt_token_mint: token.alt_token_mint,
        alt_amount_airdrop_1: token.alt_amount_airdrop_1,
        alt_status_1: token.alt_status_1,
        alt_amount_airdrop_2: token.alt_amount_airdrop_2,
        alt_status_2: token.alt_status_2,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  async getAirdropRewards(getAirdropRewardsDto: GetAirdropRewardsDto) {
    const { page = 1, limit = 20, token_mint, alt_id, status = AirdropRewardStatus.CAN_WITHDRAW, search } = getAirdropRewardsDto;

    const offset = (page - 1) * limit;

    // Build query with proper joins
    const queryBuilder = this.airdropRewardRepository
      .createQueryBuilder('reward')
      .leftJoin('reward.tokenAirdrop', 'token')
      .leftJoin('reward.wallet', 'wallet')
      .leftJoin('wallet.wallet_auths', 'walletAuth')
      .leftJoin('walletAuth.wa_user', 'userWallet')
      .select([
        'reward.ar_id',
        'reward.ar_token_airdrop_id',
        'reward.ar_wallet_id',
        'reward.ar_wallet_address',
        'reward.ar_amount',
        'reward.ar_type',
        'reward.ar_status',
        'reward.ar_hash',
        'reward.ar_date',
        'wallet.wallet_solana_address',
        'wallet.bittworld_uid',
        'userWallet.uw_email',
        'token.alt_token_name',
        'token.alt_token_mint'
      ])
      .where('reward.ar_status = :status', { status });

    // Add filters
    if (token_mint) {
      queryBuilder.andWhere('token.alt_token_mint = :token_mint', { token_mint });
    }

    if (alt_id) {
      queryBuilder.andWhere('reward.ar_token_airdrop_id = :alt_id', { alt_id });
    }

    if (search) {
      queryBuilder.andWhere(
        '(wallet.wallet_solana_address ILIKE :search OR userWallet.uw_email ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    // Get total count
    const totalQuery = queryBuilder.clone();
    const total = await totalQuery.getCount();

    // Get paginated results
    const rewards = await queryBuilder
      .orderBy('reward.ar_date', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany();

    // Transform results
    const transformedRewards = rewards.map(reward => ({
      ar_id: reward.reward_ar_id,
      ar_token_airdrop_id: reward.reward_ar_token_airdrop_id,
      ar_wallet_id: reward.reward_ar_wallet_id,
      ar_wallet_address: reward.reward_ar_wallet_address,
      ar_amount: reward.reward_ar_amount,
      ar_type: reward.reward_ar_type,
      ar_status: reward.reward_ar_status,
      ar_hash: reward.reward_ar_hash,
      ar_date: reward.reward_ar_date,
      wallet_solana_address: reward.wallet_wallet_solana_address,
      wallet_email: reward.userWallet_uw_email,
      bittworld_uid: reward.wallet_bittworld_uid,
      token_name: reward.token_alt_token_name,
      token_mint: reward.token_alt_token_mint
    }));

    const totalPages = Math.ceil(total / limit);

    this.logger.log(`Retrieved ${transformedRewards.length} airdrop rewards (page ${page}/${totalPages}, total: ${total})`);

    return {
      rewards: transformedRewards,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    };
  }

  /**
   * Check if airdrop calculation is in progress
   */
  private async isAirdropCalculationInProgress(): Promise<boolean> {
    try {
      const lockKey = 'airdrop_calculation_global_lock';
      const currentLock = await this.redisLockService['redisService'].get(`lock:${lockKey}`);
      
      if (!currentLock) {
        return false;
      }

      // Redis will automatically handle TTL expiration, so we just need to check if the lock exists
      return true;
    } catch (error) {
      this.logger.error('Error checking airdrop calculation lock:', error);
      return false;
    }
  }

  /**
   * Acquire global lock for airdrop calculation
   */
  private async acquireAirdropCalculationLock(): Promise<string> {
    const lockKey = 'airdrop_calculation_global_lock';
    const lockId = Math.random().toString(36).substring(2);
    const timeout = 300; // 5 minutes timeout in seconds
    
    await this.redisLockService['redisService'].set(`lock:${lockKey}`, lockId, timeout);
    
    // Verify lock was acquired
    const currentLock = await this.redisLockService['redisService'].get(`lock:${lockKey}`);
    if (currentLock !== lockId) {
      throw new Error('Failed to acquire airdrop calculation lock');
    }
    
    this.logger.log(`Acquired airdrop calculation global lock: ${lockId}`);
    return lockId;
  }

  /**
   * Release global lock for airdrop calculation
   */
  private async releaseAirdropCalculationLock(lockId: string): Promise<void> {
    try {
      const lockKey = 'airdrop_calculation_global_lock';
      const currentLock = await this.redisLockService['redisService'].get(`lock:${lockKey}`);
      
      if (currentLock === lockId) {
        await this.redisLockService['redisService'].del(`lock:${lockKey}`);
        this.logger.log(`Released airdrop calculation global lock: ${lockId}`);
      }
    } catch (error) {
      this.logger.error('Error releasing airdrop calculation lock:', error);
    }
  }

  /**
   * Process active rounds before airdrop calculation
   * 1. Check if there's an active round
   * 2. If exists, update apj_round_end and apl_round_end for active pools/stakes
   * 3. Create airdrop_round_details records for active pools
   */
  private async processActiveRounds(): Promise<{
    hasActiveRound: boolean;
    activeRoundId?: number;
    processedPools: number;
    totalVolume: number;
  }> {
    this.logger.log('Starting active round processing...');

    // Step 1: Check if there's an active round
    const activeRound = await this.airdropPoolRoundRepository.findOne({
      where: { apr_status: AirdropPoolRoundStatus.ACTIVE }
    });

    if (!activeRound) {
      this.logger.log('No active round found, skipping round processing');
      return {
        hasActiveRound: false,
        processedPools: 0,
        totalVolume: 0
      };
    }

    this.logger.log(`Found active round: ${activeRound.apr_id} (Round ${activeRound.apr_num_round})`);

    const currentTime = new Date();
    let processedPools = 0;
    let totalVolume = 0;

    // Step 2: Get all active pools
    const activePools = await this.airdropListPoolRepository
      .createQueryBuilder('pool')
      .leftJoinAndSelect('pool.poolJoins', 'joins')
      .where('pool.apl_status = :status', { status: AirdropPoolStatus.ACTIVE })
      .getMany();

    this.logger.log(`Found ${activePools.length} active pools to process`);

    for (const pool of activePools) {
      let poolTotalVolume = 0;
      let hasUpdates = false;

      // Check if pool's apl_round_end is null (not processed yet)
      if (!pool.apl_round_end) {
        // Add initial pool volume only if apl_round_end is null
        poolTotalVolume += parseFloat(pool.apl_volume?.toString() || '0');
        
        // Update pool's apl_round_end
        await this.airdropListPoolRepository.update(
          { alp_id: pool.alp_id },
          { apl_round_end: currentTime }
        );
        
        hasUpdates = true;
        this.logger.log(`Updated pool ${pool.alp_id} apl_round_end to current time, added volume: ${pool.apl_volume}`);
      } else {
        this.logger.log(`Pool ${pool.alp_id} already has apl_round_end, skipping initial volume`);
      }

      // Process active stakes for this pool
      for (const join of pool.poolJoins) {
        if (join.apj_status === AirdropPoolJoinStatus.ACTIVE && !join.apj_round_end) {
          // Add stake volume only if apj_round_end is null
          const stakeVolume = parseFloat(join.apj_volume?.toString() || '0');
          poolTotalVolume += stakeVolume;
          
          // Update stake's apj_round_end
          await this.airdropPoolJoinRepository.update(
            { apj_id: join.apj_id },
            { apj_round_end: currentTime }
          );
          
          hasUpdates = true;
          this.logger.log(`Updated stake ${join.apj_id} apj_round_end to current time, added volume: ${stakeVolume}`);
        } else if (join.apj_status === AirdropPoolJoinStatus.ACTIVE && join.apj_round_end) {
          this.logger.log(`Stake ${join.apj_id} already has apj_round_end, skipping`);
        }
      }

      if (hasUpdates) {
        // Step 3: Check if round detail already exists for this pool and round
        const existingRoundDetail = await this.airdropRoundDetailRepository.findOne({
          where: {
            ard_pool_id: pool.alp_id,
            ard_round_id: activeRound.apr_id
          }
        });

        if (existingRoundDetail) {
          this.logger.log(`Round detail already exists for pool ${pool.alp_id} and round ${activeRound.apr_id}, skipping creation`);
        } else {
          // Create airdrop_round_details record for this pool
          const roundDetail = this.airdropRoundDetailRepository.create({
            ard_pool_id: pool.alp_id,
            ard_round_id: activeRound.apr_id,
            ard_total_volume: poolTotalVolume
          });

          await this.airdropRoundDetailRepository.save(roundDetail);
          
          this.logger.log(`Created round detail for pool ${pool.alp_id} with volume: ${poolTotalVolume}`);
        }
        
        totalVolume += poolTotalVolume;
        processedPools++;
      } else {
        this.logger.log(`Pool ${pool.alp_id} has no updates needed`);
      }
    }

    this.logger.log(`Round processing completed: ${processedPools} pools processed, total volume: ${totalVolume}`);

    return {
      hasActiveRound: true,
      activeRoundId: activeRound.apr_id,
      processedPools,
      totalVolume
    };
  }

  async calculateAirdropRewards(airdropCalculateDto: AirdropCalculateDto, currentUser: UserAdmin) {
    // Check if user has highest admin role
    if (currentUser.role !== AdminRole.ADMIN) {
      throw new ForbiddenException('Only highest admin role can calculate airdrop rewards');
    }

    // Step 1: Check if there are any active airdrop tokens
    const activeTokens = await this.airdropListTokenRepository.find({
      where: { alt_status_1: AirdropListTokenStatus.ACTIVE }
    });

    if (activeTokens.length === 0) {
      throw new BadRequestException('No active airdrop tokens found');
    }

    this.logger.log(`Found ${activeTokens.length} active airdrop tokens`);

    // Step 0: Acquire global lock for airdrop calculation
    let lockId: string;
    try {
      lockId = await this.acquireAirdropCalculationLock();
      this.logger.log('Acquired global lock for airdrop calculation');
    } catch (error) {
      this.logger.error('Failed to acquire global lock for airdrop calculation:', error);
      throw new BadRequestException('Airdrop calculation is already in progress. Please try again later.');
    }

    try {
      // Step 0: Process active rounds before calculation (only if active tokens exist)
      this.logger.log('Starting airdrop calculation process...');
      const roundProcessingResult = await this.processActiveRounds();
      
      if (roundProcessingResult.hasActiveRound) {
        this.logger.log(`Active round processing completed: Round ${roundProcessingResult.activeRoundId}, ${roundProcessingResult.processedPools} pools processed, total volume: ${roundProcessingResult.totalVolume}`);
      } else {
        this.logger.log('No active round found, proceeding with normal calculation');
      }

      const results: Array<{
        token_id: number;
        token_name: string;
        status: string;
        message?: string;
        total_volume?: number;
        total_rewards_created?: number;
        total_reward_amount?: number;
      }> = [];

      // Process each active token
      for (const token of activeTokens) {
        this.logger.log(`Processing token: ${token.alt_token_name} (ID: ${token.alt_id})`);

        // Check if rewards already exist for this token (unless force recalculate)
        if (!airdropCalculateDto.forceRecalculate) {
          const existingRewards = await this.airdropRewardRepository.findOne({
            where: { ar_token_airdrop_id: token.alt_id }
          });

          if (existingRewards) {
            this.logger.log(`Rewards already exist for token ${token.alt_token_name}, skipping...`);
            results.push({
              token_id: token.alt_id,
              token_name: token.alt_token_name,
              status: 'skipped',
              message: 'Rewards already exist for this token'
            });
            continue;
          }
        }

        // Step 2: Calculate total volume across all ACTIVE pools (M)
        const totalVolumeResult = await this.airdropListPoolRepository
          .createQueryBuilder('pool')
          .select('COALESCE(SUM(pool.apl_volume), 0)', 'totalPoolVolume')
          .where('pool.apl_status = :status', { status: AirdropPoolStatus.ACTIVE })
          .getRawOne();

        const totalStakeResult = await this.airdropPoolJoinRepository
          .createQueryBuilder('join')
          .select('COALESCE(SUM(join.apj_volume), 0)', 'totalStakeVolume')
          .where('join.apj_status = :status', { status: AirdropPoolJoinStatus.ACTIVE })
          .getRawOne();

        const totalVolume = parseFloat(totalVolumeResult?.totalPoolVolume || '0') + parseFloat(totalStakeResult?.totalStakeVolume || '0');

        if (totalVolume === 0) {
          this.logger.log(`No volume found for token ${token.alt_token_name}, skipping...`);
          results.push({
            token_id: token.alt_id,
            token_name: token.alt_token_name,
            status: 'skipped',
            message: 'No volume found for this token'
          });
          continue;
        }

        this.logger.log(`Total volume for token ${token.alt_token_name}: ${totalVolume}`);

        // Step 3: Get all ACTIVE pools and their volumes
        const pools = await this.airdropListPoolRepository
          .createQueryBuilder('pool')
          .leftJoinAndSelect('pool.poolJoins', 'joins')
          .leftJoinAndSelect('pool.originator', 'originator')
          .where('pool.apl_status = :status', { status: AirdropPoolStatus.ACTIVE })
          .getMany();

        this.logger.log(`Found ${pools.length} active pools to process`);

        const rewardsToCreate: Array<{
          ar_token_airdrop_id: number;
          ar_wallet_id: number;
          ar_wallet_address: string;
          ar_amount: number;
          ar_type: AirdropRewardType;
          ar_status: AirdropRewardStatus;
          ar_hash: string | null;
        }> = [];

        for (const pool of pools) {
          this.logger.log(`Processing pool ${pool.alp_id} (${pool.alp_name})`);

          // Calculate pool's total volume (initial + ACTIVE stakes) - X
          const poolStakeVolume = pool.poolJoins
            .filter(join => join.apj_status === AirdropPoolJoinStatus.ACTIVE)
            .reduce((sum, join) => sum + parseFloat(join.apj_volume?.toString() || '0'), 0);
          const poolTotalVolume = parseFloat(pool.apl_volume?.toString() || '0') + poolStakeVolume;

          if (poolTotalVolume === 0) {
            this.logger.log(`Pool ${pool.alp_id} has no volume, skipping...`);
            continue;
          }

          // Calculate pool's percentage of total volume (X/M %)
          const poolPercentage = poolTotalVolume / totalVolume;
          
          // Calculate pool's reward amount (Y = 100.000.000 x X/M %)
          const poolRewardAmount = token.alt_amount_airdrop_1 * poolPercentage;

          this.logger.log(`Pool ${pool.alp_id} (${pool.alp_name}): volume=${poolTotalVolume}, percentage=${(poolPercentage * 100).toFixed(2)}%, reward=${poolRewardAmount}`);

          // Step 4: Calculate rewards for pool creator (10% of pool reward)
          const creatorReward = poolRewardAmount * 0.1; // 10% x Y
          const remainingReward = poolRewardAmount * 0.9; // 90% x Y

          // Get all participants (creator + ACTIVE stakers)
          const participants = new Map<number, { wallet_id: number; wallet_address: string; total_volume: number }>();

          // Add creator to participants
          if (pool.originator) {
            const creatorStakeVolume = pool.poolJoins
              .filter(join => join.apj_member === pool.originator.wallet_id && join.apj_status === AirdropPoolJoinStatus.ACTIVE)
              .reduce((sum, join) => sum + parseFloat(join.apj_volume?.toString() || '0'), 0);
            
            const creatorTotalVolume = parseFloat(pool.apl_volume?.toString() || '0') + creatorStakeVolume;
            
            participants.set(pool.originator.wallet_id, {
              wallet_id: pool.originator.wallet_id,
              wallet_address: pool.originator.wallet_solana_address,
              total_volume: creatorTotalVolume
            });

            this.logger.log(`Added creator ${pool.originator.wallet_id} with total volume: ${creatorTotalVolume} (initial: ${pool.apl_volume}, active stake: ${creatorStakeVolume})`);
          }

          // Add all ACTIVE stakers to participants
          for (const join of pool.poolJoins) {
            if (join.apj_status === AirdropPoolJoinStatus.ACTIVE && !participants.has(join.apj_member)) {
              const stakerWallet = await this.airdropPoolJoinRepository
                .createQueryBuilder('join')
                .leftJoinAndSelect('join.member', 'wallet')
                .where('join.apj_member = :walletId', { walletId: join.apj_member })
                .getOne();

              if (stakerWallet?.member) {
                const stakerVolume = parseFloat(join.apj_volume?.toString() || '0');
                participants.set(join.apj_member, {
                  wallet_id: join.apj_member,
                  wallet_address: stakerWallet.member.wallet_solana_address,
                  total_volume: stakerVolume
                });

                this.logger.log(`Added active staker ${join.apj_member} with volume: ${stakerVolume}`);
              } else {
                this.logger.warn(`Active staker wallet ${join.apj_member} not found for pool ${pool.alp_id}`);
              }
            }
          }

          this.logger.log(`Total participants in pool ${pool.alp_id}: ${participants.size}`);

          // Calculate total volume of all participants
          const totalParticipantVolume = Array.from(participants.values()).reduce((sum, participant) => sum + participant.total_volume, 0);

          // Distribute rewards to each participant
          for (const [walletId, participant] of participants) {
            let participantReward = 0;

            if (pool.originator && walletId === pool.originator.wallet_id) {
              // Creator gets 10% + their share of the remaining 90%
              const creatorSharePercentage = participant.total_volume / poolTotalVolume;
              const creatorRemainingReward = remainingReward * creatorSharePercentage;
              participantReward = creatorReward + creatorRemainingReward;
              
              this.logger.log(`Creator ${walletId} reward: ${creatorReward} (10%) + ${creatorRemainingReward} (90% share) = ${participantReward}`);
            } else {
              // Stakers get their share of the remaining 90%
              const stakerSharePercentage = participant.total_volume / poolTotalVolume;
              participantReward = remainingReward * stakerSharePercentage;
              
              this.logger.log(`Staker ${walletId} reward: ${participantReward} (90% share based on volume ${participant.total_volume})`);
            }

            if (participantReward > 0) {
              rewardsToCreate.push({
                ar_token_airdrop_id: token.alt_id,
                ar_wallet_id: walletId,
                ar_wallet_address: participant.wallet_address,
                ar_amount: participantReward,
                ar_type: AirdropRewardType.TYPE_1,
                ar_status: AirdropRewardStatus.CAN_WITHDRAW,
                ar_hash: null
              });

              this.logger.log(`Created reward for wallet ${walletId}: ${participantReward} tokens`);
            } else {
              this.logger.warn(`No reward calculated for wallet ${walletId} in pool ${pool.alp_id}`);
            }
          }

          // Verify pool calculation
          const poolTotalReward = rewardsToCreate
            .filter(reward => {
              // Check if this reward belongs to this pool by checking if the wallet is a participant
              return participants.has(reward.ar_wallet_id);
            })
            .reduce((sum, reward) => sum + reward.ar_amount, 0);

          this.logger.log(`Pool ${pool.alp_id} total reward distributed: ${poolTotalReward} (expected: ${poolRewardAmount})`);
          
          if (Math.abs(poolTotalReward - poolRewardAmount) > 0.01) {
            this.logger.warn(`Pool ${pool.alp_id} reward mismatch: calculated ${poolTotalReward} vs expected ${poolRewardAmount}`);
          }
        }

        // Step 6: Save all rewards to database
        if (rewardsToCreate.length > 0) {
          await this.airdropRewardRepository.save(rewardsToCreate);
          this.logger.log(`Created ${rewardsToCreate.length} rewards for token ${token.alt_token_name}`);
        } else {
          this.logger.warn(`No rewards created for token ${token.alt_token_name}`);
        }

        // Step 7: Update token status to 'end' after calculation (regardless of whether rewards were created)
        await this.airdropListTokenRepository.update(
          { alt_id: token.alt_id },
          { alt_status_1: AirdropListTokenStatus.END }
        );
        this.logger.log(`Updated token ${token.alt_token_name} (ID: ${token.alt_id}) status to 'end'`);

        // Verify total calculation
        const totalRewardDistributed = rewardsToCreate.reduce((sum, reward) => sum + reward.ar_amount, 0);
        const expectedTotalReward = token.alt_amount_airdrop_1;

        this.logger.log(`Token ${token.alt_token_name} total reward distributed: ${totalRewardDistributed} (expected: ${expectedTotalReward})`);

        if (Math.abs(totalRewardDistributed - expectedTotalReward) > 0.01) {
          this.logger.warn(`Token ${token.alt_token_name} total reward mismatch: distributed ${totalRewardDistributed} vs expected ${expectedTotalReward}`);
        }

        results.push({
          token_id: token.alt_id,
          token_name: token.alt_token_name,
          status: 'completed',
          total_volume: totalVolume,
          total_rewards_created: rewardsToCreate.length,
          total_reward_amount: totalRewardDistributed
        });
      }

      this.logger.log(`Airdrop calculation completed by admin: ${currentUser.username}`);

      return {
        success: true,
        message: 'Airdrop rewards calculated successfully',
        data: {
          processed_tokens: results.length,
          results: results
        }
      };
    } finally {
      // Release the global lock
      await this.releaseAirdropCalculationLock(lockId);
      this.logger.log('Released global lock for airdrop calculation');
    }
  }
} 