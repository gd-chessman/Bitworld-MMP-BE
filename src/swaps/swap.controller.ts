import { Controller, Post, Get, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { SwapService } from './swap.service';
import { CreateSwapDto } from './dto/create-swap.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('swaps')
@UseGuards(JwtAuthGuard)
export class SwapController {
  constructor(private readonly swapService: SwapService) {}

  @Post()
  async createSwap(
    @Body() createSwapDto: CreateSwapDto,
    @Request() req: any,
  ) {
    const walletId = req.user.wallet_id;
    return await this.swapService.createSwap(createSwapDto, walletId);
  }

  @Get(':swapOrderId')
  async getSwapOrder(
    @Param('swapOrderId') swapOrderId: number,
    @Request() req: any,
  ) {
    const walletId = req.user.wallet_id;
    return await this.swapService.getSwapOrder(swapOrderId, walletId);
  }

  @Get()
  async getSwapHistory(
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
    @Request() req: any,
  ) {
    const walletId = req.user.wallet_id;
    return await this.swapService.getSwapHistory(walletId, limit, offset);
  }
} 