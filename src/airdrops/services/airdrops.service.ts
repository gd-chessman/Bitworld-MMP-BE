import { Injectable, Logger, BadRequestException, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AirdropListPool, AirdropPoolStatus } from '../entities/airdrop-list-pool.entity';
import { AirdropPoolJoin, AirdropPoolJoinStatus } from '../entities/airdrop-pool-join.entity';
import { ListWallet } from '../../telegram-wallets/entities/list-wallet.entity';
import { CreatePoolDto } from '../dto/create-pool.dto';
import { StakePoolDto } from '../dto/join-pool.dto';
import { PoolInfoDto } from '../dto/get-pools-response.dto';
import { PoolDetailDto, MemberInfoDto } from '../dto/get-pool-detail-response.dto';
import { GetPoolDetailDto, SortField, SortOrder } from '../dto/get-pool-detail.dto';
import { GetPoolsDto, PoolSortField, PoolSortOrder } from '../dto/get-pools.dto';
import { SolanaService } from '../../solana/solana.service';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getAssociatedTokenAddress as getATA } from '@project-serum/associated-token';
import bs58 from 'bs58';
import { RedisLockService } from '../../common/services/redis-lock.service';

@Injectable()
export class AirdropsService {
    private readonly logger = new Logger(AirdropsService.name);
    private readonly MAX_RETRY_ATTEMPTS = 3;
    private readonly LOCK_TTL = 300; // 5 phút

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
        private readonly redisLockService: RedisLockService
    ) {}

    async createPool(walletId: number, createPoolDto: CreatePoolDto) {
        // Tạo lock key để tránh trùng lặp API call
        const lockKey = `create_pool_${walletId}`;
        
        // Sử dụng withLock để tự động handle lock/release
        return await this.redisLockService.withLock(lockKey, async () => {
            // 1. Kiểm tra số lượng khởi tạo tối thiểu
            if (createPoolDto.initialAmount < 1000000) {
                throw new BadRequestException('Số lượng khởi tạo phải tối thiểu là 1,000,000');
            }

            // 2. Kiểm tra xem có pool đang pending nào của wallet này không
            const existingPendingPool = await this.airdropListPoolRepository.findOne({
                where: {
                    alp_originator: walletId,
                    apl_status: AirdropPoolStatus.PENDING
                }
            });

            if (existingPendingPool) {
                throw new BadRequestException('Bạn đã có một pool đang trong quá trình tạo. Vui lòng chờ hoàn tất.');
            }

            // 3. Lấy thông tin wallet
            const wallet = await this.listWalletRepository.findOne({
                where: { wallet_id: walletId }
            });

            if (!wallet) {
                throw new BadRequestException('Wallet không tồn tại');
            }

            // 4. Kiểm tra số dư token X
            const mintTokenAirdrop = this.configService.get<string>('MINT_TOKEN_AIRDROP');
            if (!mintTokenAirdrop) {
                throw new HttpException('Cấu hình MINT_TOKEN_AIRDROP không tồn tại', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            const tokenBalance = await this.solanaService.getTokenBalance(
                wallet.wallet_solana_address,
                mintTokenAirdrop
            );

            if (tokenBalance < createPoolDto.initialAmount) {
                throw new BadRequestException(`Số dư token X không đủ. Hiện tại: ${tokenBalance}, Yêu cầu: ${createPoolDto.initialAmount}`);
            }

            // 5. Kiểm tra số dư SOL và chuyển phí nếu cần
            let solBalance = await this.solanaService.getBalance(wallet.wallet_solana_address);
            const requiredSolFee = 0.00002; // 0.00002 SOL

            if (solBalance < requiredSolFee) {
                this.logger.log(`Số dư SOL không đủ (${solBalance} SOL), cần chuyển ${requiredSolFee} SOL cho wallet ${wallet.wallet_solana_address}`);
                
                const supportFeePrivateKey = this.configService.get<string>('WALLET_SUP_FREE_PRIVATE_KEY');
                if (!supportFeePrivateKey) {
                    throw new HttpException('Cấu hình WALLET_SUP_FREE_PRIVATE_KEY không tồn tại', HttpStatus.INTERNAL_SERVER_ERROR);
                }

                try {
                    const solTransferSignature = await this.transferSolForFee(supportFeePrivateKey, wallet.wallet_solana_address, requiredSolFee);
                    this.logger.log(`Đã chuyển ${requiredSolFee} SOL thành công cho wallet ${wallet.wallet_solana_address}, signature: ${solTransferSignature}`);
                    
                    // Chờ transaction được confirm thực sự
                    await this.waitForTransactionConfirmation(solTransferSignature);
                    this.logger.log(`Transaction SOL phí đã được confirm: ${solTransferSignature}`);
                    
                    // Kiểm tra lại số dư SOL sau khi chuyển
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Chờ 1s để balance update
                    solBalance = await this.solanaService.getBalance(wallet.wallet_solana_address);
                    
                    if (solBalance < requiredSolFee) {
                        throw new Error(`Số dư SOL vẫn không đủ sau khi chuyển phí. Hiện tại: ${solBalance} SOL`);
                    }
                    
                } catch (error) {
                    this.logger.error(`Lỗi chuyển SOL phí: ${error.message}`);
                    throw new BadRequestException('Không thể chuyển phí SOL. Vui lòng thử lại sau.');
                }
            }

            // 6. Tạo pool với trạng thái pending (tạm thời không có slug)
            const currentDate = new Date();
            const endDate = new Date(currentDate.getTime() + (365 * 24 * 60 * 60 * 1000)); // +365 ngày
            
            const newPool = this.airdropListPoolRepository.create({
                alp_originator: walletId,
                alp_name: createPoolDto.name,
                alp_slug: '', // Sẽ cập nhật sau khi có ID
                alp_describe: createPoolDto.describe || '',
                alp_member_num: 0,
                apl_volume: createPoolDto.initialAmount,
                apl_creation_date: currentDate,
                apl_end_date: endDate,
                apl_status: AirdropPoolStatus.PENDING
            });

            const savedPool = await this.airdropListPoolRepository.save(newPool);

            // 7. Tạo slug với ID và cập nhật
            const slug = this.generateSlug(createPoolDto.name, savedPool.alp_id);
            await this.airdropListPoolRepository.update(
                { alp_id: savedPool.alp_id },
                { alp_slug: slug }
            );

            // 8. Thực hiện giao dịch chuyển token
            const walletBittAddress = this.configService.get<string>('WALLET_BITT');
            if (!walletBittAddress) {
                throw new HttpException('Cấu hình WALLET_BITT không tồn tại', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            let transactionHash: string | null = null;
            let success = false;

            // Thử giao dịch tối đa 3 lần
            for (let attempt = 1; attempt <= this.MAX_RETRY_ATTEMPTS; attempt++) {
                try {
                    this.logger.log(`Thực hiện giao dịch chuyển token lần ${attempt} cho pool ${savedPool.alp_id}`);
                    
                    // Kiểm tra xem có transaction nào đã được gửi cho pool này chưa
                    const existingPool = await this.airdropListPoolRepository.findOne({
                        where: { alp_id: savedPool.alp_id }
                    });
                    
                    if (existingPool && existingPool.apl_hash) {
                        this.logger.log(`Pool ${savedPool.alp_id} đã có transaction hash: ${existingPool.apl_hash}`);
                        transactionHash = existingPool.apl_hash;
                        success = true;
                        break;
                    }
                    
                    // Tạo unique transaction ID để tránh trùng lặp
                    const transactionId = `pool_${savedPool.alp_id}_${Date.now()}_${Math.random()}`;
                    
                    transactionHash = await this.transferTokenToBittWallet(
                        wallet.wallet_private_key,
                        mintTokenAirdrop,
                        walletBittAddress,
                        createPoolDto.initialAmount,
                        transactionId
                    );

                    // Chờ transaction được confirm
                    await this.waitForTransactionConfirmation(transactionHash);
                    this.logger.log(`Giao dịch BITT đã được confirm: ${transactionHash}`);

                    success = true;
                    break;

                } catch (error) {
                    this.logger.error(`Lần thử ${attempt} thất bại: ${error.message}`);
                    
                    if (attempt === this.MAX_RETRY_ATTEMPTS) {
                        this.logger.error(`Đã thử tối đa ${this.MAX_RETRY_ATTEMPTS} lần nhưng vẫn thất bại`);
                        break;
                    }
                    
                    // Chờ 3 giây trước khi thử lại
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }

            // 9. Cập nhật trạng thái pool và transaction hash
            const finalStatus = success ? AirdropPoolStatus.ACTIVE : AirdropPoolStatus.ERROR;
            const updateData: any = { apl_status: finalStatus };
            
            if (success && transactionHash) {
                updateData.apl_hash = transactionHash;
            }
            
            await this.airdropListPoolRepository.update(
                { alp_id: savedPool.alp_id },
                updateData
            );

            // 10. Log kết quả cuối cùng
            if (success) {
                this.logger.log(`Pool ${savedPool.alp_id} đã được tạo thành công với transaction hash: ${transactionHash}`);
            } else {
                this.logger.error(`Pool ${savedPool.alp_id} tạo thất bại do giao dịch onchain không thành công`);
            }

            return {
                success: true,
                message: success ? 'Tạo pool thành công' : 'Tạo pool thất bại do giao dịch onchain',
                data: {
                    poolId: savedPool.alp_id,
                    name: savedPool.alp_name,
                    slug: slug,
                    status: finalStatus,
                    initialAmount: createPoolDto.initialAmount,
                    transactionHash: transactionHash
                }
            };
        }, this.LOCK_TTL * 1000); // Convert to milliseconds
    }

    async stakePool(walletId: number, stakePoolDto: StakePoolDto) {
        // Tạo lock key để tránh trùng lặp API call
        const lockKey = `stake_pool_${walletId}_${stakePoolDto.poolId}`;
        
        // Sử dụng withLock để tự động handle lock/release
        return await this.redisLockService.withLock(lockKey, async () => {
            // 1. Kiểm tra pool có tồn tại và đang active không
            const pool = await this.airdropListPoolRepository.findOne({
                where: { alp_id: stakePoolDto.poolId }
            });

            if (!pool) {
                throw new BadRequestException('Pool không tồn tại');
            }

            if (pool.apl_status !== AirdropPoolStatus.ACTIVE) {
                throw new BadRequestException('Pool không trong trạng thái active');
            }

            // 2. Kiểm tra xem user đã có stake record trong pool này chưa
            const existingJoin = await this.airdropPoolJoinRepository.findOne({
                where: {
                    apj_pool_id: stakePoolDto.poolId,
                    apj_member: walletId
                }
            });

            // 3. Lấy thông tin wallet
            const wallet = await this.listWalletRepository.findOne({
                where: { wallet_id: walletId }
            });

            if (!wallet) {
                throw new BadRequestException('Wallet không tồn tại');
            }

            // 4. Kiểm tra số dư token X
            const mintTokenAirdrop = this.configService.get<string>('MINT_TOKEN_AIRDROP');
            if (!mintTokenAirdrop) {
                throw new HttpException('Cấu hình MINT_TOKEN_AIRDROP không tồn tại', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            const tokenBalance = await this.solanaService.getTokenBalance(
                wallet.wallet_solana_address,
                mintTokenAirdrop
            );

            if (tokenBalance < stakePoolDto.stakeAmount) {
                throw new BadRequestException(`Số dư token X không đủ. Hiện tại: ${tokenBalance}, Yêu cầu: ${stakePoolDto.stakeAmount}`);
            }

            // 5. Kiểm tra số dư SOL và chuyển phí nếu cần
            let solBalance = await this.solanaService.getBalance(wallet.wallet_solana_address);
            const requiredSolFee = 0.00002; // 0.00002 SOL

            if (solBalance < requiredSolFee) {
                this.logger.log(`Số dư SOL không đủ (${solBalance} SOL), cần chuyển ${requiredSolFee} SOL cho wallet ${wallet.wallet_solana_address}`);
                
                const supportFeePrivateKey = this.configService.get<string>('WALLET_SUP_FREE_PRIVATE_KEY');
                if (!supportFeePrivateKey) {
                    throw new HttpException('Cấu hình WALLET_SUP_FREE_PRIVATE_KEY không tồn tại', HttpStatus.INTERNAL_SERVER_ERROR);
                }

                let solTransferSuccess = false;
                let solTransferSignature: string | null = null;

                // Thử chuyển SOL phí tối đa 3 lần
                for (let solAttempt = 1; solAttempt <= this.MAX_RETRY_ATTEMPTS; solAttempt++) {
                    try {
                        this.logger.log(`Thực hiện chuyển SOL phí lần ${solAttempt} cho wallet ${wallet.wallet_solana_address}`);
                        
                        solTransferSignature = await this.transferSolForFee(supportFeePrivateKey, wallet.wallet_solana_address, requiredSolFee);
                        this.logger.log(`Đã chuyển ${requiredSolFee} SOL thành công cho wallet ${wallet.wallet_solana_address}, signature: ${solTransferSignature}`);
                        
                        // Chờ transaction được confirm thực sự
                        await this.waitForTransactionConfirmation(solTransferSignature);
                        this.logger.log(`Transaction SOL phí đã được confirm: ${solTransferSignature}`);
                        
                        // Kiểm tra lại số dư SOL sau khi chuyển
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Chờ 1s để balance update
                        solBalance = await this.solanaService.getBalance(wallet.wallet_solana_address);
                        
                        if (solBalance < requiredSolFee) {
                            throw new Error(`Số dư SOL vẫn không đủ sau khi chuyển phí. Hiện tại: ${solBalance} SOL`);
                        }
                        
                        solTransferSuccess = true;
                        break;
                        
                    } catch (error) {
                        this.logger.error(`Lần thử chuyển SOL phí ${solAttempt} thất bại: ${error.message}`);
                        
                        if (solAttempt === this.MAX_RETRY_ATTEMPTS) {
                            this.logger.error(`Đã thử tối đa ${this.MAX_RETRY_ATTEMPTS} lần chuyển SOL phí nhưng vẫn thất bại`);
                            break;
                        }
                        
                        // Chờ 2 giây trước khi thử lại
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }

                if (!solTransferSuccess) {
                    throw new BadRequestException('Không thể chuyển phí SOL sau nhiều lần thử. Vui lòng thử lại sau.');
                }
            }

            // 6. Tạo join record với trạng thái pending
            const currentDate = new Date();
            const stakeEndDate = new Date(currentDate.getTime() + (365 * 24 * 60 * 60 * 1000)); // +365 ngày
            
            const newJoin = this.airdropPoolJoinRepository.create({
                apj_pool_id: stakePoolDto.poolId,
                apj_member: walletId,
                apj_volume: stakePoolDto.stakeAmount,
                apj_stake_date: currentDate,
                apj_stake_end: stakeEndDate,
                apj_status: AirdropPoolJoinStatus.PENDING
            });

            const savedJoin = await this.airdropPoolJoinRepository.save(newJoin);

            // 7. Thực hiện giao dịch chuyển token
            const walletBittAddress = this.configService.get<string>('WALLET_BITT');
            if (!walletBittAddress) {
                throw new HttpException('Cấu hình WALLET_BITT không tồn tại', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            let transactionHash: string | null = null;
            let success = false;

            // Thử giao dịch tối đa 3 lần
            for (let attempt = 1; attempt <= this.MAX_RETRY_ATTEMPTS; attempt++) {
                try {
                    this.logger.log(`Thực hiện giao dịch stake token lần ${attempt} cho join ${savedJoin.apj_id}`);
                    
                    // Kiểm tra xem có transaction nào đã được gửi cho join này chưa
                    const existingJoinRecord = await this.airdropPoolJoinRepository.findOne({
                        where: { apj_id: savedJoin.apj_id }
                    });
                    
                    if (existingJoinRecord && existingJoinRecord.apj_status === AirdropPoolJoinStatus.ACTIVE) {
                        this.logger.log(`Join ${savedJoin.apj_id} đã được xử lý thành công`);
                        transactionHash = 'already_processed';
                        success = true;
                        break;
                    }
                    
                    // Tạo unique transaction ID để tránh trùng lặp
                    const transactionId = `stake_${savedJoin.apj_id}_${Date.now()}_${Math.random()}`;
                    
                    transactionHash = await this.transferTokenToBittWallet(
                        wallet.wallet_private_key,
                        mintTokenAirdrop,
                        walletBittAddress,
                        stakePoolDto.stakeAmount,
                        transactionId
                    );

                    // Chờ transaction được confirm
                    await this.waitForTransactionConfirmation(transactionHash);
                    this.logger.log(`Giao dịch stake BITT đã được confirm: ${transactionHash}`);

                    success = true;
                    break;

                } catch (error) {
                    this.logger.error(`Lần thử ${attempt} thất bại: ${error.message}`);
                    
                    if (attempt === this.MAX_RETRY_ATTEMPTS) {
                        this.logger.error(`Đã thử tối đa ${this.MAX_RETRY_ATTEMPTS} lần nhưng vẫn thất bại`);
                        break;
                    }
                    
                    // Chờ 3 giây trước khi thử lại
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }

            // 8. Cập nhật trạng thái join và transaction hash
            const finalStatus = success ? AirdropPoolJoinStatus.ACTIVE : AirdropPoolJoinStatus.ERROR;
            const updateData: any = { apj_status: finalStatus };
            
            if (success && transactionHash && transactionHash !== 'already_processed') {
                updateData.apj_hash = transactionHash;
            }
            
            await this.airdropPoolJoinRepository.update(
                { apj_id: savedJoin.apj_id },
                updateData
            );

            // 9. Cập nhật số lượng member và volume của pool
            if (success) {
                // Nếu user chưa có stake record, tăng số member
                const memberIncrement = existingJoin ? 0 : 1;
                
                await this.airdropListPoolRepository.update(
                    { alp_id: stakePoolDto.poolId },
                    {
                        alp_member_num: pool.alp_member_num + memberIncrement,
                        apl_volume: pool.apl_volume + stakePoolDto.stakeAmount
                    }
                );
            }

            // 10. Log kết quả cuối cùng
            if (success) {
                this.logger.log(`Join ${savedJoin.apj_id} đã được tạo thành công với transaction hash: ${transactionHash}`);
            } else {
                this.logger.error(`Join ${savedJoin.apj_id} tạo thất bại do giao dịch onchain không thành công`);
            }

            return {
                success: true,
                message: success ? 'Stake pool thành công' : 'Stake pool thất bại do giao dịch onchain',
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
            // 1. Xác định trường sắp xếp
            const sortBy = query.sortBy || PoolSortField.CREATION_DATE;
            const sortOrder = query.sortOrder || PoolSortOrder.DESC;

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

            // 3. Lấy tất cả pools đang hoạt động
            const pools = await this.airdropListPoolRepository.find({
                where: {
                    apl_status: AirdropPoolStatus.ACTIVE
                },
                order: orderObject
            });

            const poolsWithUserInfo: PoolInfoDto[] = [];

            for (const pool of pools) {
                // 2. Kiểm tra xem user có phải là creator của pool không
                const isCreator = pool.alp_originator === walletId;

                // 3. Lấy thông tin stake của user trong pool này
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
                    logo: '', // Cần thêm field logo vào entity nếu cần
                    describe: pool.alp_describe || '',
                    memberCount: pool.alp_member_num,
                    totalVolume: Number(pool.apl_volume),
                    creationDate: pool.apl_creation_date,
                    endDate: pool.apl_end_date,
                    status: pool.apl_status
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
            this.logger.error(`Lỗi lấy danh sách pool: ${error.message}`);
            throw error;
        }
    }

    async getPoolDetailByIdOrSlug(idOrSlug: string, walletId: number, query: GetPoolDetailDto): Promise<PoolDetailDto> {
        try {
            // Kiểm tra xem idOrSlug có phải là số không
            const isNumeric = !isNaN(Number(idOrSlug));
            
            let pool;
            if (isNumeric) {
                // Tìm theo ID
                pool = await this.airdropListPoolRepository.findOne({
                    where: { alp_id: parseInt(idOrSlug) }
                });
            } else {
                // Tìm theo slug
                pool = await this.airdropListPoolRepository.findOne({
                    where: { alp_slug: idOrSlug }
                });
            }

            if (!pool) {
                throw new Error('Pool không tồn tại');
            }

            // Gọi method getPoolDetail với poolId đã tìm được
            return await this.getPoolDetail(pool.alp_id, walletId, query);

        } catch (error) {
            this.logger.error(`Lỗi lấy thông tin pool detail by id or slug: ${error.message}`);
            throw error;
        }
    }

    async getPoolDetail(poolId: number, walletId: number, query: GetPoolDetailDto): Promise<PoolDetailDto> {
        try {
            // 1. Lấy thông tin pool
            const pool = await this.airdropListPoolRepository.findOne({
                where: { alp_id: poolId }
            });

            if (!pool) {
                throw new Error('Pool không tồn tại');
            }

            // 2. Kiểm tra xem user có phải là creator của pool không
            const isCreator = pool.alp_originator === walletId;

            // 3. Lấy thông tin stake của user trong pool này
            const userStakes = await this.airdropPoolJoinRepository.find({
                where: {
                    apj_pool_id: poolId,
                    apj_member: walletId,
                    apj_status: AirdropPoolJoinStatus.ACTIVE
                }
            });

            // 4. Tính tổng volume user đã stake và số lần stake
            let totalUserStaked = 0;
            let userStakeCount = 0;
            if (userStakes.length > 0) {
                totalUserStaked = userStakes.reduce((sum, stake) => sum + Number(stake.apj_volume), 0);
                userStakeCount = userStakes.length;
            }

            // 5. Nếu user là creator, cộng thêm volume ban đầu
            if (isCreator) {
                totalUserStaked += Number(pool.apl_volume);
            }

            // 6. Tạo thông tin pool cơ bản
            const poolDetail: PoolDetailDto = {
                poolId: pool.alp_id,
                name: pool.alp_name,
                slug: pool.alp_slug,
                logo: '', // Cần thêm field logo vào entity nếu cần
                describe: pool.alp_describe || '',
                memberCount: pool.alp_member_num,
                totalVolume: Number(pool.apl_volume),
                creationDate: pool.apl_creation_date,
                endDate: pool.apl_end_date,
                status: pool.apl_status,
                transactionHash: pool.apl_hash
            };

            // 7. Thêm thông tin stake của user nếu có
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

            // 8. Nếu user là creator, lấy danh sách tất cả members
            if (isCreator) {
                const members = await this.getPoolMembers(poolId, query);
                poolDetail.members = members;
            }

            return poolDetail;

        } catch (error) {
            this.logger.error(`Lỗi lấy thông tin pool detail: ${error.message}`);
            throw error;
        }
    }

    private async getPoolMembers(poolId: number, query: GetPoolDetailDto): Promise<MemberInfoDto[]> {
        try {
            // 1. Lấy tất cả stake records của pool
            const allStakes = await this.airdropPoolJoinRepository.find({
                where: {
                    apj_pool_id: poolId,
                    apj_status: AirdropPoolJoinStatus.ACTIVE
                },
                relations: ['member']
            });

            // 2. Lấy thông tin creator
            const pool = await this.airdropListPoolRepository.findOne({
                where: { alp_id: poolId },
                relations: ['originator']
            });

            if (!pool) {
                throw new Error('Pool không tồn tại');
            }

            // 3. Tạo map để group theo member
            const memberMap = new Map<number, {
                memberId: number;
                solanaAddress: string;
                nickname: string;
                isCreator: boolean;
                joinDate: Date;
                totalStaked: number;
                stakeCount: number;
                status: string;
            }>();

            // 4. Thêm creator vào map
            if (pool.originator) {
                memberMap.set(pool.alp_originator, {
                    memberId: pool.alp_originator,
                    solanaAddress: pool.originator.wallet_solana_address,
                    nickname: pool.originator.wallet_nick_name || 'Unknown',
                    isCreator: true,
                    joinDate: pool.apl_creation_date,
                    totalStaked: Number(pool.apl_volume), // Volume ban đầu
                    stakeCount: 0, // Sẽ được cập nhật sau
                    status: 'active'
                });
            }

            // 5. Xử lý các stake records
            for (const stake of allStakes) {
                const memberId = stake.apj_member;
                const existingMember = memberMap.get(memberId);

                if (existingMember) {
                    // Cập nhật thông tin member hiện có
                    existingMember.totalStaked += Number(stake.apj_volume);
                    existingMember.stakeCount += 1;
                    // Cập nhật join date nếu stake này sớm hơn
                    if (stake.apj_stake_date < existingMember.joinDate) {
                        existingMember.joinDate = stake.apj_stake_date;
                    }
                } else {
                    // Tạo member mới
                    memberMap.set(memberId, {
                        memberId: memberId,
                        solanaAddress: stake.member?.wallet_solana_address || 'Unknown',
                        nickname: stake.member?.wallet_nick_name || 'Unknown',
                        isCreator: false,
                        joinDate: stake.apj_stake_date,
                        totalStaked: Number(stake.apj_volume),
                        stakeCount: 1,
                        status: stake.apj_status
                    });
                }
            }

            // 6. Chuyển map thành array
            let members = Array.from(memberMap.values());

            // 7. Sắp xếp theo yêu cầu
            const sortBy = query.sortBy || SortField.TOTAL_STAKED;
            const sortOrder = query.sortOrder || SortOrder.DESC;

            // Creator luôn ở đầu
            members.sort((a, b) => {
                // Creator luôn ở đầu
                if (a.isCreator && !b.isCreator) return -1;
                if (!a.isCreator && b.isCreator) return 1;

                // Sắp xếp theo trường được chọn
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
            this.logger.error(`Lỗi lấy danh sách members: ${error.message}`);
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
            // Decode private key
            const keypair = this.getKeypairFromPrivateKey(privateKey);
            
            // Tạo unique transaction để tránh trùng lặp
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
            
            this.logger.log(`Đã gửi transaction BITT với signature: ${signature}, transactionId: ${uniqueId}`);
            return signature;

        } catch (error) {
            this.logger.error(`Lỗi chuyển token: ${error.message}`);
            throw error;
        }
    }

    private getKeypairFromPrivateKey(privateKey: string): any {
        const decodedKey = bs58.decode(privateKey);
        return require('@solana/web3.js').Keypair.fromSecretKey(decodedKey);
    }

    private async transferSolForFee(
        fromPrivateKey: string,
        toAddress: string,
        amount: number
    ): Promise<string> {
        try {
            // Decode private key
            const keypair = this.getKeypairFromPrivateKey(fromPrivateKey);
            
            // Tạo unique transaction để tránh trùng lặp
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
            
            this.logger.log(`Đã gửi transaction SOL phí với signature: ${signature}, uniqueId: ${uniqueId}`);
            return signature;

        } catch (error) {
            this.logger.error(`Lỗi chuyển SOL phí: ${error.message}`);
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
} 