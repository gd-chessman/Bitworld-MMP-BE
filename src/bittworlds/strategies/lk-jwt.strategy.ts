import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';

@Injectable()
export class LuckyJwtStrategy extends PassportStrategy(Strategy, 'lucky-jwt') {
    constructor() {
        super({
            jwtFromRequest: ExtractJwt.fromExtractors([
                (request: Request) => {
                    const cookies = request.headers.cookie;
                    if (!cookies) return null;

                    const tokenCookie = cookies
                        .split(';')
                        .find(cookie => cookie.trim().startsWith('lk_access_token='));
                    
                    if (!tokenCookie) return null;

                    return tokenCookie.split('=')[1];
                }
            ]),
            ignoreExpiration: false,
            secretOrKey: process.env.JWT_SECRET,
        });
    }

    async validate(payload: any) {
        return {
            uid: payload.uid,
            wallet_id: payload.wallet_id,
            sol_public_key: payload.sol_public_key,
            eth_public_key: payload.eth_public_key,
        };
    }
}
