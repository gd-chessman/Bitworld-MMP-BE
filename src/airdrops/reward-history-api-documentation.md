# Airdrop Reward History API Documentation

## 🎯 Tổng quan

API `GET /airdrops/reward-history` cho phép người dùng xem lịch sử nhận thưởng airdrop của mình với đầy đủ tính năng lọc, tìm kiếm và phân trang.

## 📋 API Endpoint

### **URL:** `GET /api/v1/airdrops/reward-history`
### **Authentication:** JWT Airdrop Guard required
### **Description:** Get user's airdrop reward history with filtering and search

## 🔧 Query Parameters

### **Pagination:**
- `page` (optional, default: 1): Số trang
- `limit` (optional, default: 20): Số lượng item mỗi trang (max: 100)

### **Filters:**
- `type` (optional): Lọc theo loại thưởng (`1` = TYPE_1, `2` = TYPE_2)
- `sub_type` (optional): Lọc theo sub type (`leader_bonus`, `participation_share`, `top_pool_reward`)
- `status` (optional): Lọc theo trạng thái (`can_withdraw`, `withdrawn`)
- `token_mint` (optional): Lọc theo token mint address
- `token_id` (optional): Lọc theo token ID
- `search_token` (optional): Tìm kiếm theo tên token
- `min_amount` (optional): Lọc theo số lượng tối thiểu
- `max_amount` (optional): Lọc theo số lượng tối đa
- `from_date` (optional): Lọc từ ngày (ISO string)
- `to_date` (optional): Lọc đến ngày (ISO string)

### **Sorting:**
- `sort_by` (optional, default: `date`): Trường sắp xếp (`date`, `amount`, `type`, `status`)
- `sort_order` (optional, default: `desc`): Thứ tự sắp xếp (`asc`, `desc`)

## 📊 Response Structure

### **Success Response (200):**
```json
{
  "success": true,
  "message": "Reward history retrieved successfully",
  "data": {
    "rewards": [
      {
        "ar_id": 1,
        "ar_token_airdrop_id": 1,
        "ar_wallet_id": 123,
        "ar_wallet_address": "4d9d4hWrrDDgqGiQctkcPwyinZhozyj2xaPRi9MSz44v",
        "ar_amount": 8000000,
        "ar_type": "1",
        "ar_sub_type": "leader_bonus",
        "ar_status": "can_withdraw",
        "ar_hash": null,
        "ar_date": "2024-01-15T10:30:00.000Z",
        "token_name": "MMP Token",
        "token_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "pool_name": null,
        "pool_slug": null,
        "reward_description": "Leader Bonus (10%)",
        "formatted_amount": "8,000,000 MMP"
      },
      {
        "ar_id": 2,
        "ar_token_airdrop_id": 1,
        "ar_wallet_id": 123,
        "ar_wallet_address": "4d9d4hWrrDDgqGiQctkcPwyinZhozyj2xaPRi9MSz44v",
        "ar_amount": 54000000,
        "ar_type": "1",
        "ar_sub_type": "participation_share",
        "ar_status": "can_withdraw",
        "ar_hash": null,
        "ar_date": "2024-01-15T10:30:00.000Z",
        "token_name": "MMP Token",
        "token_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "pool_name": null,
        "pool_slug": null,
        "reward_description": "Participation Share (90%)",
        "formatted_amount": "54,000,000 MMP"
      }
    ],
    "stats": {
      "total_rewards": 5,
      "total_amount": 80000000,
      "total_can_withdraw_amount": 80000000,
      "total_withdrawn_amount": 0,
      "can_withdraw_count": 5,
      "withdrawn_count": 0,
      "breakdown_by_type": {
        "1": {
          "count": 4,
          "total_amount": 70000000
        },
        "2": {
          "count": 1,
          "total_amount": 10000000
        }
      },
      "breakdown_by_sub_type": {
        "leader_bonus": {
          "count": 1,
          "total_amount": 8000000
        },
        "participation_share": {
          "count": 3,
          "total_amount": 62000000
        },
        "top_pool_reward": {
          "count": 1,
          "total_amount": 10000000
        }
      },
      "breakdown_by_token": [
        {
          "token_id": 1,
          "token_name": "MMP Token",
          "token_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "count": 5,
          "total_amount": 80000000
        }
      ]
    },
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 5,
      "totalPages": 1
    }
  }
}
```

## 🎯 Usage Examples

### **Example 1: Get all reward history**
```
GET /airdrops/reward-history
```

### **Example 2: Get only leader bonus rewards**
```
GET /airdrops/reward-history?sub_type=leader_bonus
```

### **Example 3: Get only can_withdraw rewards**
```
GET /airdrops/reward-history?status=can_withdraw
```

### **Example 4: Search by token name**
```
GET /airdrops/reward-history?search_token=MMP
```

### **Example 5: Filter by amount range**
```
GET /airdrops/reward-history?min_amount=1000000&max_amount=10000000
```

### **Example 6: Filter by date range**
```
GET /airdrops/reward-history?from_date=2024-01-01T00:00:00.000Z&to_date=2024-12-31T23:59:59.999Z
```

### **Example 7: Sort by amount descending**
```
GET /airdrops/reward-history?sort_by=amount&sort_order=desc
```

