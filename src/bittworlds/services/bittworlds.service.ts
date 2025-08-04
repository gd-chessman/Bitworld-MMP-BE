import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { BittworldRewards } from '../entities/bittworld-rewards.entity';
import { BittworldWithdraw } from '../entities/bittworld-withdraws.entity';
import { ListWallet } from '../../telegram-wallets/entities/list-wallet.entity';
import { BgAffiliateTree } from '../../referral/entities/bg-affiliate-tree.entity';
import { ConfigService } from '@nestjs/config';
import { SolanaService } from '../../solana/solana.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Logger } from '@nestjs/common';
import { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

@Injectable()
export class BittworldsService {
    private readonly logger = new Logger(BittworldsService.name);

    constructor(
        @InjectRepository(BittworldRewards)
        private bittworldRewardsRepository: Repository<BittworldRewards>,
        @InjectRepository(BittworldWithdraw)
        private bittworldWithdrawRepository: Repository<BittworldWithdraw>,
        @InjectRepository(ListWallet)
        private listWalletRepository: Repository<ListWallet>,
        @InjectRepository(BgAffiliateTree)
        private bgAffiliateTreeRepository: Repository<BgAffiliateTree>,
        private configService: ConfigService,
        private solanaService: SolanaService,
        private dataSource: DataSource
    ) {}

    /**
     * Tính toán phí giao dịch cho đối tác Bittworld
     * @param traderWalletId ID của ví giao dịch
     * @param volume Khối lượng giao dịch (USD)
     * @param orderId ID của order (tùy chọn)
     * @returns Thông tin reward đã tạo
     */
    async rewardBittworld(
        traderWalletId: number,
        volume: number,
        orderId?: number
    ): Promise<{
        success: boolean;
        message: string;
        reward?: BittworldRewards;
        calculatedAmount?: number;
        treeCommissionPercent?: number;
    }> {
        try {
            // Bước 1: Kiểm tra ví giao dịch có phải từ Bittworld không
            const traderWallet = await this.listWalletRepository.findOne({
                where: { wallet_id: traderWalletId },
                select: ['wallet_id', 'isBittworld', 'wallet_solana_address', 'wallet_nick_name']
            });

            if (!traderWallet) {
                return {
                    success: false,
                    message: 'Trader wallet not found'
                };
            }

            // Nếu ví không phải từ Bittworld thì không tính reward
            if (!traderWallet.isBittworld) {
                return {
                    success: false,
                    message: 'Trader wallet is not from Bittworld'
                };
            }

            // Bước 2: Kiểm tra ví có thuộc luồng BG nào không
            const bgTree = await this.bgAffiliateTreeRepository.findOne({
                where: { bat_root_wallet_id: traderWalletId }
            });

            let calculatedAmount: number;
            let treeCommissionPercent: number | null = null;

            if (!bgTree) {
                // Trường hợp 1: Ví không thuộc luồng BG nào
                // PT = volume x 0.7%
                calculatedAmount = volume * 0.007;
            } else {
                // Trường hợp 2: Ví thuộc luồng BG
                // PT = (volume x 0.7%) - (volume x 0.7% x bat_total_commission_percent%)
                const baseCommission = volume * 0.007;
                treeCommissionPercent = bgTree.bat_total_commission_percent;
                const treeCommission = baseCommission * (treeCommissionPercent / 100);
                calculatedAmount = baseCommission - treeCommission;
            }

            // Chỉ tạo reward nếu số tiền > 0
            if (calculatedAmount <= 0) {
                return {
                    success: false,
                    message: 'Calculated reward amount is zero or negative',
                    calculatedAmount: 0,
                    treeCommissionPercent: treeCommissionPercent || 0
                };
            }

            // Bước 3: Tạo reward record
            const reward = this.bittworldRewardsRepository.create({
                br_amount_sol: undefined, // Sẽ được cập nhật sau khi có tỷ giá SOL
                br_amount_usd: calculatedAmount,
                br_status: 'can_withdraw' // Giao dịch thành công nên có thể rút tiền ngay
            });

            const savedReward = await this.bittworldRewardsRepository.save(reward);

            return {
                success: true,
                message: 'Bittworld reward calculated and saved successfully',
                reward: savedReward,
                calculatedAmount,
                treeCommissionPercent: treeCommissionPercent || 0
            };

        } catch (error) {
            return {
                success: false,
                message: `Error calculating Bittworld reward: ${error.message}`
            };
        }
    }

    /**
     * Hàm tự động trả hoa hồng cho đối tác Bittworlds
     * Chạy tự động mỗi 24h (UTC) một lần
     */
    @Cron(process.env.BITTWORLD_REWARD_CRON || '0 0 * * *', {
        name: 'autoRewardBittworld',
        timeZone: process.env.BITTWORLD_REWARD_TIMEZONE || 'UTC'
    })
    async autoRewardBittworld(): Promise<void> {
        this.logger.log('Starting auto reward Bittworld process...');
        this.logger.log(`Cron schedule: ${process.env.BITTWORLD_REWARD_CRON || '0 0 * * *'}`);
        this.logger.log(`Timezone: ${process.env.BITTWORLD_REWARD_TIMEZONE || 'UTC'}`);
        
        try {
            await this.dataSource.transaction(async manager => {
                // Bước 1: Tìm tất cả rewards có thể rút tiền
                const rewardsToWithdraw = await manager.find(BittworldRewards, {
                    where: { br_status: 'can_withdraw' }
                });

                if (rewardsToWithdraw.length === 0) {
                    this.logger.log('No rewards to withdraw');
                    return;
                }

                this.logger.log(`Found ${rewardsToWithdraw.length} rewards to withdraw`);

                // Bước 2: Tính tổng SOL cần rút
                const totalSolAmount = rewardsToWithdraw.reduce((sum, reward) => {
                    return sum + (reward.br_amount_sol || 0);
                }, 0);

                if (totalSolAmount <= 0) {
                    this.logger.log('Total SOL amount is zero or negative');
                    return;
                }

                // Bước 3: Lấy tỷ giá SOL hiện tại
                const solPriceInfo = await this.solanaService.getTokenPriceInRealTime('So11111111111111111111111111111111111111112');
                const totalUsdAmount = totalSolAmount * solPriceInfo.priceUSD;

                // Bước 4: Cập nhật tất cả rewards thành pending
                const rewardIds = rewardsToWithdraw.map(reward => reward.br_id);
                await manager.update(BittworldRewards, 
                    { br_id: rewardIds }, 
                    { br_status: 'pending' }
                );

                // Bước 5: Tạo withdraw record
                const withdraw = manager.create(BittworldWithdraw, {
                    bw_amount_sol: totalSolAmount,
                    bw_amount_usd: totalUsdAmount,
                    bw_address: this.configService.get<string>('WALLET__BITTWORLD_REWARD'),
                    bw_status: 'pending'
                });

                const savedWithdraw = await manager.save(BittworldWithdraw, withdraw);

                this.logger.log(`Created withdraw record: ${savedWithdraw.bw_id}, Amount: ${totalSolAmount} SOL ($${totalUsdAmount})`);

                // Bước 6: Thực hiện chuyển SOL
                const privateKey = this.configService.get<string>('WALLET_SUP_FREE_PRIVATE_KEY');
                const targetAddress = this.configService.get<string>('WALLET__BITTWORLD_REWARD');

                if (!privateKey || !targetAddress) {
                    throw new Error('Missing required environment variables: WALLET_SUP_FREE_PRIVATE_KEY or WALLET__BITTWORLD_REWARD');
                }

                try {
                    // Thực hiện chuyển SOL
                    const transferResult = await this.transferSol(
                        privateKey,
                        targetAddress,
                        totalSolAmount
                    );

                    if (transferResult?.signature) {
                        // Chuyển tiền thành công
                        await manager.update(BittworldWithdraw, 
                            { bw_id: savedWithdraw.bw_id }, 
                            { 
                                bw_status: 'success',
                                bw_tx_hash: transferResult.signature
                            }
                        );

                        // Cập nhật tất cả rewards thành withdrawn
                        await manager.update(BittworldRewards, 
                            { br_id: rewardIds }, 
                            { br_status: 'withdrawn' }
                        );

                        this.logger.log(`Transfer successful: ${transferResult.signature}`);
                        this.logger.log(`Updated ${rewardIds.length} rewards to withdrawn status`);
                    } else {
                        throw new Error('Transfer failed: No signature returned');
                    }

                } catch (transferError) {
                    this.logger.error(`Transfer failed: ${transferError.message}`);

                    // Chuyển tiền thất bại
                    await manager.update(BittworldWithdraw, 
                        { bw_id: savedWithdraw.bw_id }, 
                        { bw_status: 'error' }
                    );

                    // Cập nhật tất cả rewards về can_withdraw
                    await manager.update(BittworldRewards, 
                        { br_id: rewardIds }, 
                        { br_status: 'can_withdraw' }
                    );

                    this.logger.log(`Updated ${rewardIds.length} rewards back to can_withdraw status`);
                }
            });

        } catch (error) {
            this.logger.error(`Auto reward Bittworld process failed: ${error.message}`);
        }
    }

    /**
     * Hàm thủ công để chạy auto reward (có thể gọi từ API)
     */
    async manualAutoRewardBittworld(): Promise<{
        success: boolean;
        message: string;
        processedRewards?: number;
        totalAmount?: number;
    }> {
        try {
            this.logger.log('Starting manual auto reward Bittworld process...');
            
            // Tìm số lượng rewards có thể rút
            const rewardsCount = await this.bittworldRewardsRepository.count({
                where: { br_status: 'can_withdraw' }
            });

            if (rewardsCount === 0) {
                return {
                    success: true,
                    message: 'No rewards to withdraw',
                    processedRewards: 0,
                    totalAmount: 0
                };
            }

            // Chạy quy trình tự động
            await this.autoRewardBittworld();

            return {
                success: true,
                message: `Auto reward process completed. Processed ${rewardsCount} rewards.`,
                processedRewards: rewardsCount
            };

        } catch (error) {
            this.logger.error(`Manual auto reward failed: ${error.message}`);
            return {
                success: false,
                message: `Auto reward process failed: ${error.message}`
            };
        }
    }

    /**
     * Phương thức chuyển SOL
     */
    private async transferSol(
        privateKey: string,
        toAddress: string,
        amount: number
    ): Promise<{ signature: string } | null> {
        try {
            // Tạo keypair từ private key
            const decodedKey = bs58.decode(privateKey);
            const keypair = require('@solana/web3.js').Keypair.fromSecretKey(decodedKey);

            // Tạo transaction chuyển SOL
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey: new PublicKey(toAddress),
                    lamports: Math.floor(amount * LAMPORTS_PER_SOL)
                })
            );

            // Gửi transaction
            const signature = await this.solanaService.getConnection().sendTransaction(transaction, [keypair]);
            await this.solanaService.getConnection().confirmTransaction(signature);

            this.logger.log(`SOL transfer successful: ${signature}. Amount: ${amount} SOL`);
            return { signature };

        } catch (error) {
            this.logger.error(`SOL transfer failed: ${error.message}`);
            return null;
        }
    }
} 