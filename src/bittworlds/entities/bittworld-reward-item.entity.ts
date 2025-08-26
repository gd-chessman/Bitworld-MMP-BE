import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('bittworld_reward_items')
export class BittworldRewardItem {
    @PrimaryGeneratedColumn({ name: 'bri_id' })
    bri_id: number;

    @Column({ type: 'varchar', length: 120, name: 'bri_name' })
    @Index()
    bri_name: string;

    @Column({ type: 'varchar', length: 500, name: 'bri_image_url', nullable: true })
    bri_image_url: string | null;

    @Column({ type: 'decimal', precision: 18, scale: 6, name: 'bri_value_usd' })
    bri_value_usd: number;

    @Column({ type: 'boolean', name: 'bri_active', default: true })
    bri_active: boolean;

    @CreateDateColumn({ name: 'created_at' })
    created_at: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updated_at: Date;
}
