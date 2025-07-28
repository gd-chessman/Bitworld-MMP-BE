import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SwapOrder } from './swap-order.entity';

@Entity('swap_investor_rewards')
export class SwapInvestorReward {
  @PrimaryGeneratedColumn({ name: 'swap_investor_reward_id' })
  swap_investor_reward_id: number;

  @Column({ 
    name: 'reward_sol_amount', 
    type: 'decimal', 
    precision: 18, 
    scale: 6,
    nullable: false 
  })
  reward_sol_amount: number;

  @Column({ 
    name: 'swap_order_id', 
    type: 'integer',
    nullable: false 
  })
  swap_order_id: number;

  @Column({ 
    name: 'investor_id', 
    type: 'integer',
    nullable: false 
  })
  investor_id: number;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  // Foreign key reference to SwapOrder
  @ManyToOne(() => SwapOrder, swapOrder => swapOrder.investorRewards)
  @JoinColumn({ name: 'swap_order_id' })
  swapOrder: SwapOrder;
} 