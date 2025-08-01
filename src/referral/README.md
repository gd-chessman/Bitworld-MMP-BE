# BG Affiliate System Documentation

## Tổng quan
Hệ thống BG Affiliate cho phép tạo cây affiliate với cấu trúc phân cấp, tính toán và phân chia hoa hồng tự động từ các giao dịch.

## API Endpoints

### User APIs

#### 1. Cập nhật commission percent
```
PUT /bg-ref/nodes/commission
```
**Body:**
```json
{
  "toWalletId": 789012,
  "newPercent": 25.00
}
```

#### 2. Cập nhật bg_alias
```
PUT /bg-ref/nodes/alias
```
**Body:**
```json
{
  "toWalletId": 789012,
  "newAlias": "My Custom Alias"
}
```

**Mô tả:**
- Chỉ người tuyến trên mới có thể cập nhật alias cho người tuyến dưới
- Cả hai wallet phải thuộc cùng một cây affiliate
- Alias không được vượt quá 255 ký tự

**Response:**
```json
{
  "success": true,
  "message": "Cập nhật bg_alias thành công",
  "fromWallet": {
    "walletId": 123456,
    "solanaAddress": "ABC123...",
    "nickName": "Upline User"
  },
  "toWallet": {
    "walletId": 789012,
    "solanaAddress": "DEF456...",
    "nickName": "Downline User"
  },
  "oldAlias": "Previous Alias",
  "newAlias": "My Custom Alias"
}
```

#### 3. Lấy lịch sử hoa hồng
```
GET /bg-ref/commission-history
```

#### 4. Kiểm tra status BG affiliate
```
GET /bg-ref/my-bg-affiliate-status
```

#### 5. Lấy thống kê BG affiliate
```
GET /bg-ref/bg-affiliate-stats
```

#### 6. Lấy cây affiliate của mình
```
GET /bg-ref/trees
```

#### 7. Lấy thống kê downline
```
GET /bg-ref/downline-stats
```

## Logic hoạt động

### 1. Tạo cây affiliate
- Admin tạo BG affiliate cho wallet chưa thuộc hệ thống referral nào
- Tự động tạo root node với `ban_parent_wallet_id = null`
- Root BG nhận toàn bộ commission percent

### 2. Thêm node mới
- Khi user mới được giới thiệu bởi BG affiliate member
- Tự động thêm vào cây affiliate với commission percent mặc định
- Commission percent không được vượt quá giới hạn của parent

### 3. Cập nhật commission percent
- Chỉ người giới thiệu trực tiếp mới có quyền thay đổi
- Kiểm tra giới hạn để không ảnh hưởng tuyến dưới
- Lưu log thay đổi

### 4. Cập nhật bg_alias
- Chỉ người tuyến trên mới có thể cập nhật alias cho người tuyến dưới
- Cả hai wallet phải thuộc cùng một cây affiliate
- Kiểm tra quan hệ tuyến trên - tuyến dưới

### 5. Tính toán hoa hồng
- Chỉ tính cho tuyến trên của người giao dịch
- Chỉ tính cho các node có `ban_status = true`
- Tự động phân chia theo commission percent

### 6. Tích hợp với hệ thống referral truyền thống
- Nếu wallet thuộc BG affiliate, bỏ qua referral truyền thống
- Nếu gặp BG affiliate trong chuỗi referral, dừng chuỗi

## Lưu ý quan trọng

1. **Quyền cập nhật alias:**
   - Chỉ người tuyến trên mới có thể cập nhật alias cho người tuyến dưới
   - Không thể cập nhật alias cho chính mình
   - Không thể cập nhật alias cho người cùng cấp hoặc tuyến trên

2. **Validation:**
   - Alias không được vượt quá 255 ký tự
   - Cả hai wallet phải thuộc cùng một cây affiliate
   - Wallet thực hiện thay đổi phải thuộc hệ thống BG affiliate

3. **Error Handling:**
   - Trả về lỗi nếu wallet không thuộc hệ thống BG affiliate
   - Trả về lỗi nếu không có quyền cập nhật (không phải tuyến trên)
   - Trả về lỗi nếu hai wallet không cùng cây affiliate 