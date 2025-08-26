import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Response } from 'express';
import { UserWallet } from '../../telegram-wallets/entities/user-wallet.entity';
import { ListWallet } from '../../telegram-wallets/entities/list-wallet.entity';
import { WalletAuth } from '../../telegram-wallets/entities/wallet-auth.entity';
import { AuthService } from '../../auth/auth.service';
import { LoginDto } from '../dto/login.dto';
import { AuthResponseDto } from '../dto/auth-response.dto';
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
        private readonly authService: AuthService,
    ) {}

    async login(dto: LoginDto, res: Response): Promise<AuthResponseDto> {
        try {
            this.logger.log(`Processing login for email: ${dto.email}`);

            // 1. Tìm user theo email
            const user = await this.userWalletRepository.findOne({
                where: { uw_email: dto.email },
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
}
