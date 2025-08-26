export interface EnterCodeDto {
    code: string;
}

export interface EnterCodeResponseDto {
    status: number;
    message: string;
    data?: {
        ticket_id: number;
        expires_at: Date;
        code_info: {
            name: string;
            type: string;
            volume: number;
        };
    };
}
