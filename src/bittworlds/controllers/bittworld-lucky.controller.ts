import { Controller, Post, Body, HttpCode, HttpStatus, Res, Get, UseGuards, Req } from '@nestjs/common';
import { Response, Request } from 'express';
import { BittworldLuckyService } from '../services/bittworld-lucky.service';
import { LuckyAuthGuard } from '../guards/lk-auth.guard';
import { LoginDto } from '../dto/login.dto';
import { AuthResponseDto } from '../dto/auth-response.dto';

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
}
