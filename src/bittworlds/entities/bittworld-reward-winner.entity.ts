import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BittworldRewardCode } from './bittworld-reward-code.entity';
import { ListWallet } from '../../telegram-wallets/entities/list-wallet.entity';

export enum BittworldRewardWinnerStatus {
  CAN_WITHDRAW = 'can-withdraw',
  WITHDRAWN = 'withdrawn'
}

@Entity('bittworld_reward_winners')
export class BittworldRewardWinner {
  @PrimaryGeneratedColumn()
  brw_id: number;

  @ManyToOne(() => BittworldRewardCode, rewardCode => rewardCode.winners, { nullable: false })
  @JoinColumn({ name: 'brw_code_id' })
  reward_code: BittworldRewardCode;

  @Column({ name: 'brw_code_id' })
  @Index()
  brw_code_id: number;

  @ManyToOne(() => ListWallet, { nullable: false })
  @JoinColumn({ name: 'brw_wallet_id' })
  wallet: ListWallet;

  @Column({ name: 'brw_wallet_id' })
  @Index()
  brw_wallet_id: number;

  @Column({ type: 'decimal', precision: 18, scale: 6, name: 'brw_reward_amount' })
  brw_reward_amount: number;

  @Column({ 
    type: 'enum', 
    enum: BittworldRewardWinnerStatus,
    name: 'brw_status',
    default: BittworldRewardWinnerStatus.CAN_WITHDRAW
  })
  @Index()
  brw_status: BittworldRewardWinnerStatus;

  @Column({ type: 'varchar', length: 255, name: 'brw_tx_hash', nullable: true })
  brw_tx_hash: string | null;

  @CreateDateColumn({ name: 'brw_won_at' })
  brw_won_at: Date;

  @Column({ type: 'timestamp', name: 'brw_withdrawn_at', nullable: true })
  brw_withdrawn_at: Date | null;
}
