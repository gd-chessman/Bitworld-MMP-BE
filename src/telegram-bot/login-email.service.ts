import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserWallet } from '../telegram-wallets/entities/user-wallet.entity';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';
import { WalletAuth } from '../telegram-wallets/entities/wallet-auth.entity';
import { WalletReferent } from '../referral/entities/wallet-referent.entity';
import { TelegramBotService } from './telegram-bot.service';
import { AuthService } from '../auth/auth.service';
import { GoogleAuthService } from './google-auth.service';
import { BgRefService } from '../referral/bg-ref.service';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { ethers } from 'ethers';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as bcrypt from 'bcrypt';

export interface GoogleLoginDto {
    code: string;  // Authorization code from Google
    refCode?: string; // Referral code (optional)
}

export interface ManualRegisterDto {
    name: string;
    nick_name: string;
    country: string;
    bittworld_uid?: string;
    refCode?: string;
    password: string;
    email: string;
}

export interface ManualLoginDto {
    email: string;
    password: string;
}

export interface LoginResponse {
    status: number;
    message: string;
    data: {
        token: string;
        user: {
            id: number;
            email: string;
            wallet: {
                id: number;
                solana: string;
                ethereum: string;
                nickname: string | null;
            };
        };
    };
}

export interface ManualRegisterResponseDto {
    status: number;
    message: string;
    data?: {
        user: {
            id: number;
            email: string;
            name: string;
            country: string;
            bittworld_uid?: string;
        };
        wallet: {
            id: number;
            solana_address: string;
            eth_address: string;
            nick_name: string;
            country: string;
        };
    };
}

export interface ManualLoginResponseDto {
    status: number;
    message: string;
    data?: {
        token: string;
        user: {
            id: number;
            email: string;
            name: string;
            country: string;
            bittworld_uid?: string;
        };
        wallet: {
            id: number;
            solana_address: string;
            eth_address: string;
            nick_name: string;
            country: string;
        };
    };
}

@Injectable()
export class LoginEmailService {
    private readonly logger = new Logger(LoginEmailService.name);

    constructor(
        @InjectRepository(UserWallet)
        private readonly userWalletRepository: Repository<UserWallet>,
        @InjectRepository(ListWallet)
        private readonly listWalletRepository: Repository<ListWallet>,
        @InjectRepository(WalletAuth)
        private readonly walletAuthRepository: Repository<WalletAuth>,
        @InjectRepository(WalletReferent)
        private readonly walletReferentRepository: Repository<WalletReferent>,
        private readonly telegramBotService: TelegramBotService,
        private readonly authService: AuthService,
        private readonly googleAuthService: GoogleAuthService,
        private readonly bgRefService: BgRefService,
        private readonly configService: ConfigService,
    ) {}

