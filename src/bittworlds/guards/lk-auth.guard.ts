import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

@Injectable()
export class LuckyAuthGuard implements CanActivate {
    constructor(private jwtService: JwtService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const token = this.extractTokenFromHeader(request);
        
        if (!token) {
            throw new UnauthorizedException('Access token not found');
        }
        
        try {
            const payload = await this.jwtService.verifyAsync(token, {
                secret: process.env.JWT_SECRET
            });
            
            // Attach user info to request
            request['user'] = payload;
            return true;
        } catch {
            throw new UnauthorizedException('Invalid access token');
        }
    }

    private extractTokenFromHeader(request: Request): string | undefined {
        const cookies = request.headers.cookie;
        if (!cookies) return undefined;

        const tokenCookie = cookies
            .split(';')
            .find(cookie => cookie.trim().startsWith('lk_access_token='));
        
        if (!tokenCookie) return undefined;

        return tokenCookie.split('=')[1];
    }
}
