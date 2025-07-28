import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AirdropListPool } from './entities/airdrop-list-pool.entity';
import { AirdropPoolJoin } from './entities/airdrop-pool-join.entity';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';
import { AirdropsController } from './controllers/airdrops.controller';
import { AirdropsService } from './services/airdrops.service';
import { SolanaModule } from '../solana/solana.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AirdropListPool,
      AirdropPoolJoin,
      ListWallet
    ]),
    ConfigModule,
    SolanaModule
  ],
  controllers: [AirdropsController],
  providers: [AirdropsService],
  exports: [AirdropsService],
})
export class AirdropsModule {} 