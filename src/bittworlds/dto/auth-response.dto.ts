export interface AuthResponseDto {
    status: number;
    message: string;
    data?: {
        token?: string;
        user?: {
            id: number;
            email: string;
            name: string;
        };
        wallet?: {
            id: number;
            solana_address: string;
            eth_address: string;
            nick_name: string;
        };
    };
}
