export class AirdropStakingLeaderboardEntryDto {
  rank: number;
  poolId: number;
  poolName: string;
  poolSlug: string;
  totalPoolVolume: number;
  memberCount: number;
  walletId: number;
  solanaAddress: string;
  nickName?: string;
  isBittworld: boolean;
  bittworldUid?: string | null;
  stakedVolume: number;
  percentageOfPool: number;
  isCreator: boolean;
  stakingDate: Date;
}

export class AirdropStakingLeaderboardResponseDto {
  success: boolean;
  message: string;
  data: AirdropStakingLeaderboardEntryDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
} 