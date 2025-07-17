import { Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PublicKey, Connection, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction, Keypair } from '@solana/web3.js';
import { DepositWithdrawHistory, TransactionType, TransactionStatus } from './entities/deposit-withdraw-history.entity';
import { CreateDepositWithdrawDto, GetHistoryDto } from './dto/deposit-withdraw.dto';
import { ConfigService } from '@nestjs/config';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';
import { TelegramWalletsService } from '../telegram-wallets/telegram-wallets.service';
import { UserWallet } from '../telegram-wallets/entities/user-wallet.entity';
import bs58 from 'bs58';

@Injectable()
export class DepositWithdrawService {
  private readonly logger = new Logger(DepositWithdrawService.name);
  private readonly connection: Connection;
  private readonly TRANSACTION_FEE = 0.000005; // Transaction fee in SOL

  constructor(
    @InjectRepository(DepositWithdrawHistory)
    private readonly depositWithdrawRepository: Repository<DepositWithdrawHistory>,
    @InjectRepository(ListWallet)
    private readonly listWalletRepository: Repository<ListWallet>,
    @InjectRepository(UserWallet)
    private readonly userWalletRepository: Repository<UserWallet>,
    private readonly configService: ConfigService,
    private readonly telegramWalletsService: TelegramWalletsService,
  ) {
    const rpcUrl = this.configService.get<string>('SOLANA_RPC_URL');
    if (!rpcUrl) {
      throw new Error('Required environment variables are not set');
    }
    this.connection = new Connection(rpcUrl);
  }

  async createDepositWithdraw(dto: CreateDepositWithdrawDto, userId: number, walletId: number) {
    try {
      // Lấy thông tin ví từ database
      const wallet = await this.listWalletRepository.findOne({
        where: { wallet_id: walletId }
      });

      if (!wallet) {
        throw new BadRequestException('Wallet not found');
      }

      // Kiểm tra Google Auth nếu là giao dịch rút tiền
      if (dto.type === TransactionType.WITHDRAW) {
        // Lấy thông tin user wallet
        const userWallet = await this.userWalletRepository.findOne({
          where: { uw_id: userId }
        });

        if (!userWallet) {
          throw new BadRequestException('User wallet not found');
        }

        // Kiểm tra nếu đã bật Google Auth
        if (userWallet.active_gg_auth) {
          // Yêu cầu token nếu đã bật Google Auth
          if (!dto.google_auth_token) {
            throw new BadRequestException('Google Auth token is required for withdrawal');
          }

          // Verify Google Auth token
          const isVerified = await this.telegramWalletsService.verifyGoogleAuthToken(userId, dto.google_auth_token);
          if (!isVerified) {
            throw new UnauthorizedException('Invalid Google Auth token');
          }
        }
      }

      // Validate wallet address
      let userPublicKey: PublicKey;
      let userKeypair: Keypair;
      let destinationPublicKey: PublicKey;
      
      try {
        // Validate destination wallet address
        try {
          destinationPublicKey = new PublicKey(dto.wallet_address_to);
        } catch (error) {
          throw new BadRequestException('Invalid Solana wallet address');
        }

        userPublicKey = new PublicKey(wallet.wallet_solana_address);
        // Tạo keypair từ private key lấy từ database
        const sol_private_key = JSON.parse(wallet.wallet_private_key).solana
        userKeypair = Keypair.fromSecretKey(bs58.decode(sol_private_key));
        
        // Verify địa chỉ ví trong request phải khác với địa chỉ trong database
        if (userPublicKey.toString() === destinationPublicKey.toString()) {
          throw new BadRequestException('Sender and receiver wallet addresses must be different');
        }
      } catch (error) {
          throw error;
      }

      // Create transaction record
      const transaction = this.depositWithdrawRepository.create({
        wallet_id: walletId,
        wallet_address_from: wallet.wallet_solana_address,
        wallet_address_to: dto.wallet_address_to,
        type: dto.type,
        amount: dto.amount,
        status: TransactionStatus.PENDING,
      });
      this.logger.log('Transaction: ' + JSON.stringify(transaction));

      await this.depositWithdrawRepository.save(transaction);

      if (dto.type === TransactionType.WITHDRAW) {
        // Handle withdrawal using user's wallet
        this.logger.log('Transaction withdrawal')
        await this.processWithdrawal(transaction, userKeypair);
      }

      // if (dto.type === TransactionType.DEPOSIT) {
      //   this.logger.log('Transaction deposit')
      //   await this.handleDepositTransaction(transaction.transaction_hash, transaction.wallet_address);
      // }

      return transaction;
    } catch (error) {
      this.logger.error(`Error creating deposit/withdraw: ${error.message}`);
      throw error;
    }
  }

