export interface SpinTicketsResponseDto {
    status: number;
    message: string;
    data: {
        available_tickets: number;
        used_tickets: number;
        total_tickets: number;
        tickets: Array<{
            id: number;
            is_used: boolean;
            created_at: Date;
            expires_at: Date;
            code_info?: {
                name: string;
                type: string;
                volume: number;
            };
        }>;
    };
}
