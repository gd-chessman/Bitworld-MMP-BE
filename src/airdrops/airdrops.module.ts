import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AirdropListPool } from './entities/airdrop-list-pool.entity';
import { AirdropPoolJoin } from './entities/airdrop-pool-join.entity';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';
import { AirdropsController } from './controllers/airdrops.controller';
import { AirdropsService } from './services/airdrops.service';
import { AirdropJwtAuthGuard } from './guards/airdrop-jwt-auth.guard';
import { SolanaModule } from '../solana/solana.module';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AirdropListPool,
      AirdropPoolJoin,
      ListWallet
    ]),
    ConfigModule,
    SolanaModule,
    SharedModule
  ],
  controllers: [AirdropsController],
  providers: [AirdropsService, AirdropJwtAuthGuard],
  exports: [AirdropsService],
})
export class AirdropsModule {} 