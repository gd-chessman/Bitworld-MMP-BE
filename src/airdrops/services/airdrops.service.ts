import { Injectable, Logger, BadRequestException, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AirdropListPool, AirdropPoolStatus } from '../entities/airdrop-list-pool.entity';
import { AirdropPoolJoin, AirdropPoolJoinStatus } from '../entities/airdrop-pool-join.entity';
import { ListWallet } from '../../telegram-wallets/entities/list-wallet.entity';
import { CreatePoolDto } from '../dto/create-pool.dto';
import { StakePoolDto } from '../dto/join-pool.dto';
import { PoolInfoDto } from '../dto/get-pools-response.dto';
import { PoolDetailDto, MemberInfoDto } from '../dto/get-pool-detail-response.dto';
import { GetPoolDetailDto, SortField, SortOrder } from '../dto/get-pool-detail.dto';
import { PoolDetailTransactionsDto, TransactionInfoDto } from '../dto/get-pool-detail-transactions-response.dto';
import { GetPoolDetailTransactionsDto, TransactionSortField, TransactionSortOrder } from '../dto/get-pool-detail-transactions.dto';
import { GetPoolsDto, PoolSortField, PoolSortOrder, PoolFilterType } from '../dto/get-pools.dto';
import { SolanaService } from '../../solana/solana.service';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getAssociatedTokenAddress as getATA } from '@project-serum/associated-token';
import bs58 from 'bs58';
import { RedisLockService } from '../../common/services/redis-lock.service';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';

@Injectable()
export class AirdropsService {
    private readonly logger = new Logger(AirdropsService.name);
    private readonly MAX_RETRY_ATTEMPTS = 3;
    private readonly LOCK_TTL = 300; // 5 minutes

    constructor(
        @InjectRepository(AirdropListPool)
        private readonly airdropListPoolRepository: Repository<AirdropListPool>,
        @InjectRepository(AirdropPoolJoin)
        private readonly airdropPoolJoinRepository: Repository<AirdropPoolJoin>,
        @InjectRepository(ListWallet)
        private readonly listWalletRepository: Repository<ListWallet>,
        private readonly configService: ConfigService,
        private readonly solanaService: SolanaService,
        @Inject('SOLANA_CONNECTION')
        private readonly connection: Connection,
        private readonly redisLockService: RedisLockService,
        private readonly cloudinaryService: CloudinaryService
    ) {}

