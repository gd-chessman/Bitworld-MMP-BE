import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { BittworldRewards } from './entities/bittworld-rewards.entity';
import { BittworldWithdraw } from './entities/bittworld-withdraws.entity';
import { BittworldToken } from './entities/bittworld-token.entity';
import { BittworldRewardCode } from './entities/bittworld-reward-code.entity';
import { BittworldRewardWinner } from './entities/bittworld-reward-winner.entity';
import { BittworldRewardItem } from './entities/bittworld-reward-item.entity';
import { BittworldSpinHistory } from './entities/bittworld-spin-history.entity';
import { BittworldSpinTicket } from './entities/bittworld-spin-ticket.entity';
import { BittworldsService } from './services/bittworlds.service';
import { BittworldsController } from './controllers/bittworlds.controller';
import { BittworldLuckyController } from './controllers/bittworld-lucky.controller';
import { BittworldLuckyService } from './services/bittworld-lucky.service';
import { LuckyAuthGuard } from './guards/lk-auth.guard';
import { LuckyJwtStrategy } from './strategies/lk-jwt.strategy';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';
import { UserWallet } from '../telegram-wallets/entities/user-wallet.entity';
import { WalletAuth } from '../telegram-wallets/entities/wallet-auth.entity';
import { BgAffiliateTree } from '../referral/entities/bg-affiliate-tree.entity';
import { SolanaModule } from '../solana/solana.module';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            BittworldRewards, 
            BittworldWithdraw, 
            BittworldToken, 
            BittworldRewardCode, 
            BittworldRewardWinner,
            BittworldRewardItem,
            BittworldSpinHistory,
            BittworldSpinTicket,
            ListWallet, 
            UserWallet,
            WalletAuth,
            BgAffiliateTree
        ]),
        JwtModule.register({
            secret: process.env.JWT_SECRET,
            signOptions: { expiresIn: '24h' },
        }),
        PassportModule,
        SolanaModule,
        ConfigModule,
        ScheduleModule,
        HttpModule,
        AuthModule
    ],
    controllers: [BittworldsController, BittworldLuckyController],
    providers: [
        BittworldsService, 
        BittworldLuckyService,
        LuckyAuthGuard,
        LuckyJwtStrategy
    ],
    exports: [BittworldsService, BittworldLuckyService, LuckyAuthGuard]
})
export class BittworldsModule {} 