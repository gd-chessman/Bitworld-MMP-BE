import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsEnum, IsOptional, Min } from 'class-validator';
import { TransactionType, TransactionStatus } from '../entities/deposit-withdraw-history.entity';

export class CreateDepositWithdrawDto {
    @ApiProperty({
        description: 'Địa chỉ ví Solana nhận tiền',
        example: '7YttLkHGczovz8Zb1XSyjJ8Q9ZxW5WJZqKJYqKJYqKJYqK'
    })
    @IsNotEmpty()
    @IsString()
    wallet_address_to: string;

    @ApiProperty({
        description: 'Số lượng SOL',
        example: 1.5
    })
    @IsNotEmpty()
    @IsNumber()
    @Min(0.000001)
    amount: number;

    @ApiProperty({
        description: 'Loại giao dịch',
        enum: TransactionType,
        example: TransactionType.WITHDRAW
    })
    @IsNotEmpty()
  @IsEnum(TransactionType)
  type: TransactionType;

    @ApiProperty({
        description: 'Mã xác thực Google Authenticator (chỉ cần khi rút tiền và đã bật Google Auth)',
        example: '123456',
        required: false
    })
    @IsOptional()
  @IsString()
    google_auth_token?: string;
}

export class DepositWithdrawResponseDto {
  id: number;
  type: TransactionType;
  amount: number;
  status: string;
  wallet_address_from: string;
  wallet_address_to: string;
  transaction_hash?: string;
  created_at: Date;
}

export class GetHistoryDto {

  wallet_address_from?: string;

  wallet_address_to?: string;

  type?: TransactionType;
} 