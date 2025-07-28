import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('swap_investors')
export class SwapInvestors {
  @PrimaryGeneratedColumn({ name: 'swap_investor_id' })
  swap_investor_id: number;

  @Column({ 
    name: 'wallet_address', 
    type: 'varchar', 
    length: 255,
    nullable: false 
  })
  wallet_address: string;

  @Column({ 
    name: 'coin', 
    type: 'varchar', 
    length: 50,
    nullable: false 
  })
  coin: string;

  @Column({ 
    name: 'amount', 
    type: 'decimal', 
    precision: 18, 
    scale: 6,
    nullable: false 
  })
  amount: number;

  @Column({ 
    name: 'active', 
    type: 'boolean',
    default: true 
  })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
} 