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
    const swapOrder = await this.swapService.createSwap(createSwapDto, walletId);
    
    return {
      success: true,
      message: 'Swap order created successfully',
      data: {
        swap_order_id: swapOrder.swap_order_id,
        swap_type: swapOrder.swap_type,
        input_amount: swapOrder.input_amount,
        status: swapOrder.status,
        created_at: swapOrder.created_at,
      },
    };
  }

  @Get(':swapOrderId')
  async getSwapOrder(
    @Param('swapOrderId') swapOrderId: number,
    @Request() req: any,
  ) {
    const walletId = req.user.wallet_id;
    const swapOrder = await this.swapService.getSwapOrder(swapOrderId, walletId);
    
    return {
      success: true,
      message: 'Swap order retrieved successfully',
      data: swapOrder,
    };
  }

  @Get()
  async getSwapHistory(
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
    @Request() req: any,
  ) {
    const walletId = req.user.wallet_id;
    const swapHistory = await this.swapService.getSwapHistory(walletId, limit, offset);
    
    return {
      success: true,
      message: 'Swap history retrieved successfully',
      data: swapHistory,
    };
  }
} 