### **Example 8: Pagination**
```
GET /airdrops/reward-history?page=2&limit=10
```

### **Example 9: Combined filters**
```
GET /airdrops/reward-history?type=1&sub_type=participation_share&status=can_withdraw&min_amount=1000000&sort_by=date&sort_order=desc&page=1&limit=20
```

## 📊 Statistics Breakdown

### **1. Breakdown by Type:**
- **TYPE_1 (1)**: Volume-based rewards (70% airdrop)
- **TYPE_2 (2)**: TOP Pool rewards (30% airdrop)

### **2. Breakdown by Sub Type:**
- **leader_bonus**: Thưởng Leader (10%)
- **participation_share**: Thưởng tham gia (90%)
- **top_pool_reward**: Thưởng TOP Pool

### **3. Breakdown by Token:**
- Thống kê theo từng token đã nhận thưởng
- Bao gồm số lượng và tổng số thưởng

## 🔍 Reward Descriptions

### **TYPE_1 Rewards:**
- `leader_bonus`: "Leader Bonus (10%)"
- `participation_share`: "Participation Share (90%)"
- Default: "Volume-based Reward"

### **TYPE_2 Rewards:**
- `top_pool_reward`: "TOP Pool Reward"
- Default: "TOP Pool Reward"

## 🎨 Formatted Amount

Số lượng thưởng được format với:
- Dấu phẩy ngăn cách hàng nghìn
- Token symbol (lấy từ tên token đầu tiên)

**Ví dụ:**
- `8000000` → `"8,000,000 MMP"`
- `1234567` → `"1,234,567 MMP"`

## 🔐 Security

### **Authentication:**
- Yêu cầu JWT token hợp lệ
- Sử dụng `AirdropJwtAuthGuard`

### **Authorization:**
- Người dùng chỉ có thể xem lịch sử thưởng của chính mình
- Wallet ID được lấy từ JWT token

### **Validation:**
- Validate tất cả query parameters
- Kiểm tra wallet tồn tại
- Giới hạn limit tối đa 100 items/page

## ⚡ Performance

### **Optimization:**
- Sử dụng TypeORM QueryBuilder cho hiệu suất tối ưu
- Index trên các trường thường query
- Pagination để giới hạn kết quả trả về

### **Caching:**
- Có thể implement Redis cache cho statistics
- Cache breakdown data để tăng tốc độ

## 🚀 Error Handling

### **Common Errors:**
- `400 Bad Request`: Invalid parameters
- `401 Unauthorized`: Missing or invalid JWT token
- `404 Not Found`: Wallet not found
- `500 Internal Server Error`: Server error

### **Error Response:**
```json
{
  "statusCode": 400,
  "message": "Invalid parameters",
  "error": "Bad Request"
}
```

## 📈 Business Logic

### **1. Filtering Logic:**
- Tất cả filters được áp dụng với AND logic
- Date filters sử dụng ISO string format
- Amount filters sử dụng số nguyên

### **2. Sorting Logic:**
- Mặc định sort theo date descending
- Hỗ trợ sort theo amount, type, status
- ASC/DESC order

### **3. Statistics Calculation:**
- Tính toán real-time dựa trên filters
- Breakdown theo type, sub_type, token
- Tổng hợp số liệu cho can_withdraw và withdrawn

## 🎯 Use Cases

### **1. User Dashboard:**
- Hiển thị tổng quan thưởng đã nhận
- Phân tích theo loại thưởng
- Theo dõi trạng thái withdrawal

### **2. Reward Analysis:**
- Phân tích hiệu quả của leader bonus
- So sánh participation share vs top pool rewards
- Track performance theo token

### **3. Compliance & Reporting:**
- Export lịch sử thưởng cho tax purposes
- Audit trail cho từng khoản thưởng
- Verify tính toán rewards

## 🔧 Implementation Details

### **Database Queries:**
- Sử dụng TypeORM QueryBuilder
- LEFT JOIN với token table
- WHERE conditions cho filters
- GROUP BY cho statistics

### **Data Transformation:**
- Map raw database results
- Format amounts với commas
- Generate reward descriptions
- Calculate statistics

### **Pagination:**
- Offset-based pagination
- Total count calculation
- Page size validation

## ✅ Testing

### **Unit Tests:**
- Test filtering logic
- Test sorting functionality
- Test statistics calculation
- Test error handling

### **Integration Tests:**
- Test API endpoints
- Test authentication
- Test authorization
- Test performance

## 🎯 Conclusion

**API `/airdrops/reward-history` cung cấp đầy đủ tính năng để người dùng xem và phân tích lịch sử thưởng airdrop:**

1. ✅ **Comprehensive Filtering**: Theo type, sub_type, status, token, amount, date
2. ✅ **Advanced Search**: Tìm kiếm theo tên token
3. ✅ **Flexible Sorting**: Theo date, amount, type, status
4. ✅ **Detailed Statistics**: Breakdown theo nhiều chiều
5. ✅ **Pagination**: Hỗ trợ phân trang
6. ✅ **Security**: Authentication và authorization
7. ✅ **Performance**: Optimized queries và caching ready

**API sẵn sàng sử dụng và có thể được tích hợp vào frontend ngay!** 🚀
