import { Controller, Post, Body, HttpCode, HttpStatus, Res, Get, UseGuards, Req } from '@nestjs/common';
import { Response, Request } from 'express';
import { BittworldLuckyService } from '../services/bittworld-lucky.service';
import { LuckyAuthGuard } from '../guards/lk-auth.guard';
import { LoginDto } from '../dto/login.dto';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { SpinRewardDto, SpinRewardResponseDto } from '../dto/spin-reward.dto';
import { EnterCodeDto, EnterCodeResponseDto } from '../dto/enter-code.dto';
import { SpinTicketsResponseDto } from '../dto/spin-tickets.dto';

@Controller('bittworld-lucky')
export class BittworldLuckyController {
    constructor(private readonly bittworldLuckyService: BittworldLuckyService) {}

    @Post('login-email')
    @HttpCode(HttpStatus.OK)
    async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<AuthResponseDto> {
        return await this.bittworldLuckyService.login(dto, res);
    }

    @Get('profile')
    @UseGuards(LuckyAuthGuard)
    async getProfile(@Req() req: Request) {
        const user = (req as any).user;
        return {
            status: 200,
            message: 'Profile retrieved successfully',
            data: {
                uid: user.uid,
                wallet_id: user.wallet_id,
                sol_public_key: user.sol_public_key,
                eth_public_key: user.eth_public_key
            }
        };
    }

    @Post('enter-code')
    @UseGuards(LuckyAuthGuard)
    @HttpCode(HttpStatus.OK)
    async enterCode(@Body() dto: EnterCodeDto, @Req() req: Request): Promise<EnterCodeResponseDto> {
        const user = (req as any).user;
        return await this.bittworldLuckyService.enterCode(dto, user.wallet_id);
    }

    @Post('spin')
    @UseGuards(LuckyAuthGuard)
    @HttpCode(HttpStatus.OK)
    async spinReward(@Req() req: Request): Promise<SpinRewardResponseDto> {
        const user = (req as any).user;
        return await this.bittworldLuckyService.spinReward(user.wallet_id);
    }

    @Get('spin-tickets')
    @UseGuards(LuckyAuthGuard)
    async getSpinTickets(@Req() req: Request): Promise<SpinTicketsResponseDto> {
        const user = (req as any).user;
        return await this.bittworldLuckyService.getSpinTickets(user.wallet_id);
    }
}
