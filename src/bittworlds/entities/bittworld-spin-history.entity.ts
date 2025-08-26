import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { ListWallet } from '../../telegram-wallets/entities/list-wallet.entity';
import { BittworldRewardItem } from './bittworld-reward-item.entity';
import { BittworldRewardCode } from './bittworld-reward-code.entity';

export enum SpinResultStatus {
    SUCCESS = 'success',
    FAILED = 'failed'
}

@Entity('bittworld_spin_history')
export class BittworldSpinHistory {
    @PrimaryGeneratedColumn({ name: 'bsh_id' })
    bsh_id: number;

    @ManyToOne(() => ListWallet, { nullable: false })
    @JoinColumn({ name: 'bsh_wallet_id' })
    wallet: ListWallet;

    @Column({ name: 'bsh_wallet_id' })
    @Index()
    bsh_wallet_id: number;

    @ManyToOne(() => BittworldRewardItem, { nullable: true })
    @JoinColumn({ name: 'bsh_item_id' })
    item: BittworldRewardItem | null;

    @Column({ name: 'bsh_item_id', nullable: true })
    @Index()
    bsh_item_id: number | null;

    @ManyToOne(() => BittworldRewardCode, { nullable: true })
    @JoinColumn({ name: 'bsh_code_id' })
    reward_code: BittworldRewardCode | null;

    @Column({ name: 'bsh_code_id', nullable: true })
    @Index()
    bsh_code_id: number | null;

    // Snapshot giá trị phần thưởng tại thời điểm quay (USD)
    @Column({ type: 'decimal', precision: 18, scale: 6, name: 'bsh_reward_value_usd', nullable: true })
    bsh_reward_value_usd: number | null;

    @Column({ type: 'enum', enum: SpinResultStatus, name: 'bsh_status', default: SpinResultStatus.SUCCESS })
    @Index()
    bsh_status: SpinResultStatus;

    @Column({ type: 'varchar', length: 255, name: 'bsh_tx_hash', nullable: true })
    bsh_tx_hash: string | null;

    @CreateDateColumn({ name: 'bsh_created_at' })
    bsh_created_at: Date;
}
