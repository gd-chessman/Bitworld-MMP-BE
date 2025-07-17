import { Controller, Post, Body, BadRequestException, Logger } from '@nestjs/common';
import { LoginEmailService, GoogleLoginDto, LoginResponse } from './login-email.service';

@Controller('login-email')
export class LoginEmailController {
    private readonly logger = new Logger(LoginEmailController.name);

    constructor(
        private readonly loginEmailService: LoginEmailService,
    ) {}

    @Post()
    async loginWithEmail(@Body() googleData: GoogleLoginDto): Promise<LoginResponse> {
        try {
            this.logger.log(`Received login request for email: ${googleData.code}`);
            return await this.loginEmailService.handleGoogleLogin(googleData);
        } catch (error) {
            this.logger.error(`Error in loginWithEmail: ${error.message}`, error.stack);
            throw new BadRequestException({
                statusCode: 400,
                message: error.message || 'Login failed',
                error: 'Bad Request'
            });
        }
    }
} 