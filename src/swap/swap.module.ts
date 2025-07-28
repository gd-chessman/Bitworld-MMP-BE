import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SwapController } from './swap.controller';
import { SwapService } from './swap.service';
import { SwapOrder } from './entities/swap-order.entity';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([SwapOrder, ListWallet]),
  ],
  controllers: [SwapController],
  providers: [SwapService],
  exports: [SwapService],
})
export class SwapModule {} 