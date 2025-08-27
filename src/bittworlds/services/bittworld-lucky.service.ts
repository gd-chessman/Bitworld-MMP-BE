import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Response } from 'express';
import { UserWallet } from '../../telegram-wallets/entities/user-wallet.entity';
import { ListWallet } from '../../telegram-wallets/entities/list-wallet.entity';
import { WalletAuth } from '../../telegram-wallets/entities/wallet-auth.entity';
import { BittworldRewardItem } from '../entities/bittworld-reward-item.entity';
import { BittworldRewardCode } from '../entities/bittworld-reward-code.entity';
import { BittworldRewardWinner } from '../entities/bittworld-reward-winner.entity';
import { BittworldSpinHistory, SpinResultStatus } from '../entities/bittworld-spin-history.entity';
import { BittworldRewardWinnerStatus } from '../entities/bittworld-reward-winner.entity';
import { BittworldSpinTicket } from '../entities/bittworld-spin-ticket.entity';
import { AuthService } from '../../auth/auth.service';
import { LoginDto } from '../dto/login.dto';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { SpinRewardDto, SpinRewardResponseDto } from '../dto/spin-reward.dto';
import { EnterCodeDto, EnterCodeResponseDto } from '../dto/enter-code.dto';
import { SpinTicketsResponseDto } from '../dto/spin-tickets.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class BittworldLuckyService {
    private readonly logger = new Logger(BittworldLuckyService.name);

    constructor(
        @InjectRepository(UserWallet)
        private readonly userWalletRepository: Repository<UserWallet>,
        @InjectRepository(ListWallet)
        private readonly listWalletRepository: Repository<ListWallet>,
        @InjectRepository(WalletAuth)
        private readonly walletAuthRepository: Repository<WalletAuth>,
        @InjectRepository(BittworldRewardItem)
        private readonly rewardItemRepository: Repository<BittworldRewardItem>,
        @InjectRepository(BittworldRewardCode)
        private readonly rewardCodeRepository: Repository<BittworldRewardCode>,
        @InjectRepository(BittworldRewardWinner)
        private readonly rewardWinnerRepository: Repository<BittworldRewardWinner>,
        @InjectRepository(BittworldSpinHistory)
        private readonly spinHistoryRepository: Repository<BittworldSpinHistory>,
        @InjectRepository(BittworldSpinTicket)
        private readonly spinTicketRepository: Repository<BittworldSpinTicket>,
        private readonly authService: AuthService,
    ) {}

    async login(dto: LoginDto, res: Response): Promise<AuthResponseDto> {
        try {
            this.logger.log(`Processing login for email: ${dto.email}`);

            // 1. Tìm user theo email (không phân biệt hoa thường)
            const user = await this.userWalletRepository.findOne({
                where: { uw_email: dto.email.toLowerCase() },
                relations: ['wallet_auths', 'wallet_auths.wa_wallet']
            });

            if (!user) {
                throw new NotFoundException('User not found');
            }

            // 2. Kiểm tra email đã được verify chưa
            if (!user.active_email) {
                throw new ForbiddenException('Email is not verified');
            }

            // 3. Kiểm tra password
            if (!user.uw_password) {
                throw new BadRequestException('Invalid login method');
            }

            const isPasswordValid = await bcrypt.compare(dto.password, user.uw_password);
            if (!isPasswordValid) {
                throw new UnauthorizedException('Invalid password');
            }

            // 4. Lấy main wallet
            const mainWalletAuth = user.wallet_auths.find(auth => auth.wa_type === 'main');
            if (!mainWalletAuth || !mainWalletAuth.wa_wallet) {
                throw new NotFoundException('Wallet not found');
            }

            const wallet = mainWalletAuth.wa_wallet;

            // 5. Tạo JWT token
            const payload = {
                uid: user.uw_id,
                wallet_id: wallet.wallet_id,
                sol_public_key: wallet.wallet_solana_address,
                eth_public_key: wallet.wallet_eth_address,
            };
            const tokenResponse = await this.authService.refreshToken(payload);

            // 6. Set HttpOnly cookie
            res.cookie('lk_access_token', tokenResponse.token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'none',
                maxAge: 24 * 60 * 60 * 1000 // 24 hours
            });

            this.logger.log(`Login successful for email: ${dto.email}`);

            return {
                status: 200,
                message: 'Login successful',
                data: {
                    user: {
                        id: user.uw_id,
                        email: user.uw_email,
                        name: mainWalletAuth.wa_name || ''
                    },
                    wallet: {
                        id: wallet.wallet_id,
                        solana_address: wallet.wallet_solana_address,
                        eth_address: wallet.wallet_eth_address,
                        nick_name: wallet.wallet_nick_name
                    }
                }
            };

        } catch (error) {
            this.logger.error(`Error in login: ${error.message}`, error.stack);
            throw error;
        }
    }

    async enterCode(dto: EnterCodeDto, walletId: number): Promise<EnterCodeResponseDto> {
        try {
            this.logger.log(`Processing enter code: ${dto.code} for wallet: ${walletId}`);

            // 1. Kiểm tra mã dự thưởng có tồn tại và còn hạn không
            const now = new Date();
            const rewardCode = await this.rewardCodeRepository.findOne({
                where: {
                    brc_code: dto.code,
                    brc_is_used: false,
                    brc_expired_at: MoreThan(now)
                }
            });

            if (!rewardCode) {
                throw new NotFoundException('Invalid or expired reward code');
            }

            // 2. Kiểm tra mã đã được sử dụng bởi wallet này chưa
            const existingTicket = await this.spinTicketRepository.findOne({
                where: {
                    bst_wallet_id: walletId,
                    bst_code_id: rewardCode.brc_id
                }
            });

            if (existingTicket) {
                throw new BadRequestException('This code has already been used by your wallet');
            }

            // 3. Tạo spin ticket
            const spinTicket = this.spinTicketRepository.create({
                bst_wallet_id: walletId,
                bst_code_id: rewardCode.brc_id,
                bst_expired_at: rewardCode.brc_expired_at || new Date(Date.now() + 24 * 60 * 60 * 1000)
            });
            await this.spinTicketRepository.save(spinTicket);

            // 4. Đánh dấu mã dự thưởng đã được sử dụng
            rewardCode.brc_is_used = true;
            rewardCode.brc_claimer_wallet_id = walletId;
            await this.rewardCodeRepository.save(rewardCode);

            this.logger.log(`Created spin ticket ${spinTicket.bst_id} for wallet ${walletId} and marked code ${dto.code} as used`);

            return {
                status: 200,
                message: 'Reward code entered successfully! You can now spin for rewards.',
                data: {
                    ticket_id: spinTicket.bst_id,
                    expires_at: spinTicket.bst_expired_at,
                    code_info: {
                        name: rewardCode.brc_code,
                        type: rewardCode.brc_type,
                        volume: rewardCode.brc_volume
                    }
                }
            };

        } catch (error) {
            this.logger.error(`Error in enterCode: ${error.message}`, error.stack);
            throw error;
        }
    }

    async spinReward(walletId: number): Promise<SpinRewardResponseDto> {
        try {
            this.logger.log(`Processing spin reward for wallet: ${walletId}`);

            // 1. Tìm spin ticket hợp lệ chưa sử dụng
            const now = new Date();
            const spinTicket = await this.spinTicketRepository.findOne({
                where: {
                    bst_wallet_id: walletId,
                    bst_is_used: false,
                    bst_expired_at: MoreThan(now)
                }
            });

            if (!spinTicket) {
                throw new NotFoundException('No available spin tickets found. Please enter a reward code first.');
            }

            // 2. Lấy danh sách phần thưởng đang active
            const activeRewards = await this.rewardItemRepository.find({
                where: { bri_active: true }
            });

            if (activeRewards.length === 0) {
                throw new BadRequestException('No active rewards available');
            }

            // 3. Kiểm tra phần thưởng nào đã được trúng trong ngày hôm nay
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const todayWinners = await this.rewardWinnerRepository.find({
                where: {
                    brw_won_at: MoreThan(todayStart)
                }
            });

            const wonItemIds = todayWinners.map(winner => winner.brw_code_id);
            const availableRewards = activeRewards.filter(reward => !wonItemIds.includes(reward.bri_id));

            // 4. Tính toán xác suất trúng thưởng
            const baseWinRate = 0.2; // 20%
            const availableCount = availableRewards.length;
            
            if (availableCount === 0) {
                // Tất cả phần thưởng đã được trúng
                const spinHistory = this.spinHistoryRepository.create({
                    bsh_wallet_id: walletId,
                    bsh_code_id: spinTicket.bst_code_id,
                    bsh_status: SpinResultStatus.FAILED,
                    bsh_reward_value_usd: 0
                });
                await this.spinHistoryRepository.save(spinHistory);

                // Đánh dấu ticket đã sử dụng
                spinTicket.bst_is_used = true;
                await this.spinTicketRepository.save(spinTicket);

                return {
                    status: 200,
                    message: 'All rewards have been claimed today. Better luck tomorrow!',
                    data: {
                        is_winner: false,
                        spin_history_id: spinHistory.bsh_id
                    }
                };
            }

            // Tính xác suất trúng 1 phần thưởng bất kỳ
            const winProbability = baseWinRate / availableCount;
            const random = Math.random();

            // 5. Thực hiện quay thưởng
            let wonItem: BittworldRewardItem | null = null;
            let isWinner = false;

            if (random <= winProbability) {
                // Trúng thưởng
                const randomIndex = Math.floor(Math.random() * availableRewards.length);
                wonItem = availableRewards[randomIndex];
                isWinner = true;

                // Tạo bản ghi winner
                const winner = this.rewardWinnerRepository.create({
                    brw_code_id: spinTicket.bst_code_id,
                    brw_wallet_id: walletId,
                    brw_reward_amount: wonItem.bri_value_usd,
                    brw_status: BittworldRewardWinnerStatus.CAN_WITHDRAW
                });
                await this.rewardWinnerRepository.save(winner);

                this.logger.log(`User ${walletId} won reward: ${wonItem.bri_name} ($${wonItem.bri_value_usd})`);
            }

            // 6. Tạo lịch sử quay thưởng
            const spinHistory = this.spinHistoryRepository.create({
                bsh_wallet_id: walletId,
                bsh_code_id: spinTicket.bst_code_id,
                bsh_item_id: wonItem?.bri_id || null,
                bsh_reward_value_usd: wonItem?.bri_value_usd || 0,
                bsh_status: isWinner ? SpinResultStatus.SUCCESS : SpinResultStatus.FAILED
            });
            await this.spinHistoryRepository.save(spinHistory);

            // 7. Đánh dấu ticket đã sử dụng
            spinTicket.bst_is_used = true;
            await this.spinTicketRepository.save(spinTicket);

            return {
                status: 200,
                message: isWinner ? 'Congratulations! You won a reward!' : 'Better luck next time!',
                data: {
                    won_item: wonItem ? {
                        id: wonItem.bri_id,
                        name: wonItem.bri_name,
                        image_url: wonItem.bri_image_url,
                        value_usd: wonItem.bri_value_usd
                    } : undefined,
                    is_winner: isWinner,
                    spin_history_id: spinHistory.bsh_id
                }
            };

        } catch (error) {
            this.logger.error(`Error in spinReward: ${error.message}`, error.stack);
            throw error;
        }
    }

    async getSpinTickets(walletId: number): Promise<SpinTicketsResponseDto> {
        try {
            this.logger.log(`Getting spin tickets for wallet: ${walletId}`);

            const now = new Date();
            
            // Lấy tất cả spin tickets của wallet
            const allTickets = await this.spinTicketRepository.find({
                where: { bst_wallet_id: walletId },
                order: { bst_created_at: 'DESC' }
            });

            // Phân loại tickets
            const availableTickets = allTickets.filter(ticket => 
                !ticket.bst_is_used && ticket.bst_expired_at > now
            );
            
            const usedTickets = allTickets.filter(ticket => 
                ticket.bst_is_used
            );

            // Tạo response data
            const ticketsData = allTickets.map(ticket => ({
                id: ticket.bst_id,
                is_used: ticket.bst_is_used,
                created_at: ticket.bst_created_at,
                expires_at: ticket.bst_expired_at,
                code_info: undefined // Không có relation với reward_code
            }));

            this.logger.log(`Found ${availableTickets.length} available tickets and ${usedTickets.length} used tickets for wallet ${walletId}`);

            return {
                status: 200,
                message: 'Spin tickets retrieved successfully',
                data: {
                    available_tickets: availableTickets.length,
                    used_tickets: usedTickets.length,
                    total_tickets: allTickets.length,
                    tickets: ticketsData
                }
            };

        } catch (error) {
            this.logger.error(`Error in getSpinTickets: ${error.message}`, error.stack);
            throw error;
        }
    }
}
