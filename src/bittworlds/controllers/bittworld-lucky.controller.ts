import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { BittworldLuckyService } from '../services/bittworld-lucky.service';
import { LoginDto } from '../dto/login.dto';
import { AuthResponseDto } from '../dto/auth-response.dto';

@Controller('bittworld-lucky')
export class BittworldLuckyController {
    constructor(private readonly bittworldLuckyService: BittworldLuckyService) {}

    @Post('login')
    @HttpCode(HttpStatus.OK)
    async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
        return await this.bittworldLuckyService.login(dto);
    }
}