    async handleGoogleLogin(loginData: GoogleLoginDto, req: Request): Promise<LoginResponse> {
        try {
            this.logger.debug('Starting Google login process with code:', {
                codeLength: loginData.code.length,
                codePrefix: loginData.code.substring(0, 10) + '...'
            });

            // 1. Exchange code for tokens
            const tokens = await this.googleAuthService.exchangeCodeForToken(loginData.code, 'login-email');
            this.logger.debug('Successfully exchanged code for tokens:', {
                hasAccessToken: !!tokens.access_token,
                hasIdToken: !!tokens.id_token,
                tokenType: tokens.token_type,
                expiresIn: tokens.expires_in
            });

            // 2. Verify ID token and get user info
            const userInfo = await this.googleAuthService.verifyIdToken(tokens.id_token);
            this.logger.debug('Successfully verified ID token and got user info:', {
                email: userInfo.email,
                emailVerified: userInfo.email_verified,
                name: userInfo.name,
                googleId: userInfo.sub
            });

            this.logger.log(`Processing Google login for email: ${userInfo.email}`);

            // Lấy domain từ frontend request
            const origin = req.headers.origin || req.headers.referer;
            let frontendDomain = '';
            if (origin) {
                try {
                    frontendDomain = new URL(origin).hostname.toLowerCase();
                } catch {
                    frontendDomain = origin.replace(/^https?:\/\//, '').replace(/^www\./, '');
                }
            }

            // Lấy domain từ biến môi trường (có thể là URL đầy đủ)
            const envDomain = this.configService.get<string>('BITTWORLD_DOMAIN', '').toLowerCase();
            let bittworldDomain = '';
            try {
                bittworldDomain = new URL(envDomain).hostname.toLowerCase();
            } catch {
                bittworldDomain = envDomain.replace(/^https?:\/\//, '').replace(/^www\./, '');
            }

            // So sánh hostname, loại bỏ www. nếu muốn nhận diện linh hoạt
            const normalize = (domain: string) => domain.replace(/^www\./, '');
            const isBittworld = !!bittworldDomain && normalize(frontendDomain) === normalize(bittworldDomain);
            
            // 3. Find or create user
            let userWallet = await this.findUserByEmail(userInfo.email);
            let listWallet: ListWallet;
            let isNewUser = false;

            if (!userWallet) {
                // Create new user and wallet with active_email = true
                const newUser = this.userWalletRepository.create({
                    uw_email: userInfo.email,
                    active_email: true,  // Set active_email = true for new user
                    isBittworld: isBittworld
                });
                await this.userWalletRepository.save(newUser);

                // Create new wallet
                const solanaKeypair = Keypair.generate();
                const solanaPublicKey = solanaKeypair.publicKey.toBase58();
                const solanaPrivateKey = bs58.encode(solanaKeypair.secretKey);

                // Create Ethereum private key from Solana private key
                const ethPrivateKey = this.telegramBotService['deriveEthereumPrivateKey'](solanaKeypair.secretKey);
                const ethWallet = new ethers.Wallet(ethPrivateKey);
                const ethAddress = ethWallet.address;

                // Generate referral code
                const referralCode = await this.telegramBotService['generateUniqueReferralCode']();

                // Create new wallet
                const newWallet = this.listWalletRepository.create({
                    wallet_private_key: JSON.stringify({
                        solana: solanaPrivateKey,
                        ethereum: ethPrivateKey
                    }),
                    wallet_solana_address: solanaPublicKey,
                    wallet_eth_address: ethAddress,
                    wallet_status: true,
                    wallet_auth: 'member',
                    wallet_code_ref: referralCode,
                    isBittworld: isBittworld
                });
                await this.listWalletRepository.save(newWallet);

                // Create wallet_auth link
                const walletAuth = this.walletAuthRepository.create({
                    wa_user_id: newUser.uw_id,
                    wa_wallet_id: newWallet.wallet_id,
                    wa_type: 'main'
                });
                await this.walletAuthRepository.save(walletAuth);

                userWallet = newUser;
                listWallet = newWallet;
                isNewUser = true;

                // Tạo quan hệ giới thiệu nếu có mã giới thiệu (chỉ cho user mới)
                if (loginData.refCode) {
                    this.logger.log(`Processing referral code ${loginData.refCode} for new user ${userInfo.email}`);
                    
                    // Tìm ví referrer dựa trên mã giới thiệu
                    const referrerWallet = await this.listWalletRepository.findOne({
                        where: { wallet_code_ref: loginData.refCode }
                    });
                    
                    if (referrerWallet) {
                        const referralSuccess = await this.createReferralRelationship(newWallet.wallet_id, referrerWallet.wallet_id);
                        if (referralSuccess) {
                            this.logger.log(`Successfully created referral relationship for user ${userInfo.email} with refCode ${loginData.refCode}`);
                        } else {
                            this.logger.warn(`Failed to create referral relationship for user ${userInfo.email} with refCode ${loginData.refCode}`);
                        }
                    } else {
                        this.logger.warn(`Referral code ${loginData.refCode} not found for user ${userInfo.email}`);
                    }
                }
            } else {
                // Kiểm tra active_email cho user đã tồn tại
                if (!userWallet.active_email) {
                    throw new BadRequestException('Email is not verified. Please verify your email first.');
                }

                // Update google_auth and get main wallet
                await this.updateGoogleAuth(userWallet, userInfo.sub);
                listWallet = await this.getMainWallet(userWallet);
            }

            // 4. Generate and return JWT token
            return await this.generateLoginResponse(userWallet, listWallet, isNewUser);

        } catch (error) {
            this.logger.error(`Error in handleGoogleLogin: ${error.message}`, error.stack);
            throw new BadRequestException(error.message || 'Login failed');
        }
    }

    private async findUserByEmail(email: string): Promise<UserWallet | null> {
        return await this.userWalletRepository.findOne({
            where: { uw_email: email },
            relations: ['wallet_auths', 'wallet_auths.wa_wallet']
        });
    }

    private async createNewUserAndWallet(userInfo: any): Promise<{ newUser: UserWallet; newWallet: ListWallet }> {
        this.logger.log(`Creating new user for email: ${userInfo.email}`);

        // Create new user with only email, telegram_id remains null
        const newUser = this.userWalletRepository.create({
            uw_email: userInfo.email
        });
        await this.userWalletRepository.save(newUser);

        // Create new wallet directly instead of using getOrCreateWallet
        const solanaKeypair = Keypair.generate();
        const solanaPublicKey = solanaKeypair.publicKey.toBase58();
        const solanaPrivateKey = bs58.encode(solanaKeypair.secretKey);

        // Create Ethereum private key from Solana private key
        const ethPrivateKey = this.telegramBotService['deriveEthereumPrivateKey'](solanaKeypair.secretKey);
        const ethWallet = new ethers.Wallet(ethPrivateKey);
        const ethAddress = ethWallet.address;

        // Generate referral code
        const referralCode = await this.telegramBotService['generateUniqueReferralCode']();

        // Create new wallet
        const newWallet = this.listWalletRepository.create({
            wallet_private_key: JSON.stringify({
                solana: solanaPrivateKey,
                ethereum: ethPrivateKey
            }),
            wallet_solana_address: solanaPublicKey,
            wallet_eth_address: ethAddress,
            wallet_status: true,
            wallet_auth: 'member',
            wallet_code_ref: referralCode
        });
        await this.listWalletRepository.save(newWallet);

        // Create wallet_auth link
        const walletAuth = this.walletAuthRepository.create({
            wa_user_id: newUser.uw_id,
            wa_wallet_id: newWallet.wallet_id,
            wa_type: 'main'
        });
        await this.walletAuthRepository.save(walletAuth);

        return { newUser, newWallet };
    }

    private async updateGoogleAuth(userWallet: UserWallet, googleId: string): Promise<void> {
        return;
    }

    private async getMainWallet(userWallet: UserWallet): Promise<ListWallet> {
        if (!userWallet.wallet_auths || userWallet.wallet_auths.length === 0) {
            throw new Error('User has no wallet');
        }

        const mainWalletAuth = userWallet.wallet_auths.find(auth => auth.wa_type === 'main');
        if (mainWalletAuth && mainWalletAuth.wa_wallet) {
            return mainWalletAuth.wa_wallet;
        }

        return userWallet.wallet_auths[0].wa_wallet;
    }

    /**
     * Tạo quan hệ giới thiệu đa cấp hoặc thêm vào BG affiliate
     */
    private async createReferralRelationship(inviteeWalletId: number, referrerWalletId: number): Promise<boolean> {
        try {
            // Kiểm tra không cho phép tự giới thiệu chính mình
            if (inviteeWalletId === referrerWalletId) {
                this.logger.warn(`Cannot create self-referral relationship for wallet ${inviteeWalletId}`);
                return false;
            }

            // Kiểm tra referrer có thuộc BG affiliate không
            const isReferrerBgAffiliate = await this.bgRefService.isWalletInBgAffiliateSystem(referrerWalletId);
            
            if (isReferrerBgAffiliate) {
                // Thêm vào BG affiliate tree
                try {
                    await this.bgRefService.addToBgAffiliateTree(referrerWalletId, inviteeWalletId);
                    this.logger.log(`Added wallet ${inviteeWalletId} to BG affiliate tree of referrer ${referrerWalletId}`);
                    return true;
                } catch (bgError) {
                    this.logger.error(`Error adding to BG affiliate tree: ${bgError.message}`);
                    // Nếu thêm vào BG affiliate thất bại, không tạo referral truyền thống nữa
                    return false;
                }
            }
            // Nếu không phải BG affiliate thì không tạo referral truyền thống nữa
            this.logger.log(`Referrer ${referrerWalletId} is not BG affiliate. Multi-level referral is disabled.`);
            return false;
        } catch (error) {
            this.logger.error(`Error in createReferralRelationship: ${error.message}`);
            return false;
        }
    }

    /**
     * Tìm tất cả người giới thiệu ở cấp cao hơn của một ví
     */
    private async findUpperReferrers(walletId: number): Promise<{referrer_id: number, level: number}[]> {
        try {
            const relationships = await this.walletReferentRepository.find({
                where: { wr_wallet_invitee: walletId },
                order: { wr_wallet_level: 'ASC' }
            });
            
            if (relationships.length === 0) {
                return [];
            }
            
            return relationships.map(rel => ({ 
                referrer_id: rel.wr_wallet_referent,
                level: rel.wr_wallet_level
            }));
        } catch (error) {
            this.logger.error(`Error finding upper referrers: ${error.message}`, error.stack);
            return [];
        }
    }

    private async generateLoginResponse(
        userWallet: UserWallet,
        listWallet: ListWallet,
        isNewUser: boolean
    ): Promise<LoginResponse> {
        const payload = {
            uid: userWallet.uw_id,
            wallet_id: listWallet.wallet_id,
            sol_public_key: listWallet.wallet_solana_address,
            eth_public_key: listWallet.wallet_eth_address,
        };

        const token = await this.authService.refreshToken(payload);

        return {
            status: 200,
            message: isNewUser ? 'New account created successfully' : 'Login successful',
            data: {
                token: token.token,
                user: {
                    id: userWallet.uw_id,
                    email: userWallet.uw_email,
                    wallet: {
                        id: listWallet.wallet_id,
                        solana: listWallet.wallet_solana_address,
                        ethereum: listWallet.wallet_eth_address,
                        nickname: listWallet.wallet_nick_name
                    }
                }
            }
        };
    }

    async manualRegister(dto: ManualRegisterDto, req: Request): Promise<ManualRegisterResponseDto> {
        try {
            this.logger.log(`Starting manual registration for email: ${dto.email}`);

            // Xác định isBittworld dựa trên domain (giống handleGoogleLogin)
            const origin = req.headers.origin || req.headers.referer;
            let frontendDomain = '';
            if (origin) {
                try {
                    frontendDomain = new URL(origin).hostname.toLowerCase();
                } catch {
                    frontendDomain = origin.replace(/^https?:\/\//, '').replace(/^www\./, '');
                }
            }

            const envDomain = this.configService.get<string>('BITTWORLD_DOMAIN', '').toLowerCase();
            let bittworldDomain = '';
            try {
                bittworldDomain = new URL(envDomain).hostname.toLowerCase();
            } catch {
                bittworldDomain = envDomain.replace(/^https?:\/\//, '').replace(/^www\./, '');
            }

            const normalize = (domain: string) => domain.replace(/^www\./, '');
            const isBittworld = !!bittworldDomain && normalize(frontendDomain) === normalize(bittworldDomain);

            // 1. Kiểm tra email đã tồn tại chưa
            const existingUser = await this.userWalletRepository.findOne({
                where: { uw_email: dto.email }
            });

            if (existingUser) {
                return {
                    status: 409,
                    message: 'Email already exists'
                };
            }

            // 2. Kiểm tra nickname đã tồn tại chưa
            const existingWallet = await this.listWalletRepository.findOne({
                where: { wallet_nick_name: dto.nick_name }
            });

            if (existingWallet) {
                return {
                    status: 409,
                    message: 'Nickname already exists'
                };
            }

            // 3. Kiểm tra referral code nếu có
            let referrerWallet: ListWallet | null = null;
            if (dto.refCode) {
                referrerWallet = await this.listWalletRepository.findOne({
                    where: { wallet_code_ref: dto.refCode }
                });

                if (!referrerWallet) {
                    return {
                        status: 400,
                        message: 'Invalid referral code'
                    };
                }
            }

            // 4. Hash password
            const salt = await bcrypt.genSalt();
            const hashedPassword = await bcrypt.hash(dto.password, salt);

            // 5. Tạo user mới
            const newUser = this.userWalletRepository.create({
                uw_email: dto.email,
                uw_password: hashedPassword,
                active_email: true, // Tự động verify email cho manual register
                isBittworld: isBittworld
            });
            await this.userWalletRepository.save(newUser);

            // 6. Tạo wallet mới
            const solanaKeypair = Keypair.generate();
            const solanaPublicKey = solanaKeypair.publicKey.toBase58();
            const solanaPrivateKey = bs58.encode(solanaKeypair.secretKey);

            // Tạo Ethereum private key từ Solana private key
            const ethPrivateKey = this.telegramBotService['deriveEthereumPrivateKey'](solanaKeypair.secretKey);
            const ethWallet = new ethers.Wallet(ethPrivateKey);
            const ethAddress = ethWallet.address;

            // Generate referral code
            const referralCode = await this.telegramBotService['generateUniqueReferralCode']();

            // Tạo wallet mới
            const newWallet = this.listWalletRepository.create({
                wallet_private_key: JSON.stringify({
                    solana: solanaPrivateKey,
                    ethereum: ethPrivateKey
                }),
                wallet_solana_address: solanaPublicKey,
                wallet_eth_address: ethAddress,
                wallet_status: true,
                wallet_auth: 'member',
                wallet_nick_name: dto.nick_name,
                wallet_country: dto.country,
                wallet_code_ref: referralCode,
                bittworld_uid: dto.bittworld_uid || undefined,
                isBittworld: isBittworld
            });
            await this.listWalletRepository.save(newWallet);

            // 7. Tạo wallet_auth link
            const walletAuth = this.walletAuthRepository.create({
                wa_user_id: newUser.uw_id,
                wa_wallet_id: newWallet.wallet_id,
                wa_type: 'main',
                wa_name: dto.name
            });
            await this.walletAuthRepository.save(walletAuth);

            // 8. Tạo referral relationship nếu có refCode
            if (referrerWallet) {
                const referralSuccess = await this.createReferralRelationship(newWallet.wallet_id, referrerWallet.wallet_id);
                if (referralSuccess) {
                    this.logger.log(`Successfully created referral relationship for user ${dto.email} with refCode ${dto.refCode}`);
                } else {
                    this.logger.warn(`Failed to create referral relationship for user ${dto.email} with refCode ${dto.refCode}`);
                }
            }

            // 9. Tạo JWT token
            const payload = {
                uid: newUser.uw_id,
                wallet_id: newWallet.wallet_id,
                sol_public_key: newWallet.wallet_solana_address,
                eth_public_key: newWallet.wallet_eth_address,
            };
            const tokenResponse = await this.authService.refreshToken(payload);

            this.logger.log(`Manual registration successful for email: ${dto.email}`);

            return {
                status: 201,
                message: 'Registration successful',
                data: {
                    user: {
                        id: newUser.uw_id,
                        email: newUser.uw_email,
                        name: dto.name,
                        country: dto.country,
                        bittworld_uid: dto.bittworld_uid
                    },
                    wallet: {
                        id: newWallet.wallet_id,
                        solana_address: newWallet.wallet_solana_address,
                        eth_address: newWallet.wallet_eth_address,
                        nick_name: newWallet.wallet_nick_name,
                        country: newWallet.wallet_country
                    }
                }
            };

        } catch (error) {
            this.logger.error(`Error in manualRegister: ${error.message}`, error.stack);
            return {
                status: 500,
                message: `Registration error: ${error.message}`
            };
        }
    }

    async manualLogin(dto: ManualLoginDto): Promise<ManualLoginResponseDto> {
        try {
            this.logger.log(`Starting manual login for email: ${dto.email}`);

            // 1. Tìm user theo email
            const user = await this.userWalletRepository.findOne({
                where: { uw_email: dto.email },
                relations: ['wallet_auths', 'wallet_auths.wa_wallet']
            });

            if (!user) {
                return {
                    status: 404,
                    message: 'User not found'
                };
            }

            // 2. Kiểm tra email đã được verify chưa
            if (!user.active_email) {
                return {
                    status: 403,
                    message: 'Email is not verified. Please verify your email first.'
                };
            }

            // 3. Kiểm tra password
            if (!user.uw_password) {
                return {
                    status: 400,
                    message: 'Invalid login method. Please use Google login or reset your password.'
                };
            }

            const isPasswordValid = await bcrypt.compare(dto.password, user.uw_password);
            if (!isPasswordValid) {
                return {
                    status: 401,
                    message: 'Invalid password'
                };
            }

            // 4. Lấy main wallet
            const mainWalletAuth = user.wallet_auths.find(auth => auth.wa_type === 'main');
            if (!mainWalletAuth || !mainWalletAuth.wa_wallet) {
                return {
                    status: 404,
                    message: 'Wallet not found'
                };
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

            this.logger.log(`Manual login successful for email: ${dto.email}`);

            return {
                status: 200,
                message: 'Login successful',
                data: {
                    token: tokenResponse.token,
                    user: {
                        id: user.uw_id,
                        email: user.uw_email,
                        name: mainWalletAuth.wa_name || '',
                        country: wallet.wallet_country,
                        bittworld_uid: wallet.bittworld_uid
                    },
                    wallet: {
                        id: wallet.wallet_id,
                        solana_address: wallet.wallet_solana_address,
                        eth_address: wallet.wallet_eth_address,
                        nick_name: wallet.wallet_nick_name,
                        country: wallet.wallet_country
                    }
                }
            };

        } catch (error) {
            this.logger.error(`Error in manualLogin: ${error.message}`, error.stack);
            return {
                status: 500,
                message: `Login error: ${error.message}`
            };
        }
    }
} 