  private async processWithdrawal(transaction: DepositWithdrawHistory, userKeypair: Keypair) {
    try {
      // Check user wallet balance
      const balance = await this.connection.getBalance(userKeypair.publicKey);
      const balanceInSol = balance / LAMPORTS_PER_SOL;
      
      // Calculate required amount including fee
      const requiredAmount = transaction.amount + this.TRANSACTION_FEE;
      
      if (balanceInSol < requiredAmount) {
        // If balance is insufficient, reduce withdrawal amount to account for fee
        const adjustedAmount = balanceInSol - this.TRANSACTION_FEE;
        if (adjustedAmount <= 0) {
          throw new BadRequestException('Insufficient wallet balance for transaction fee');
        }
        transaction.amount = adjustedAmount;
        this.logger.log(`Adjusted withdrawal amount to ${adjustedAmount} SOL to account for transaction fee`);
      }

      // Create transfer instruction with adjusted amount
      const transferInstruction = SystemProgram.transfer({
        fromPubkey: userKeypair.publicKey,
        toPubkey: new PublicKey(transaction.wallet_address_to),
        lamports: Math.floor(transaction.amount * LAMPORTS_PER_SOL),
      });

      // Create and send transaction
      const tx = new Transaction().add(transferInstruction);
      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [userKeypair], // Sử dụng keypair của người dùng
      );

      // Update transaction status
      transaction.status = TransactionStatus.COMPLETED;
      transaction.transaction_hash = signature;
      this.logger.log('Transaction COMPLETED: ' + JSON.stringify(transaction));
      await this.depositWithdrawRepository.save(transaction);

    } catch (error) {
      this.logger.error(`Error processing withdrawal: ${error.message}`);
      transaction.status = TransactionStatus.FAILED;
      transaction.error_message = error.message;
      this.logger.log('Transaction FAILED: ' + JSON.stringify(transaction));
      await this.depositWithdrawRepository.save(transaction);
      throw error;
    }
  }

  async getHistory(dto: GetHistoryDto) {
    const query = this.depositWithdrawRepository
      .createQueryBuilder('transaction');

    if (dto.wallet_address_from) {
      query.andWhere('(transaction.wallet_address_from = :walletAddressFrom OR transaction.wallet_address_to = :walletAddressFrom)', 
        { walletAddressFrom: dto.wallet_address_from });
    }

    if (dto.type) {
      query.andWhere('transaction.type = :type', { type: dto.type });
    }

    return query.orderBy('transaction.created_at', 'DESC').getMany();
  }

  // async handleDepositTransaction(signature: string, walletAddress: string) {
  //   try {
  //     const tx = await this.connection.getTransaction(signature);
  //     if (!tx || !tx.meta) return;

  //     // Find pending deposit transaction for this wallet
  //     const pendingTransaction = await this.depositWithdrawRepository.findOne({
  //       where: {
  //         wallet_address: walletAddress,
  //         type: TransactionType.DEPOSIT,
  //         status: TransactionStatus.PENDING,
  //       },
  //       order: { created_at: 'DESC' },
  //     });

  //     if (!pendingTransaction) return;

  //     // Verify transaction
  //     const amount = tx.meta.postBalances[0] - tx.meta.preBalances[0];
  //     if (amount <= 0) return;

  //     // Update transaction status
  //     pendingTransaction.status = TransactionStatus.COMPLETED;
  //     pendingTransaction.transaction_hash = signature;
  //     pendingTransaction.amount = amount / LAMPORTS_PER_SOL;
  //     this.logger.log('Transaction: ' + JSON.stringify(pendingTransaction));
  //     // await this.depositWithdrawRepository.save(pendingTransaction);

  //   } catch (error) {
  //     this.logger.error(`Error handling deposit transaction: ${error.message}`);
  //   }
  // }

} 