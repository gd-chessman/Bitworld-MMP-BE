import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ListWallet } from '../../telegram-wallets/entities/list-wallet.entity';
import { AirdropListPool } from '../../airdrops/entities/airdrop-list-pool.entity';

export enum RewardCodeType {
  POOL_CREATION = 'pool_creation',
  STAKE = 'stake',
}

@Entity('bittworld_reward_codes')
export class BittworldRewardCode {
  @PrimaryGeneratedColumn({ name: 'brc_id' })
  brc_id: number;

  @Column({ type: 'varchar', length: 20, unique: true, name: 'brc_code' })
  brc_code: string;

  @ManyToOne(() => ListWallet, { nullable: false })
  @JoinColumn({ name: 'brc_creator_wallet_id' })
  creator_wallet: ListWallet;

  @Column({ type: 'int', name: 'brc_creator_wallet_id' })
  brc_creator_wallet_id: number;

  @ManyToOne(() => ListWallet, { nullable: true })
  @JoinColumn({ name: 'brc_claimer_wallet_id' })
  claimer_wallet: ListWallet;

  @Column({ type: 'int', name: 'brc_claimer_wallet_id', nullable: true })
  brc_claimer_wallet_id: number | null;

  @ManyToOne(() => AirdropListPool, { nullable: true })
  @JoinColumn({ name: 'brc_pool_id' })
  pool: AirdropListPool;

  @Column({ type: 'int', name: 'brc_pool_id', nullable: true })
  brc_pool_id: number | null;

  @Column({
    type: 'enum',
    enum: RewardCodeType,
    name: 'brc_type',
  })
  brc_type: RewardCodeType;

  @Column({ type: 'decimal', precision: 18, scale: 6, name: 'brc_volume' })
  brc_volume: number;

  @Column({ type: 'boolean', name: 'brc_is_used', default: false })
  brc_is_used: boolean;

  @CreateDateColumn({ name: 'brc_created_at' })
  brc_created_at: Date;

  @Column({ type: 'timestamp', name: 'brc_expired_at', nullable: true })
  brc_expired_at: Date | null;
}
