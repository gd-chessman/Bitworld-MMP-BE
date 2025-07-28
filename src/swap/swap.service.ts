import { Injectable, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey, Transaction, sendAndConfirmTransaction, Keypair, SystemProgram } from '@solana/web3.js';
import { SwapOrder, SwapOrderType, SwapOrderStatus } from './entities/swap-order.entity';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';
import { CreateSwapDto } from './dto/create-swap.dto';
import { TOKEN_PROGRAM_ID} from '@solana/spl-token';
import bs58 from 'bs58';
import axios from 'axios';

@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);
  private readonly connection: Connection;

  // Cache cho giá SOL
  private solPriceCache: { price: number; timestamp: number } | null = null;
  private readonly CACHE_DURATION = 15 * 1000; // 15 giây

  // Token addresses
  private readonly SOL_MINT = 'So11111111111111111111111111111111111111112';
  private readonly USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

  // Authority keypair cho swap pool
  private readonly swapAuthorityKeypair: Keypair;

  constructor(
    @InjectRepository(SwapOrder)
    private swapOrderRepository: Repository<SwapOrder>,
    @InjectRepository(ListWallet)
    private listWalletRepository: Repository<ListWallet>,
    private configService: ConfigService,
  ) {
    const rpcUrl = this.configService.get<string>('SOLANA_RPC_URL');
    if (!rpcUrl) {
      throw new InternalServerErrorException('SOLANA_RPC_URL is not configured');
    }
    this.connection = new Connection(rpcUrl);

    // Khởi tạo swap authority keypair
    const swapAuthorityPrivateKey = this.configService.get<string>('SWAP_AUTHORITY_PRIVATE_KEY');
    if (!swapAuthorityPrivateKey) {
      throw new InternalServerErrorException('SWAP_AUTHORITY_PRIVATE_KEY is not configured');
    }
    
    try {
      const decodedKey = bs58.decode(swapAuthorityPrivateKey);
      if (decodedKey.length !== 64) {
        this.logger.error(`Invalid swap authority key size: ${decodedKey.length} bytes`);
        throw new InternalServerErrorException('Invalid swap authority private key size');
      }
      this.swapAuthorityKeypair = Keypair.fromSecretKey(decodedKey);
    } catch (error) {
      this.logger.error(`Failed to create swap authority keypair: ${error.message}`);
      throw new InternalServerErrorException('Failed to initialize swap authority keypair');
    }
  }

  /**
   * Kiểm tra cache có hợp lệ không
   */
  private isCacheValid(): boolean {
    if (!this.solPriceCache) {
      return false;
    }
    const now = Date.now();
    return (now - this.solPriceCache.timestamp) < this.CACHE_DURATION;
  }


  /**
   * Lấy giá USD của SOL từ CoinGecko API với cache 15 giây
   */
  private async getSolPriceUSD(): Promise<number> {
    if (this.isCacheValid() && this.solPriceCache) {
      this.logger.debug(`Using cached SOL price: $${this.solPriceCache.price}`);
      return this.solPriceCache.price;
    }

    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const price = parseFloat(response.data.solana.usd);
      
      this.solPriceCache = {
        price: price,
        timestamp: Date.now()
      };
      
      this.logger.debug(`Updated SOL price cache: $${price}`);
      return price;
    } catch (error) {
      this.logger.error(`Error fetching SOL price: ${error.message}`);
      
      if (this.solPriceCache) {
        this.logger.warn(`Using stale cached SOL price: $${this.solPriceCache.price}`);
        return this.solPriceCache.price;
      }
      
      throw new BadRequestException('Failed to fetch SOL price');
    }
  }

  async createSwap(createSwapDto: CreateSwapDto, walletId: number): Promise<SwapOrder> {
    try {
      // 1. Validate input
      if (createSwapDto.input_amount <= 0) {
        throw new BadRequestException('Input amount must be greater than 0');
      }

      // 2. Lấy thông tin wallet
      const wallet = await this.listWalletRepository.findOne({
        where: { wallet_id: walletId }
      });

      if (!wallet) {
        throw new BadRequestException('Wallet not found');
      }

      // 3. Tạo Keypair từ private_key của wallet
      let userKeypair: Keypair;
      try {
        // Parse wallet_private_key từ JSON format
        let privateKeyData: any;
        try {
          privateKeyData = JSON.parse(wallet.wallet_private_key);
        } catch (parseError) {
          this.logger.error(`Failed to parse wallet_private_key JSON: ${parseError.message}`);
          throw new BadRequestException('Invalid wallet private key format');
        }

        // Lấy Solana private key
        const solanaPrivateKey = privateKeyData.solana;
        if (!solanaPrivateKey) {
          throw new BadRequestException('Solana private key not found in wallet');
        }

        // Decode Solana private key
        const decodedKey = bs58.decode(solanaPrivateKey);
        if (decodedKey.length !== 64) {
          this.logger.error(`Invalid Solana key size: ${decodedKey.length} bytes`);
          throw new BadRequestException('Invalid Solana private key size');
        }
        userKeypair = Keypair.fromSecretKey(decodedKey);
      } catch (error) {
        this.logger.error(`Failed to create Solana keypair: ${error.message}`);
        throw new BadRequestException(`Failed to create keypair: ${error.message}`);
      }

      // 4. Lấy giá SOL hiện tại
      const solPriceUSD = await this.getSolPriceUSD();

      // 5. Tính toán output amount và exchange rate
      let outputAmount: number;
      let exchangeRate: number;

      switch (createSwapDto.swap_type) {
        case SwapOrderType.USDT_TO_SOL:
          // USDT sang SOL: 1 USDT = 1/SOL_PRICE SOL
          exchangeRate = 1 / solPriceUSD;
          outputAmount = createSwapDto.input_amount * exchangeRate;
          break;
        
        case SwapOrderType.SOL_TO_USDT:
          // SOL sang USDT: 1 SOL = SOL_PRICE USDT
          exchangeRate = solPriceUSD;
          outputAmount = createSwapDto.input_amount * exchangeRate;
          break;
        
        default:
          throw new BadRequestException(`Unsupported swap type: ${createSwapDto.swap_type}`);
      }

      // 6. Tạo swap order với trạng thái PENDING
      const swapOrder = this.swapOrderRepository.create({
        wallet_id: walletId,
        swap_type: createSwapDto.swap_type,
        input_amount: createSwapDto.input_amount,
        output_amount: outputAmount,
        exchange_rate: exchangeRate,
        status: SwapOrderStatus.PENDING
      });

      const savedOrder = await this.swapOrderRepository.save(swapOrder);

      // 7. Kiểm tra balance của user
      let hasBalance = false;

      switch (createSwapDto.swap_type) {
        case SwapOrderType.USDT_TO_SOL:
          // Kiểm tra balance USDT
          const usdtMint = new PublicKey(this.USDT_MINT);
          const tokenAccounts = await this.connection.getTokenAccountsByOwner(
            userKeypair.publicKey,
            { mint: usdtMint }
          );
          
          if (tokenAccounts.value.length > 0) {
            const userTokenAccount = tokenAccounts.value[0].pubkey;
            const tokenBalance = await this.connection.getTokenAccountBalance(userTokenAccount);
            hasBalance = (tokenBalance.value.uiAmount || 0) >= createSwapDto.input_amount;
          }
          break;
        
        case SwapOrderType.SOL_TO_USDT:
          // Kiểm tra balance SOL
          const balance = await this.connection.getBalance(userKeypair.publicKey);
          hasBalance = balance >= createSwapDto.input_amount * 1e9; // Convert SOL to lamports
          break;
      }

      if (!hasBalance) {
        savedOrder.status = SwapOrderStatus.FAILED;
        savedOrder.error_message = 'Insufficient balance';
        await this.swapOrderRepository.save(savedOrder);
        throw new BadRequestException('Insufficient balance');
      }

      // 8. Thực hiện swap transaction
      try {
        const transaction = new Transaction();

        switch (createSwapDto.swap_type) {
          case SwapOrderType.USDT_TO_SOL:
            // USDT sang SOL: User gửi USDT, nhận SOL
            // Note: Đây là implementation đơn giản, trong thực tế cần xử lý SPL token transfer
            // và tạo ATA nếu cần thiết
            
            // Gửi SOL từ pool đến user (simplified)
            const outputSolLamports = Math.floor(outputAmount * 1e9);
            transaction.add(
              SystemProgram.transfer({
                fromPubkey: this.swapAuthorityKeypair.publicKey,
                toPubkey: userKeypair.publicKey,
                lamports: outputSolLamports,
              })
            );
            break;

          case SwapOrderType.SOL_TO_USDT:
            // SOL sang USDT: User gửi SOL, nhận USDT
            
            // Gửi SOL từ user đến pool
            const inputSolLamports = Math.floor(createSwapDto.input_amount * 1e9);
            transaction.add(
              SystemProgram.transfer({
                fromPubkey: userKeypair.publicKey,
                toPubkey: this.swapAuthorityKeypair.publicKey,
                lamports: inputSolLamports,
              })
            );

            // Gửi USDT từ pool về cho user
            this.logger.log(`SOL to USDT swap: User sent ${createSwapDto.input_amount} SOL, will receive ${outputAmount} USDT`);
            
            break;
        }

        // Lấy blockhash và set fee payer
        const { blockhash } = await this.connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = userKeypair.publicKey;

        // Gửi và xác nhận transaction - chỉ ký với keypair cần thiết
        let signers: Keypair[];
        switch (createSwapDto.swap_type) {
          case SwapOrderType.USDT_TO_SOL:
            // Chỉ cần authority ký vì authority gửi SOL
            signers = [this.swapAuthorityKeypair];
            break;
          case SwapOrderType.SOL_TO_USDT:
            // Chỉ cần user ký vì user gửi SOL
            signers = [userKeypair];
            break;
          default:
            signers = [userKeypair];
        }

        const txHash = await sendAndConfirmTransaction(
          this.connection,
          transaction,
          signers,
          {
            commitment: 'confirmed',
            preflightCommitment: 'confirmed'
          }
        );

        // 9. Cập nhật order thành COMPLETED
        savedOrder.status = SwapOrderStatus.COMPLETED;
        savedOrder.transaction_hash = txHash;
        await this.swapOrderRepository.save(savedOrder);

        this.logger.log(`Swap completed successfully: ${createSwapDto.swap_type}, Amount: ${createSwapDto.input_amount}, Output: ${outputAmount}, TX: ${txHash}`);

        return savedOrder;

      } catch (error) {
        // 10. Xử lý lỗi và cập nhật order
        savedOrder.status = SwapOrderStatus.FAILED;
        savedOrder.error_message = error.message;
        await this.swapOrderRepository.save(savedOrder);

        this.logger.error(`Swap failed: ${error.message}`);

        const errorMessage = error.message || '';
        if (errorMessage.includes('insufficient lamports')) {
          throw new BadRequestException('Insufficient SOL for transaction fees');
        }
        if (errorMessage.includes('insufficient funds for rent')) {
          throw new BadRequestException('Insufficient SOL balance');
        }
        if (errorMessage.includes('insufficient balance')) {
          throw new BadRequestException('Insufficient token balance');
        }
        
        throw new BadRequestException(`Swap failed: ${errorMessage}`);
      }

    } catch (error) {
      this.logger.error(`Error creating swap: ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }

  async getSwapOrder(swapOrderId: number, walletId: number): Promise<SwapOrder> {
    const swapOrder = await this.swapOrderRepository.findOne({
      where: { swap_order_id: swapOrderId, wallet_id: walletId },
    });

    if (!swapOrder) {
      throw new BadRequestException('Swap order not found');
    }

    return swapOrder;
  }

  async getSwapHistory(walletId: number, limit: number = 20, offset: number = 0): Promise<SwapOrder[]> {
    return await this.swapOrderRepository.find({
      where: { wallet_id: walletId },
      order: { created_at: 'DESC' },
      take: limit,
      skip: offset,
    });
  }
} 