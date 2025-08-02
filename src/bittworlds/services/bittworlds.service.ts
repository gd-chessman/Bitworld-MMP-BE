import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BittworldRewards } from '../entities/bittworld-rewards.entity';
import { BittworldWithdraw } from '../entities/bittworld-withdraws.entity';
import { ListWallet } from '../../telegram-wallets/entities/list-wallet.entity';
import { BgAffiliateTree } from '../../referral/entities/bg-affiliate-tree.entity';

@Injectable()
export class BittworldsService {
    constructor(
        @InjectRepository(BittworldRewards)
        private bittworldRewardsRepository: Repository<BittworldRewards>,
        @InjectRepository(BittworldWithdraw)
        private bittworldWithdrawRepository: Repository<BittworldWithdraw>,
        @InjectRepository(ListWallet)
        private listWalletRepository: Repository<ListWallet>,
        @InjectRepository(BgAffiliateTree)
        private bgAffiliateTreeRepository: Repository<BgAffiliateTree>
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
                br_status: 'pending'
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
} 