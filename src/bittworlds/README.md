# Bittworlds Module API Documentation

## Overview
Module `bittworlds` cung cấp các API cho hệ thống Bittworld DEX, bao gồm quản lý token và hệ thống quay thưởng may mắn.

## Base URL
```
/bittworlds
/bittworld-lucky
```

---

## 🔐 Authentication APIs

### 1. Login với Email
**Endpoint:** `POST /bittworld-lucky/login-email`

**Description:** Đăng nhập bằng email và password, trả về JWT token trong HttpOnly cookie.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "status": 200,
  "message": "Login successful",
  "data": {
    "user": {
      "id": 1,
      "email": "user@example.com",
      "name": "User Name"
    },
    "wallet": {
      "id": 1,
      "solana_address": "ABC123...",
      "eth_address": "0x123...",
      "nick_name": "My Wallet"
    }
  }
}
```

**Cookie:** `lk_access_token` (HttpOnly, Secure, SameSite=None)

---

### 2. Lấy Thông Tin Profile
**Endpoint:** `GET /bittworld-lucky/profile`

**Description:** Lấy thông tin profile của user đã đăng nhập.

**Headers:** 
- Cookie: `lk_access_token` (required)

**Response:**
```json
{
  "status": 200,
  "message": "Profile retrieved successfully",
  "data": {
    "uid": 1,
    "wallet_id": 1,
    "sol_public_key": "ABC123...",
    "eth_public_key": "0x123..."
  }
}
```

---

## 🎰 Lucky Spin APIs

### 3. Nhập Mã Dự Thưởng
**Endpoint:** `POST /bittworld-lucky/enter-code`

**Description:** Nhập mã dự thưởng để nhận lượt quay may mắn.

**Headers:** 
- Cookie: `lk_access_token` (required)

**Request Body:**
```json
{
  "code": "LUCKY2024"
}
```

**Response:**
```json
{
  "status": 200,
  "message": "Reward code entered successfully! You can now spin for rewards.",
  "data": {
    "ticket_id": 123,
    "expires_at": "2024-01-15T23:59:59.000Z",
    "code_info": {
      "name": "LUCKY2024",
      "type": "daily",
      "volume": 1000000
    }
  }
}
```

---

### 4. Quay Thưởng May Mắn
**Endpoint:** `POST /bittworld-lucky/spin`

**Description:** Thực hiện quay thưởng với thuật toán xác suất 20% trúng thưởng.

**Headers:** 
- Cookie: `lk_access_token` (required)

**Request Body:** `{}` (không cần input)

**Response (Trúng thưởng):**
```json
{
  "status": 200,
  "message": "Congratulations! You won a reward!",
  "data": {
    "won_item": {
      "id": 1,
      "name": "iPhone 15 Pro",
      "image_url": "https://example.com/iphone.jpg",
      "value_usd": 999
    },
    "is_winner": true,
    "spin_history_id": 456
  }
}
```

**Response (Không trúng):**
```json
{
  "status": 200,
  "message": "Better luck next time!",
  "data": {
    "is_winner": false,
    "spin_history_id": 456
  }
}
```

---

## 📊 Token Management APIs

### 5. Lấy Danh Sách Token
**Endpoint:** `GET /bittworlds/token-list`

**Description:** Lấy danh sách token từ bảng `bittworld_token` kết hợp dữ liệu từ Solana Tracker.

**Query Parameters:**
- `page` (optional): Số trang, mặc định: 1
- `limit` (optional): Số lượng item mỗi trang, mặc định: 20

**Response:**
```json
{
  "status": 200,
  "message": "Token list retrieved successfully",
  "data": {
    "tokens": [
      {
        "id": 1,
        "name": "Bitcoin",
        "symbol": "BTC",
        "address": "ABC123...",
        "logo_url": "https://example.com/btc.png",
        "status": true,
        "market_cap": 1000000000,
        "fdv": 1000000000,
        "liquidity": 50000000,
        "last_trade_unix_time": 1703123456,
        "volume_1h_usd": 1000000,
        "volume_1h_change_percent": 5.2,
        "volume_24h_usd": 50000000,
        "volume_24h_change_percent": -2.1,
        "trade_24h_count": 1500,
        "price": 45000,
        "price_change_24h_percent": 1.5,
        "holder": 1000000,
        "recent_listing_time": 1703123456,
        "buys": 800,
        "sells": 700,
        "txns": 1500,
        "volume_5m_change_percent": 0.5,
        "volume_4h_change_percent": 2.3
      }
    ],
    "total": 100,
    "page": 1,
    "limit": 20
  }
}
```

---

## 🔧 Authentication & Security

### JWT Token
- **Cookie Name:** `lk_access_token`
- **Expiration:** 24 hours
- **Security:** HttpOnly, Secure (production), SameSite=None

### Guards
- **LuckyAuthGuard:** Bảo vệ các API cần authentication
- **Strategy:** LuckyJwtStrategy (extract token từ cookie)

---

## 📋 Error Responses

### Common Error Format
```json
{
  "statusCode": 400,
  "message": "Error description",
  "error": "Bad Request"
}
```

### Error Codes
- `400` - Bad Request (dữ liệu không hợp lệ)
- `401` - Unauthorized (chưa đăng nhập hoặc token không hợp lệ)
- `403` - Forbidden (không có quyền truy cập)
- `404` - Not Found (không tìm thấy dữ liệu)
- `500` - Internal Server Error (lỗi server)

---

## 🎯 Lucky Spin Algorithm

### Thuật toán quay thưởng:
1. **Xác suất cơ bản:** 20% trúng thưởng
2. **Phân bổ:** Xác suất chia đều cho các phần thưởng còn lại
3. **Giới hạn:** Mỗi phần thưởng chỉ trúng 1 lần/ngày
4. **Công thức:** `winProbability = 0.2 / availableRewardsCount`

### Ví dụ:
- 5 phần thưởng → 4% mỗi phần thưởng
- 4 phần thưởng → 5% mỗi phần thưởng
- 1 phần thưởng → 20% phần thưởng đó

---

## 📁 Database Entities

### Core Entities:
- `BittworldRewardCode` - Mã dự thưởng
- `BittworldRewardItem` - Phần thưởng có thể trúng
- `BittworldRewardWinner` - Người trúng thưởng
- `BittworldSpinHistory` - Lịch sử quay thưởng
- `BittworldSpinTicket` - Vé quay thưởng
- `BittworldToken` - Danh sách token

### Related Entities:
- `UserWallet` - Ví người dùng
- `ListWallet` - Danh sách ví
- `WalletAuth` - Xác thực ví

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database
- JWT_SECRET environment variable

### Installation
```bash
npm install
```

### Environment Variables
```env
JWT_SECRET=your-secret-key
NODE_ENV=development
```

### Running the Application
```bash
npm run start:dev
```

---

## 📝 Notes

- Tất cả API authentication sử dụng HttpOnly cookie để bảo mật
- Lucky spin system có cơ chế chống spam và giới hạn daily
- Token list API tích hợp với Solana Tracker để lấy dữ liệu real-time
- Hệ thống tracking đầy đủ lịch sử quay thưởng và người trúng giải
