# Airdrop Withdrawal Optimization - Batch Processing

## Tổng quan

Hệ thống airdrop withdrawal đã được tối ưu hóa để gộp các transaction có chung `ar_sub_type` và `token_mint` nhằm tiết kiệm phí giao dịch SOL.

## Vấn đề hiện tại

### Trước khi tối ưu:
- Mỗi reward được xử lý riêng biệt với 1 transaction riêng
- Phí giao dịch: ~0.0005 SOL per transaction
- Ví dụ: 100 rewards = 100 transactions = 0.05 SOL phí

### Sau khi tối ưu:
- Gộp rewards theo `token_mint` và `ar_sub_type`
- 1 transaction có thể xử lý nhiều rewards cùng loại
- Phí giao dịch: ~0.0005 SOL base + 0.0001 SOL per recipient
- Ví dụ: 100 rewards gộp thành 10 batches = 10 transactions = 0.0014 SOL phí

## Ví dụ minh họa chi tiết

### **Input: 15 rewards từ 3 ví khác nhau**

```typescript
// Ví dụ rewards:
[
  // Ví A: 3 loại reward
  { id: 1, wallet: "walletA", sub_type: "leader_bonus", amount: 100, token: "ABC123" },
  { id: 2, wallet: "walletA", sub_type: "leader_bonus", amount: 50, token: "ABC123" },
  { id: 3, wallet: "walletA", sub_type: "participation_share", amount: 200, token: "ABC123" },
  { id: 4, wallet: "walletA", sub_type: "participation_share", amount: 150, token: "ABC123" },
  { id: 5, wallet: "walletA", sub_type: "top_pool_reward", amount: 75, token: "ABC123" },
  
  // Ví B: 2 loại reward
  { id: 6, wallet: "walletB", sub_type: "leader_bonus", amount: 80, token: "ABC123" },
  { id: 7, wallet: "walletB", sub_type: "leader_bonus", amount: 40, token: "ABC123" },
  { id: 8, wallet: "walletB", sub_type: "participation_share", amount: 300, token: "ABC123" },
  { id: 9, wallet: "walletB", sub_type: "participation_share", amount: 250, token: "ABC123" },
  
  // Ví C: 1 loại reward
  { id: 10, wallet: "walletC", sub_type: "participation_share", amount: 120, token: "ABC123" },
  { id: 11, wallet: "walletC", sub_type: "participation_share", amount: 180, token: "ABC123" },
  { id: 12, wallet: "walletC", sub_type: "participation_share", amount: 90, token: "ABC123" },
  
  // Token khác
  { id: 13, wallet: "walletA", sub_type: "leader_bonus", amount: 60, token: "XYZ789" },
  { id: 14, wallet: "walletB", sub_type: "participation_share", amount: 200, token: "XYZ789" },
  { id: 15, wallet: "walletC", sub_type: "top_pool_reward", amount: 150, token: "XYZ789" }
]
```

### **Sau khi grouping theo `tokenMint_walletAddress_subType`:**

```typescript
const groupedRewards = {
  // Token ABC123
  "ABC123_walletA_leader_bonus": [
    { id: 1, amount: 100 },
    { id: 2, amount: 50 }
  ], // Total: 150
  
  "ABC123_walletA_participation_share": [
    { id: 3, amount: 200 },
    { id: 4, amount: 150 }
  ], // Total: 350
  
  "ABC123_walletA_top_pool_reward": [
    { id: 5, amount: 75 }
  ], // Total: 75
  
  "ABC123_walletB_leader_bonus": [
    { id: 6, amount: 80 },
    { id: 7, amount: 40 }
  ], // Total: 120
  
  "ABC123_walletB_participation_share": [
    { id: 8, amount: 300 },
    { id: 9, amount: 250 }
  ], // Total: 550
  
  "ABC123_walletC_participation_share": [
    { id: 10, amount: 120 },
    { id: 11, amount: 180 },
    { id: 12, amount: 90 }
  ], // Total: 390
  
  // Token XYZ789
  "XYZ789_walletA_leader_bonus": [
    { id: 13, amount: 60 }
  ], // Total: 60
  
  "XYZ789_walletB_participation_share": [
    { id: 14, amount: 200 }
  ], // Total: 200
  
  "XYZ789_walletC_top_pool_reward": [
    { id: 15, amount: 150 }
  ] // Total: 150
};
```

### **Kết quả xử lý:**

```typescript
// 15 rewards → 9 batches → 9 transactions

// Token ABC123:
// 1. walletA nhận 150 leader_bonus
// 2. walletA nhận 350 participation_share  
// 3. walletA nhận 75 top_pool_reward
// 4. walletB nhận 120 leader_bonus
// 5. walletB nhận 550 participation_share
// 6. walletC nhận 390 participation_share

// Token XYZ789:
// 7. walletA nhận 60 leader_bonus
// 8. walletB nhận 200 participation_share
// 9. walletC nhận 150 top_pool_reward
```

### **So sánh với logic cũ:**

| Logic | Số batches | Số transactions | Phí giao dịch |
|-------|------------|-----------------|---------------|
| **Cũ (token_subType)** | 4 batches | 4 transactions | 0.002 SOL |
| **Mới (token_wallet_subType)** | 9 batches | 9 transactions | 0.0045 SOL |
| **Không gộp** | 15 batches | 15 transactions | 0.0075 SOL |

### **Lợi ích của logic mới:**

1. ✅ **User tracking rõ ràng**: Mỗi ví nhận reward theo từng loại riêng biệt
2. ✅ **Business logic chính xác**: Phân biệt được loại reward cho từng ví
3. ✅ **Vẫn tiết kiệm phí**: Giảm 40% so với không gộp
4. ✅ **Debug dễ dàng**: Có thể track từng loại reward cho từng ví

