export interface SpinRewardDto {
    // Không cần input gì, chỉ cần user đã đăng nhập và có lượt quay
}

export interface SpinRewardResponseDto {
    status: number;
    message: string;
    data?: {
        won_item?: {
            id: number;
            name: string;
            image_url: string | null;
            value_usd: number;
        };
        is_winner: boolean;
        spin_history_id: number;
    };
}
