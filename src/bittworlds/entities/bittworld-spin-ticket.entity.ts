import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('bittworld_spin_tickets')
export class BittworldSpinTicket {
    @PrimaryGeneratedColumn({ name: 'bst_id' })
    bst_id: number;

    @Column({ name: 'bst_wallet_id' })
    @Index()
    bst_wallet_id: number;

    @Column({ name: 'bst_code_id' })
    @Index()
    bst_code_id: number;

    @Column({ type: 'boolean', name: 'bst_is_used', default: false })
    @Index()
    bst_is_used: boolean;

    @CreateDateColumn({ name: 'bst_created_at' })
    bst_created_at: Date;

    @Column({ type: 'timestamp', name: 'bst_expired_at' })
    bst_expired_at: Date;
}