## Cách thức hoạt động

### 1. Grouping Logic
```typescript
// Group rewards by token_mint, wallet_address and ar_sub_type
const batchKey = `${tokenMint}_${reward.ar_wallet_address}_${reward.ar_sub_type}`;

// Ví dụ:
// - "ABC123_walletA_leader_bonus" 
// - "ABC123_walletA_participation_share"
// - "ABC123_walletB_leader_bonus"
// - "ABC123_walletB_participation_share"
// - "XYZ789_walletC_top_pool_reward"
```

### 2. Amount Aggregation
```typescript
// Gộp amounts cho cùng wallet và sub_type
// Vì mỗi batch chỉ có 1 wallet và 1 sub_type, chỉ cần sum tất cả amounts
const totalAmount = rewards.reduce((sum, reward) => sum + parseFloat(reward.ar_amount.toString()), 0);
```

### 3. Batch Transaction
```typescript
// Tạo 1 transaction với 1 transfer instruction cho 1 wallet
const transaction = new Transaction();

// Chỉ có 1 recipient per batch (same wallet, same sub_type)
const recipient = recipients[0];
const transferInstruction = createTransferInstruction(
  senderATA,
  recipientATA,
  keypair.publicKey,
  totalAmount
);
transaction.add(transferInstruction);
```

## Các loại ar_sub_type

### 1. LEADER_BONUS (10% thưởng Leader)
- Chỉ creator của pool nhận
- Thường có số lượng ít nhưng amount lớn

### 2. PARTICIPATION_SHARE (90% thưởng tham gia)
- Tất cả participants (creator + stakers) đều nhận
- Thường có số lượng nhiều, amount nhỏ

### 3. TOP_POOL_REWARD (Thưởng TOP Pool)
- Chỉ creator của top pools nhận
- Số lượng ít, amount lớn

## API Endpoints

### 1. Original Method (Individual Processing)
```http
POST /admin/airdrop-withdraw
```
- Xử lý từng reward riêng biệt
- Phí cao nhưng đơn giản

### 2. Optimized Method (Batch Processing)
```http
POST /admin/airdrop-withdraw-optimized
```
- Gộp rewards theo batch
- Tiết kiệm phí đáng kể
- Phức tạp hơn nhưng hiệu quả

## Response Format

### Optimized Response
```json
{
  "success": true,
  "message": "Optimized airdrop withdrawal process completed",
  "processed": 150,
  "success_count": 145,
  "error_count": 5,
  "batches_processed": 12,
  "results": [
    {
      "batch_key": "ABC123_leader_bonus",
      "status": "success",
      "transaction_hash": "5J7X...",
      "rewards_count": 15,
      "total_amount": 1000.5,
      "fee_saved": 0.007
    }
  ]
}
```

## Ước tính tiết kiệm phí

### Scenario 1: 1000 rewards (100 ví, 3 loại reward mỗi ví)
- **Before**: 1000 transactions × 0.0005 SOL = 0.5 SOL
- **After**: 300 batches × 0.0005 SOL = 0.15 SOL
- **Savings**: 70% phí giao dịch

### Scenario 2: 100 rewards (20 ví, 3 loại reward mỗi ví)
- **Before**: 100 transactions × 0.0005 SOL = 0.05 SOL  
- **After**: 60 batches × 0.0005 SOL = 0.03 SOL
- **Savings**: 40% phí giao dịch

## Lưu ý quan trọng

### 1. Transaction Size Limit
- Solana có giới hạn transaction size
- Mỗi transaction không nên có quá 50-100 transfer instructions
- Nếu batch quá lớn, sẽ tự động chia nhỏ

### 2. Error Handling
- Nếu 1 batch fail, chỉ batch đó bị ảnh hưởng
- Các batch khác vẫn được xử lý bình thường
- Có retry mechanism cho failed transactions

### 3. Balance Requirements
- Withdraw wallet cần đủ SOL cho phí giao dịch
- Cần đủ token balance cho tất cả transfers
- System sẽ check balance trước khi thực hiện

### 4. ATA Creation
- Nếu recipient chưa có ATA, sẽ tự động tạo
- Phí tạo ATA được tính vào transaction fee
- Có delay để đảm bảo ATA được khởi tạo đúng

## Monitoring & Logging

### Log Levels
- **INFO**: Batch processing progress
- **WARN**: Retry attempts, balance checks
- **ERROR**: Transaction failures, parsing errors

### Key Metrics
- Total rewards processed
- Number of batches created
- Fee savings achieved
- Success/error rates
- Transaction hash tracking

## Migration Strategy

### Phase 1: Testing
- Test với small batch (10-50 rewards)
- Verify transaction success rates
- Monitor fee savings

### Phase 2: Gradual Rollout
- Sử dụng optimized method cho 50% rewards
- Compare performance với original method
- Monitor error rates

### Phase 3: Full Migration
- Chuyển hoàn toàn sang optimized method
- Deprecate original method
- Monitor long-term performance

## Troubleshooting

### Common Issues

1. **Insufficient SOL Balance**
   - Check withdraw wallet SOL balance
   - Ensure enough for estimated fees

2. **Transaction Size Too Large**
   - Reduce batch size
   - Split into smaller batches

3. **ATA Creation Failures**
   - Check recipient address validity
   - Verify token mint address
   - Ensure sufficient SOL for ATA creation

4. **Parsing Errors**
   - Verify private key format
   - Check environment variables
   - Use test endpoint to validate

### Debug Endpoints

```http
GET /admin/airdrop-withdraw/test-private-key
```
- Test private key format
- Validate configuration
- Debug parsing issues