    async createPool(walletId: number, createPoolDto: CreatePoolDto, logoFile?: Express.Multer.File) {
        // Create lock key to prevent duplicate API calls
        const lockKey = `create_pool_${walletId}`;
        
        // Use withLock to automatically handle lock/release
        return await this.redisLockService.withLock(lockKey, async () => {
            // 1. Check minimum initial amount
            if (createPoolDto.initialAmount < 1000000) {
                throw new BadRequestException('Initial amount must be at least 1,000,000');
            }

            // 2. Check if there's any pending pool for this wallet
            const existingPendingPool = await this.airdropListPoolRepository.findOne({
                where: {
                    alp_originator: walletId,
                    apl_status: AirdropPoolStatus.PENDING
                }
            });

            if (existingPendingPool) {
                throw new BadRequestException('You already have a pool in creation process. Please wait for completion.');
            }

            // 3. Get wallet information
            const wallet = await this.listWalletRepository.findOne({
                where: { wallet_id: walletId }
            });

            if (!wallet) {
                throw new BadRequestException('Wallet does not exist');
            }

            // 4. Check token X balance
            const mintTokenAirdrop = this.configService.get<string>('MINT_TOKEN_AIRDROP');
            if (!mintTokenAirdrop) {
                throw new HttpException('MINT_TOKEN_AIRDROP configuration does not exist', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            const tokenBalance = await this.solanaService.getTokenBalance(
                wallet.wallet_solana_address,
                mintTokenAirdrop
            );

            if (tokenBalance < createPoolDto.initialAmount) {
                throw new BadRequestException(`Insufficient token X balance. Current: ${tokenBalance}, Required: ${createPoolDto.initialAmount}`);
            }

            // 5. Check SOL balance and transfer fee if needed
            let solBalance = await this.solanaService.getBalance(wallet.wallet_solana_address);
            const requiredSolFee = 0.00002; // 0.00002 SOL

            if (solBalance < requiredSolFee) {
                this.logger.log(`Insufficient SOL balance (${solBalance} SOL), need to transfer ${requiredSolFee} SOL to wallet ${wallet.wallet_solana_address}`);
                
                const supportFeePrivateKey = this.configService.get<string>('WALLET_SUP_FREE_PRIVATE_KEY');
                if (!supportFeePrivateKey) {
                    throw new HttpException('WALLET_SUP_FREE_PRIVATE_KEY configuration does not exist', HttpStatus.INTERNAL_SERVER_ERROR);
                }

                try {
                    const solTransferSignature = await this.transferSolForFee(supportFeePrivateKey, wallet.wallet_solana_address, requiredSolFee);
                    this.logger.log(`Successfully transferred ${requiredSolFee} SOL to wallet ${wallet.wallet_solana_address}, signature: ${solTransferSignature}`);
                    
                    // Wait for transaction to be confirmed
                    await this.waitForTransactionConfirmation(solTransferSignature);
                    this.logger.log(`SOL fee transaction confirmed: ${solTransferSignature}`);
                    
                    // Check SOL balance again after transfer
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s for balance update
                    solBalance = await this.solanaService.getBalance(wallet.wallet_solana_address);
                    
                    if (solBalance < requiredSolFee) {
                        throw new Error(`SOL balance still insufficient after fee transfer. Current: ${solBalance} SOL`);
                    }
                    
                } catch (error) {
                    this.logger.error(`Error transferring SOL fee: ${error.message}`);
                    throw new BadRequestException('Cannot transfer SOL fee. Please try again later.');
                }
            }

            // 6. Process logo
            let logoUrl = createPoolDto.logo || '';
            
            if (logoFile) {
                try {
                    // Upload file to Cloudinary using CloudinaryService
                    logoUrl = await this.cloudinaryService.uploadAirdropLogo(logoFile);
                    this.logger.log(`Logo uploaded successfully: ${logoUrl}`);
                } catch (error) {
                    this.logger.error(`Error uploading logo: ${error.message}`);
                    throw new BadRequestException('Cannot upload logo. Please try again.');
                }
            }

            // 7. Create pool with pending status (temporarily without slug)
            const currentDate = new Date();
            const endDate = new Date(currentDate.getTime() + (365 * 24 * 60 * 60 * 1000)); // +365 days
            
            const newPool = this.airdropListPoolRepository.create({
                alp_originator: walletId,
                alp_name: createPoolDto.name,
                alp_slug: '', // Will be updated after getting ID
                alp_describe: createPoolDto.describe || '',
                alp_logo: logoUrl,
                alp_member_num: 0,
                apl_volume: createPoolDto.initialAmount,
                apl_creation_date: currentDate,
                apl_end_date: endDate,
                apl_status: AirdropPoolStatus.PENDING
            });

            const savedPool = await this.airdropListPoolRepository.save(newPool);

            // 8. Create slug with ID and update
            const slug = this.generateSlug(createPoolDto.name, savedPool.alp_id);
            await this.airdropListPoolRepository.update(
                { alp_id: savedPool.alp_id },
                { alp_slug: slug }
            );

            // 9. Execute token transfer transaction
            const walletBittAddress = this.configService.get<string>('WALLET_BITT');
            if (!walletBittAddress) {
                throw new HttpException('WALLET_BITT configuration does not exist', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            let transactionHash: string | null = null;
            let success = false;

            // Try transaction up to 3 times
            for (let attempt = 1; attempt <= this.MAX_RETRY_ATTEMPTS; attempt++) {
                try {
                    this.logger.log(`Executing token transfer transaction attempt ${attempt} for pool ${savedPool.alp_id}`);
                    
                    // Check if any transaction has already been sent for this pool
                    const existingPool = await this.airdropListPoolRepository.findOne({
                        where: { alp_id: savedPool.alp_id }
                    });
                    
                    if (existingPool && existingPool.apl_hash) {
                        this.logger.log(`Pool ${savedPool.alp_id} already has transaction hash: ${existingPool.apl_hash}`);
                        transactionHash = existingPool.apl_hash;
                        success = true;
                        break;
                    }
                    
                    // Create unique transaction ID to avoid duplication
                    const transactionId = `pool_${savedPool.alp_id}_${Date.now()}_${Math.random()}`;
                    
                    transactionHash = await this.transferTokenToBittWallet(
                        wallet.wallet_private_key,
                        mintTokenAirdrop,
                        walletBittAddress,
                        createPoolDto.initialAmount,
                        transactionId
                    );

                    // Wait for transaction to be confirmed
                    await this.waitForTransactionConfirmation(transactionHash);
                    this.logger.log(`BITT transaction confirmed: ${transactionHash}`);

                    success = true;
                    break;

                } catch (error) {
                    this.logger.error(`Attempt ${attempt} failed: ${error.message}`);
                    
                    if (attempt === this.MAX_RETRY_ATTEMPTS) {
                        this.logger.error(`Tried maximum ${this.MAX_RETRY_ATTEMPTS} times but still failed`);
                        break;
                    }
                    
                    // Wait 3 seconds before retrying
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }

            // 10. Update pool status and transaction hash
            const finalStatus = success ? AirdropPoolStatus.ACTIVE : AirdropPoolStatus.ERROR;
            const updateData: any = { apl_status: finalStatus };
            
            if (success && transactionHash) {
                updateData.apl_hash = transactionHash;
            }
            
            await this.airdropListPoolRepository.update(
                { alp_id: savedPool.alp_id },
                updateData
            );

            // 11. Log final result
            if (success) {
                this.logger.log(`Pool ${savedPool.alp_id} created successfully with transaction hash: ${transactionHash}`);
            } else {
                this.logger.error(`Pool ${savedPool.alp_id} creation failed due to onchain transaction failure`);
            }

            return {
                success: true,
                message: success ? 'Pool created successfully' : 'Pool creation failed due to onchain transaction',
                data: {
                    poolId: savedPool.alp_id,
                    name: savedPool.alp_name,
                    slug: slug,
                    logo: logoUrl,
                    status: finalStatus,
                    initialAmount: createPoolDto.initialAmount,
                    transactionHash: transactionHash
                }
            };
        }, this.LOCK_TTL * 1000); // Convert to milliseconds
    }

    async stakePool(walletId: number, stakePoolDto: StakePoolDto) {
        // Create lock key to prevent duplicate API calls
        const lockKey = `stake_pool_${walletId}_${stakePoolDto.poolId}`;
        
        // Use withLock to automatically handle lock/release
        return await this.redisLockService.withLock(lockKey, async () => {
            // 1. Check if pool exists and is active
            const pool = await this.airdropListPoolRepository.findOne({
                where: { alp_id: stakePoolDto.poolId }
            });

            if (!pool) {
                throw new BadRequestException('Pool does not exist');
            }

            if (pool.apl_status !== AirdropPoolStatus.ACTIVE) {
                throw new BadRequestException('Pool is not in active status');
            }

            // 2. Check if user already has stake record in this pool
            const existingJoin = await this.airdropPoolJoinRepository.findOne({
                where: {
                    apj_pool_id: stakePoolDto.poolId,
                    apj_member: walletId
                }
            });

            // 3. Get wallet information
            const wallet = await this.listWalletRepository.findOne({
                where: { wallet_id: walletId }
            });

            if (!wallet) {
                throw new BadRequestException('Wallet does not exist');
            }

            // 4. Check token X balance
            const mintTokenAirdrop = this.configService.get<string>('MINT_TOKEN_AIRDROP');
            if (!mintTokenAirdrop) {
                throw new HttpException('MINT_TOKEN_AIRDROP configuration does not exist', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            const tokenBalance = await this.solanaService.getTokenBalance(
                wallet.wallet_solana_address,
                mintTokenAirdrop
            );

            if (tokenBalance < stakePoolDto.stakeAmount) {
                throw new BadRequestException(`Insufficient token X balance. Current: ${tokenBalance}, Required: ${stakePoolDto.stakeAmount}`);
            }

            // 5. Check SOL balance and transfer fee if needed
            let solBalance = await this.solanaService.getBalance(wallet.wallet_solana_address);
            const requiredSolFee = 0.00002; // 0.00002 SOL

            if (solBalance < requiredSolFee) {
                this.logger.log(`Insufficient SOL balance (${solBalance} SOL), need to transfer ${requiredSolFee} SOL to wallet ${wallet.wallet_solana_address}`);
                
                const supportFeePrivateKey = this.configService.get<string>('WALLET_SUP_FREE_PRIVATE_KEY');
                if (!supportFeePrivateKey) {
                    throw new HttpException('WALLET_SUP_FREE_PRIVATE_KEY configuration does not exist', HttpStatus.INTERNAL_SERVER_ERROR);
                }

                let solTransferSuccess = false;
                let solTransferSignature: string | null = null;

                // Try transferring SOL fee up to 3 times
                for (let solAttempt = 1; solAttempt <= this.MAX_RETRY_ATTEMPTS; solAttempt++) {
                    try {
                        this.logger.log(`Executing SOL fee transfer attempt ${solAttempt} for wallet ${wallet.wallet_solana_address}`);
                        
                        solTransferSignature = await this.transferSolForFee(supportFeePrivateKey, wallet.wallet_solana_address, requiredSolFee);
                        this.logger.log(`Successfully transferred ${requiredSolFee} SOL to wallet ${wallet.wallet_solana_address}, signature: ${solTransferSignature}`);
                        
                        // Wait for transaction to be confirmed
                        await this.waitForTransactionConfirmation(solTransferSignature);
                        this.logger.log(`SOL fee transaction confirmed: ${solTransferSignature}`);
                        
                        // Check SOL balance again after transfer
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s for balance update
                        solBalance = await this.solanaService.getBalance(wallet.wallet_solana_address);
                        
                        if (solBalance < requiredSolFee) {
                            throw new Error(`SOL balance still insufficient after fee transfer. Current: ${solBalance} SOL`);
                        }
                        
                        solTransferSuccess = true;
                        break;
                        
                    } catch (error) {
                        this.logger.error(`SOL fee transfer attempt ${solAttempt} failed: ${error.message}`);
                        
                        if (solAttempt === this.MAX_RETRY_ATTEMPTS) {
                            this.logger.error(`Tried maximum ${this.MAX_RETRY_ATTEMPTS} SOL fee transfers but still failed`);
                            break;
                        }
                        
                        // Wait 2 seconds before retrying
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }

                if (!solTransferSuccess) {
                    throw new BadRequestException('Cannot transfer SOL fee after multiple attempts. Please try again later.');
                }
            }

            // 6. Create join record with pending status
            const currentDate = new Date();
            const stakeEndDate = new Date(currentDate.getTime() + (365 * 24 * 60 * 60 * 1000)); // +365 days
            
            const newJoin = this.airdropPoolJoinRepository.create({
                apj_pool_id: stakePoolDto.poolId,
                apj_member: walletId,
                apj_volume: stakePoolDto.stakeAmount,
                apj_stake_date: currentDate,
                apj_stake_end: stakeEndDate,
                apj_status: AirdropPoolJoinStatus.PENDING
            });

            const savedJoin = await this.airdropPoolJoinRepository.save(newJoin);

            // 7. Execute token transfer transaction
            const walletBittAddress = this.configService.get<string>('WALLET_BITT');
            if (!walletBittAddress) {
                throw new HttpException('WALLET_BITT configuration does not exist', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            let transactionHash: string | null = null;
            let success = false;

            // Try transaction up to 3 times
            for (let attempt = 1; attempt <= this.MAX_RETRY_ATTEMPTS; attempt++) {
                try {
                    this.logger.log(`Executing stake token transaction attempt ${attempt} for join ${savedJoin.apj_id}`);
                    
                    // Check if any transaction has already been sent for this join
                    const existingJoinRecord = await this.airdropPoolJoinRepository.findOne({
                        where: { apj_id: savedJoin.apj_id }
                    });
                    
                    if (existingJoinRecord && existingJoinRecord.apj_status === AirdropPoolJoinStatus.ACTIVE) {
                        this.logger.log(`Join ${savedJoin.apj_id} has already been processed successfully`);
                        transactionHash = 'already_processed';
                        success = true;
                        break;
                    }
                    
                    // Create unique transaction ID to avoid duplication
                    const transactionId = `stake_${savedJoin.apj_id}_${Date.now()}_${Math.random()}`;
                    
                    transactionHash = await this.transferTokenToBittWallet(
                        wallet.wallet_private_key,
                        mintTokenAirdrop,
                        walletBittAddress,
                        stakePoolDto.stakeAmount,
                        transactionId
                    );

                    // Wait for transaction to be confirmed
                    await this.waitForTransactionConfirmation(transactionHash);
                    this.logger.log(`Stake BITT transaction confirmed: ${transactionHash}`);

                    success = true;
                    break;

                } catch (error) {
                    this.logger.error(`Attempt ${attempt} failed: ${error.message}`);
                    
                    if (attempt === this.MAX_RETRY_ATTEMPTS) {
                        this.logger.error(`Tried maximum ${this.MAX_RETRY_ATTEMPTS} times but still failed`);
                        break;
                    }
                    
                    // Wait 3 seconds before retrying
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }

            // 8. Update join status and transaction hash
            const finalStatus = success ? AirdropPoolJoinStatus.ACTIVE : AirdropPoolJoinStatus.ERROR;
            const updateData: any = { apj_status: finalStatus };
            
            if (success && transactionHash && transactionHash !== 'already_processed') {
                updateData.apj_hash = transactionHash;
            }
            
            await this.airdropPoolJoinRepository.update(
                { apj_id: savedJoin.apj_id },
                updateData
            );

            // 9. Update pool member count and volume
            if (success) {
                // If user doesn't have stake record, increase member count
                const memberIncrement = existingJoin ? 0 : 1;
                
                await this.airdropListPoolRepository.update(
                    { alp_id: stakePoolDto.poolId },
                    {
                        alp_member_num: pool.alp_member_num + memberIncrement,
                        apl_volume: pool.apl_volume + stakePoolDto.stakeAmount
                    }
                );
            }

            // 10. Log final result
            if (success) {
                this.logger.log(`Join ${savedJoin.apj_id} created successfully with transaction hash: ${transactionHash}`);
            } else {
                this.logger.error(`Join ${savedJoin.apj_id} creation failed due to onchain transaction failure`);
            }

            return {
                success: true,
                message: success ? 'Stake pool successful' : 'Stake pool failed due to onchain transaction',
                data: {
                    joinId: savedJoin.apj_id,
                    poolId: stakePoolDto.poolId,
                    stakeAmount: stakePoolDto.stakeAmount,
                    status: finalStatus,
                    transactionHash: transactionHash === 'already_processed' ? null : transactionHash
                }
            };
        }, this.LOCK_TTL * 1000); // Convert to milliseconds
    }

    async getPools(walletId: number, query: GetPoolsDto = {}): Promise<PoolInfoDto[]> {
        try {
            // 1. Xác định filter type và trường sắp xếp với validation
            const filterType = query.filterType || PoolFilterType.ALL;
            const sortBy = query.sortBy || PoolSortField.CREATION_DATE;
            const sortOrder = query.sortOrder || PoolSortOrder.DESC;

            this.logger.log(`Filter: ${filterType}, Sort: ${sortBy}, Order: ${sortOrder}`);

            // 2. Tạo order object cho TypeORM
            let orderObject: any = {};
            switch (sortBy) {
                case PoolSortField.CREATION_DATE:
                    orderObject = { apl_creation_date: sortOrder.toUpperCase() };
                    break;
                case PoolSortField.NAME:
                    orderObject = { alp_name: sortOrder.toUpperCase() };
                    break;
                case PoolSortField.MEMBER_COUNT:
                    orderObject = { alp_member_num: sortOrder.toUpperCase() };
                    break;
                case PoolSortField.TOTAL_VOLUME:
                    orderObject = { apl_volume: sortOrder.toUpperCase() };
                    break;
                case PoolSortField.END_DATE:
                    orderObject = { apl_end_date: sortOrder.toUpperCase() };
                    break;
                default:
                    orderObject = { apl_creation_date: 'DESC' };
            }

            // 3. Xử lý filter và lấy pools
            let pools: AirdropListPool[] = [];

            switch (filterType) {
                case PoolFilterType.ALL:
                    // Lấy tất cả pools đang hoạt động
                    pools = await this.airdropListPoolRepository.find({
                        where: { apl_status: AirdropPoolStatus.ACTIVE },
                        order: orderObject
                    });
                    break;

                case PoolFilterType.CREATED:
                    // Chỉ lấy pools do user tạo
                    pools = await this.airdropListPoolRepository.find({
                        where: {
                            apl_status: AirdropPoolStatus.ACTIVE,
                            alp_originator: walletId
                        },
                        order: orderObject
                    });
                    break;

                case PoolFilterType.JOINED:
                    // Lấy pools mà user đã tham gia (không phải creator)
                    // Sử dụng JOIN để tối ưu performance
                    const joinedPools = await this.airdropListPoolRepository
                        .createQueryBuilder('pool')
                        .innerJoin('airdrop_pool_joins', 'join', 'join.apj_pool_id = pool.alp_id')
                        .where('pool.apl_status = :status', { status: AirdropPoolStatus.ACTIVE })
                        .andWhere('join.apj_member = :walletId', { walletId })
                        .andWhere('join.apj_status = :joinStatus', { joinStatus: AirdropPoolJoinStatus.ACTIVE })
                        .orderBy(`pool.${this.getOrderByField(sortBy)}`, sortOrder.toUpperCase() as 'ASC' | 'DESC')
                        .getMany();
                    
                    pools = joinedPools;
                    break;

                default:
                    // Fallback to ALL if filterType is invalid
                    this.logger.warn(`Invalid filterType: ${filterType}, falling back to ALL`);
                    pools = await this.airdropListPoolRepository.find({
                        where: { apl_status: AirdropPoolStatus.ACTIVE },
                        order: orderObject
                    });
                    break;
            }

            const poolsWithUserInfo: PoolInfoDto[] = [];

            for (const pool of pools) {
                // 2. Lấy thông tin ví khởi tạo pool
                const creatorWallet = await this.listWalletRepository.findOne({
                    where: { wallet_id: pool.alp_originator }
                });

                // 3. Kiểm tra xem user có phải là creator của pool không
                const isCreator = pool.alp_originator === walletId;

                // 4. Lấy thông tin stake của user trong pool này
                const userStakes = await this.airdropPoolJoinRepository.find({
                    where: {
                        apj_pool_id: pool.alp_id,
                        apj_member: walletId,
                        apj_status: AirdropPoolJoinStatus.ACTIVE
                    }
                });

                // 4. Tính tổng volume user đã stake
                let totalUserStaked = 0;
                if (userStakes.length > 0) {
                    totalUserStaked = userStakes.reduce((sum, stake) => sum + Number(stake.apj_volume), 0);
                }

                // 5. Nếu user là creator, cộng thêm volume ban đầu
                if (isCreator) {
                    totalUserStaked += Number(pool.apl_volume);
                }

                // 6. Tạo thông tin pool với user info
                const poolInfo: PoolInfoDto = {
                    poolId: pool.alp_id,
                    name: pool.alp_name,
                    slug: pool.alp_slug,
                    logo: pool.alp_logo || '',
                    describe: pool.alp_describe || '',
                    memberCount: pool.alp_member_num,
                    totalVolume: Number(pool.apl_volume),
                    creationDate: pool.apl_creation_date,
                    endDate: pool.apl_end_date,
                    status: pool.apl_status,
                    creatorAddress: creatorWallet?.wallet_solana_address || '',
                    creatorBittworldUid: creatorWallet?.bittworld_uid || null
                };

                // 7. Thêm thông tin stake của user nếu có
                if (userStakes.length > 0 || isCreator) {
                    // Lấy ngày stake đầu tiên hoặc ngày tạo pool
                    const firstStakeDate = userStakes.length > 0 
                        ? userStakes[0].apj_stake_date 
                        : pool.apl_creation_date;

                    poolInfo.userStakeInfo = {
                        isCreator: isCreator,
                        joinStatus: userStakes.length > 0 ? 'active' : 'creator',
                        joinDate: firstStakeDate,
                        totalStaked: totalUserStaked
                    };
                }

                poolsWithUserInfo.push(poolInfo);
            }

            return poolsWithUserInfo;

        } catch (error) {
            this.logger.error(`Error getting pools list: ${error.message}`);
            throw error;
        }
    }

    async getPoolDetailByIdOrSlug(idOrSlug: string, walletId: number, query: GetPoolDetailDto): Promise<PoolDetailDto> {
        try {
            // Check if idOrSlug is numeric
            const isNumeric = !isNaN(Number(idOrSlug));
            
            let pool;
            if (isNumeric) {
                // Find by ID
                pool = await this.airdropListPoolRepository.findOne({
                    where: { alp_id: parseInt(idOrSlug) }
                });
            } else {
                // Find by slug
                pool = await this.airdropListPoolRepository.findOne({
                    where: { alp_slug: idOrSlug }
                });
            }

            if (!pool) {
                throw new Error('Pool does not exist');
            }

            // Call getPoolDetail method with found poolId
            return await this.getPoolDetail(pool.alp_id, walletId, query);

        } catch (error) {
            this.logger.error(`Error getting pool detail by id or slug: ${error.message}`);
            throw error;
        }
    }

    async getPoolDetail(poolId: number, walletId: number, query: GetPoolDetailDto): Promise<PoolDetailDto> {
        try {
            // 1. Get pool information
            const pool = await this.airdropListPoolRepository.findOne({
                where: { alp_id: poolId }
            });

            if (!pool) {
                throw new Error('Pool does not exist');
            }

            // 2. Get pool creator wallet information
            const creatorWallet = await this.listWalletRepository.findOne({
                where: { wallet_id: pool.alp_originator }
            });

            // 3. Check if user is the creator of the pool
            const isCreator = pool.alp_originator === walletId;

            // 4. Get user stake information in this pool
            const userStakes = await this.airdropPoolJoinRepository.find({
                where: {
                    apj_pool_id: poolId,
                    apj_member: walletId,
                    apj_status: AirdropPoolJoinStatus.ACTIVE
                }
            });

            // 5. Calculate total volume user has staked and stake count
            let totalUserStaked = 0;
            let userStakeCount = 0;
            if (userStakes.length > 0) {
                totalUserStaked = userStakes.reduce((sum, stake) => sum + Number(stake.apj_volume), 0);
                userStakeCount = userStakes.length;
            }

            // 6. If user is creator, add initial volume
            if (isCreator) {
                totalUserStaked += Number(pool.apl_volume);
            }

            // 7. Create basic pool information
            const poolDetail: PoolDetailDto = {
                poolId: pool.alp_id,
                name: pool.alp_name,
                slug: pool.alp_slug,
                logo: pool.alp_logo || '',
                describe: pool.alp_describe || '',
                memberCount: pool.alp_member_num,
                totalVolume: Number(pool.apl_volume),
                creationDate: pool.apl_creation_date,
                endDate: pool.apl_end_date,
                status: pool.apl_status,
                transactionHash: pool.apl_hash,
                creatorAddress: creatorWallet?.wallet_solana_address || '',
                creatorBittworldUid: creatorWallet?.bittworld_uid || null
            };

            // 8. Add user stake information if exists
            if (userStakes.length > 0 || isCreator) {
                const firstStakeDate = userStakes.length > 0 
                    ? userStakes[0].apj_stake_date 
                    : pool.apl_creation_date;

                poolDetail.userStakeInfo = {
                    isCreator: isCreator,
                    joinStatus: userStakes.length > 0 ? 'active' : 'creator',
                    joinDate: firstStakeDate,
                    totalStaked: totalUserStaked,
                    stakeCount: userStakeCount
                };
            }

            // 9. If user is creator, get all members list
            if (isCreator) {
                const members = await this.getPoolMembers(poolId, query);
                poolDetail.members = members;
            }

            return poolDetail;

        } catch (error) {
            this.logger.error(`Error getting pool detail: ${error.message}`);
            throw error;
        }
    }

    private async getPoolMembers(poolId: number, query: GetPoolDetailDto): Promise<MemberInfoDto[]> {
        try {
            // 1. Get all stake records of the pool
            const allStakes = await this.airdropPoolJoinRepository.find({
                where: {
                    apj_pool_id: poolId,
                    apj_status: AirdropPoolJoinStatus.ACTIVE
                },
                relations: ['member']
            });

            // 2. Get creator information
            const pool = await this.airdropListPoolRepository.findOne({
                where: { alp_id: poolId },
                relations: ['originator']
            });

            if (!pool) {
                throw new Error('Pool does not exist');
            }

            // 3. Create map to group by member
            const memberMap = new Map<number, {
                memberId: number;
                solanaAddress: string;
                bittworldUid: string | null;
                nickname: string;
                isCreator: boolean;
                joinDate: Date;
                totalStaked: number;
                stakeCount: number;
                status: string;
            }>();

            // 4. Add creator to map
            if (pool.originator) {
                memberMap.set(pool.alp_originator, {
                    memberId: pool.alp_originator,
                    solanaAddress: pool.originator.wallet_solana_address,
                    bittworldUid: pool.originator.bittworld_uid || null,
                    nickname: pool.originator.wallet_nick_name || 'Unknown',
                    isCreator: true,
                    joinDate: pool.apl_creation_date,
                    totalStaked: Number(pool.apl_volume), // Initial volume
                    stakeCount: 0, // Will be updated later
                    status: 'active'
                });
            }

            // 5. Process stake records
            for (const stake of allStakes) {
                const memberId = stake.apj_member;
                const existingMember = memberMap.get(memberId);

                if (existingMember) {
                    // Update existing member information
                    existingMember.totalStaked += Number(stake.apj_volume);
                    existingMember.stakeCount += 1;
                    // Update join date if this stake is earlier
                    if (stake.apj_stake_date < existingMember.joinDate) {
                        existingMember.joinDate = stake.apj_stake_date;
                    }
                } else {
                    // Create new member
                    memberMap.set(memberId, {
                        memberId: memberId,
                        solanaAddress: stake.member?.wallet_solana_address || 'Unknown',
                        bittworldUid: stake.member?.bittworld_uid || null,
                        nickname: stake.member?.wallet_nick_name || 'Unknown',
                        isCreator: false,
                        joinDate: stake.apj_stake_date,
                        totalStaked: Number(stake.apj_volume),
                        stakeCount: 1,
                        status: stake.apj_status
                    });
                }
            }

            // 6. Convert map to array
            let members = Array.from(memberMap.values());

            // 7. Sort according to requirements
            const sortBy = query.sortBy || SortField.TOTAL_STAKED;
            const sortOrder = query.sortOrder || SortOrder.DESC;

            // Creator always at the top
            members.sort((a, b) => {
                // Creator always at the top
                if (a.isCreator && !b.isCreator) return -1;
                if (!a.isCreator && b.isCreator) return 1;

                // Sort by selected field
                let comparison = 0;
                switch (sortBy) {
                    case SortField.JOIN_DATE:
                        comparison = a.joinDate.getTime() - b.joinDate.getTime();
                        break;
                    case SortField.TOTAL_STAKED:
                        comparison = a.totalStaked - b.totalStaked;
                        break;
                    case SortField.STAKE_COUNT:
                        comparison = a.stakeCount - b.stakeCount;
                        break;
                    case SortField.MEMBER_ID:
                        comparison = a.memberId - b.memberId;
                        break;
                    default:
                        comparison = a.totalStaked - b.totalStaked;
                }

                return sortOrder === SortOrder.ASC ? comparison : -comparison;
            });

            return members;

        } catch (error) {
            this.logger.error(`Error getting members list: ${error.message}`);
            throw error;
        }
    }

    private async transferTokenToBittWallet(
        privateKey: string,
        tokenMint: string,
        destinationWallet: string,
        amount: number,
        transactionId?: string
    ): Promise<string> {
        try {
            this.logger.debug(`Starting token transfer with private key format check`);
            this.logger.debug(`Private key format (first 20 chars): ${privateKey.substring(0, 20)}...`);
            
            // Decode private key
            const keypair = this.getKeypairFromPrivateKey(privateKey);
            
            // Create unique transaction to avoid duplication
            const uniqueId = transactionId || `${Date.now()}_${Math.random()}`;
            
            // Get token accounts
            const sourceTokenAccount = await getATA(
                new PublicKey(tokenMint),
                keypair.publicKey
            );

            const destinationTokenAccount = await getATA(
                new PublicKey(tokenMint),
                new PublicKey(destinationWallet)
            );

            // Create transfer instruction using SPL Token
            const { createTransferInstruction } = require('@solana/spl-token');
            const transferInstruction = createTransferInstruction(
                sourceTokenAccount,
                destinationTokenAccount,
                keypair.publicKey,
                amount
            );

            // Create and send transaction
            const transaction = new Transaction().add(transferInstruction);
            
            const latestBlockhash = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = latestBlockhash.blockhash;
            transaction.feePayer = keypair.publicKey;

            // Sign and send transaction
            transaction.sign(keypair);
            const signature = await this.connection.sendTransaction(transaction, [keypair]);
            
            this.logger.log(`BITT transaction sent with signature: ${signature}, transactionId: ${uniqueId}`);
            return signature;

        } catch (error) {
            this.logger.error(`Error transferring token: ${error.message}`);
            throw error;
        }
    }

    private getKeypairFromPrivateKey(privateKey: string): any {
        try {
            // First, try to parse as JSON (database format)
            let solanaPrivateKey: string;
            
            try {
                const privateKeyObj = JSON.parse(privateKey);
                if (privateKeyObj.solana) {
                    solanaPrivateKey = privateKeyObj.solana;
                    this.logger.debug(`Successfully extracted Solana private key from JSON format`);
                } else {
                    throw new Error('No solana private key found in JSON');
                }
            } catch (jsonError) {
                // If not JSON, assume it's already a Solana private key
                solanaPrivateKey = privateKey;
                this.logger.debug(`Using private key as direct Solana key (not JSON format)`);
            }

            // Validate and decode the Solana private key
            const decodedKey = bs58.decode(solanaPrivateKey);
            if (decodedKey.length !== 64) {
                throw new Error(`Invalid Solana private key length: ${decodedKey.length} bytes`);
            }

            this.logger.debug(`Successfully decoded private key, length: ${decodedKey.length} bytes`);
            return require('@solana/web3.js').Keypair.fromSecretKey(decodedKey);
        } catch (error) {
            this.logger.error(`Error parsing private key: ${error.message}`);
            this.logger.error(`Private key format (first 20 chars): ${privateKey.substring(0, 20)}...`);
            throw new Error(`Invalid private key format: ${error.message}`);
        }
    }

    private async transferSolForFee(
        fromPrivateKey: string,
        toAddress: string,
        amount: number
    ): Promise<string> {
        try {
            // Decode private key
            const keypair = this.getKeypairFromPrivateKey(fromPrivateKey);
            
            // Create unique transaction to avoid duplication
            const uniqueId = Date.now() + Math.random();
            
            // Create transfer instruction
            const transferInstruction = SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: new PublicKey(toAddress),
                lamports: amount * LAMPORTS_PER_SOL
            });

            // Create and send transaction
            const transaction = new Transaction().add(transferInstruction);
            
            const latestBlockhash = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = latestBlockhash.blockhash;
            transaction.feePayer = keypair.publicKey;

            // Sign and send transaction
            transaction.sign(keypair);
            const signature = await this.connection.sendTransaction(transaction, [keypair]);
            
            this.logger.log(`SOL fee transaction sent with signature: ${signature}, uniqueId: ${uniqueId}`);
            return signature;

        } catch (error) {
            this.logger.error(`Error transferring SOL fee: ${error.message}`);
            throw error;
        }
    }

    private async waitForTransactionConfirmation(signature: string, maxRetries: number = 30): Promise<void> {
        let retries = 0;
        const retryDelay = 1000; // 1 giây

        while (retries < maxRetries) {
            try {
                const status = await this.solanaService.checkTransactionStatus(signature);
                
                if (status === 'confirmed' || status === 'finalized') {
                    this.logger.log(`Transaction ${signature} đã được confirm với status: ${status}`);
                    return;
                } else if (status === 'failed') {
                    throw new Error(`Transaction ${signature} đã thất bại`);
                }
                
                // Nếu vẫn pending, chờ và thử lại
                this.logger.log(`Transaction ${signature} vẫn pending, thử lại lần ${retries + 1}/${maxRetries}`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                retries++;
                
            } catch (error) {
                this.logger.error(`Lỗi kiểm tra transaction status: ${error.message}`);
                retries++;
                
                if (retries >= maxRetries) {
                    throw new Error(`Không thể confirm transaction ${signature} sau ${maxRetries} lần thử`);
                }
                
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
        
        throw new Error(`Transaction ${signature} không được confirm trong thời gian chờ`);
    }

    private generateSlug(name: string, id: number): string {
        const baseSlug = name
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim()
            .replace(/^-+|-+$/g, '');
        
        return `${baseSlug}-${id}`;
    }

    private getOrderByField(sortBy: PoolSortField): string {
        switch (sortBy) {
            case PoolSortField.CREATION_DATE:
                return 'apl_creation_date';
            case PoolSortField.NAME:
                return 'alp_name';
            case PoolSortField.MEMBER_COUNT:
                return 'alp_member_num';
            case PoolSortField.TOTAL_VOLUME:
                return 'apl_volume';
            case PoolSortField.END_DATE:
                return 'apl_end_date';
            default:
                return 'apl_creation_date';
        }
    }

    async getPoolDetailTransactionsByIdOrSlug(idOrSlug: string, walletId: number, query: GetPoolDetailTransactionsDto): Promise<PoolDetailTransactionsDto> {
        try {
            // Check if idOrSlug is numeric
            const isNumeric = !isNaN(Number(idOrSlug));
            
            let pool;
            if (isNumeric) {
                // Find by ID
                pool = await this.airdropListPoolRepository.findOne({
                    where: { alp_id: parseInt(idOrSlug) }
                });
            } else {
                // Find by slug
                pool = await this.airdropListPoolRepository.findOne({
                    where: { alp_slug: idOrSlug }
                });
            }

            if (!pool) {
                throw new Error('Pool does not exist');
            }

            // Call getPoolDetailTransactions method with found poolId
            return await this.getPoolDetailTransactions(pool.alp_id, walletId, query);

        } catch (error) {
            this.logger.error(`Error getting pool detail transactions by id or slug: ${error.message}`);
            throw error;
        }
    }

    async getPoolDetailTransactions(poolId: number, walletId: number, query: GetPoolDetailTransactionsDto): Promise<PoolDetailTransactionsDto> {
        try {
            // 1. Get pool information
            const pool = await this.airdropListPoolRepository.findOne({
                where: { alp_id: poolId }
            });

            if (!pool) {
                throw new Error('Pool does not exist');
            }

            // 2. Get pool creator wallet information
            const creatorWallet = await this.listWalletRepository.findOne({
                where: { wallet_id: pool.alp_originator }
            });

            // 3. Check if user is the creator of the pool
            const isCreator = pool.alp_originator === walletId;

            // 4. Get user stake information in this pool
            const userStakes = await this.airdropPoolJoinRepository.find({
                where: {
                    apj_pool_id: poolId,
                    apj_member: walletId,
                    apj_status: AirdropPoolJoinStatus.ACTIVE
                }
            });

            // 5. Calculate total volume user has staked and stake count
            let totalUserStaked = 0;
            let userStakeCount = 0;
            if (userStakes.length > 0) {
                totalUserStaked = userStakes.reduce((sum, stake) => sum + Number(stake.apj_volume), 0);
                userStakeCount = userStakes.length;
            }

            // 6. If user is creator, add initial volume
            if (isCreator) {
                totalUserStaked += Number(pool.apl_volume);
            }

            // 7. Create basic pool information
            const poolDetail: PoolDetailTransactionsDto = {
                poolId: pool.alp_id,
                name: pool.alp_name,
                slug: pool.alp_slug,
                logo: pool.alp_logo || '',
                describe: pool.alp_describe || '',
                memberCount: pool.alp_member_num,
                totalVolume: Number(pool.apl_volume),
                creationDate: pool.apl_creation_date,
                endDate: pool.apl_end_date,
                status: pool.apl_status,
                transactionHash: pool.apl_hash,
                creatorAddress: creatorWallet?.wallet_solana_address || '',
                creatorBittworldUid: creatorWallet?.bittworld_uid || null,
                transactions: []
            };

            // 8. Add user stake information if exists
            if (userStakes.length > 0 || isCreator) {
                const firstStakeDate = userStakes.length > 0 
                    ? userStakes[0].apj_stake_date 
                    : pool.apl_creation_date;

                poolDetail.userStakeInfo = {
                    isCreator: isCreator,
                    joinStatus: userStakes.length > 0 ? 'active' : 'creator',
                    joinDate: firstStakeDate,
                    totalStaked: totalUserStaked,
                    stakeCount: userStakeCount
                };
            }

            // 9. Get all transactions in the pool
            const transactions = await this.getPoolTransactions(poolId, query);
            poolDetail.transactions = transactions;

            return poolDetail;

        } catch (error) {
            this.logger.error(`Error getting pool detail transactions: ${error.message}`);
            throw error;
        }
    }

    private async getPoolTransactions(poolId: number, query: GetPoolDetailTransactionsDto): Promise<TransactionInfoDto[]> {
        try {
            // 1. Get all stake records of the pool with member information
            const allStakes = await this.airdropPoolJoinRepository.find({
                where: {
                    apj_pool_id: poolId,
                    apj_status: AirdropPoolJoinStatus.ACTIVE
                },
                relations: ['member']
            });

            // 2. Get creator information
            const pool = await this.airdropListPoolRepository.findOne({
                where: { alp_id: poolId },
                relations: ['originator']
            });

            if (!pool) {
                throw new Error('Pool does not exist');
            }

            // 3. Create transactions list
            const transactions: TransactionInfoDto[] = [];

            // 4. Add creator's initial transaction (if pool is active)
            if (pool.apl_status === AirdropPoolStatus.ACTIVE && pool.originator) {
                transactions.push({
                    transactionId: 0, // Special ID for creator's initial transaction
                    memberId: pool.alp_originator,
                    solanaAddress: pool.originator.wallet_solana_address,
                    bittworldUid: pool.originator.bittworld_uid || null,
                    nickname: pool.originator.wallet_nick_name || 'Creator',
                    isCreator: true,
                    stakeAmount: Number(pool.apl_volume),
                    transactionDate: pool.apl_creation_date,
                    status: pool.apl_status,
                    transactionHash: pool.apl_hash
                });
            }

            // 5. Add all member transactions
            for (const stake of allStakes) {
                if (stake.member) {
                    transactions.push({
                        transactionId: stake.apj_id,
                        memberId: stake.apj_member,
                        solanaAddress: stake.member.wallet_solana_address,
                        bittworldUid: stake.member.bittworld_uid || null,
                        nickname: stake.member.wallet_nick_name || 'Unknown',
                        isCreator: false,
                        stakeAmount: Number(stake.apj_volume),
                        transactionDate: stake.apj_stake_date,
                        status: stake.apj_status,
                        transactionHash: stake.apj_hash
                    });
                }
            }

            // 6. Sort transactions based on query parameters
            const sortBy = query.sortBy || TransactionSortField.TRANSACTION_DATE;
            const sortOrder = query.sortOrder || TransactionSortOrder.DESC;

            transactions.sort((a, b) => {
                let aValue: any;
                let bValue: any;

                switch (sortBy) {
                    case TransactionSortField.TRANSACTION_DATE:
                        aValue = new Date(a.transactionDate).getTime();
                        bValue = new Date(b.transactionDate).getTime();
                        break;
                    case TransactionSortField.STAKE_AMOUNT:
                        aValue = a.stakeAmount;
                        bValue = b.stakeAmount;
                        break;
                    case TransactionSortField.MEMBER_ID:
                        aValue = a.memberId;
                        bValue = b.memberId;
                        break;
                    case TransactionSortField.STATUS:
                        aValue = a.status;
                        bValue = b.status;
                        break;
                    default:
                        aValue = new Date(a.transactionDate).getTime();
                        bValue = new Date(b.transactionDate).getTime();
                }

                if (sortOrder === TransactionSortOrder.ASC) {
                    return aValue > bValue ? 1 : -1;
                } else {
                    return aValue < bValue ? 1 : -1;
                }
            });

            return transactions;

        } catch (error) {
            this.logger.error(`Error getting pool transactions: ${error.message}`);
            throw error;
        }
    }
} 