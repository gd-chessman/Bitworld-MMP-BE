# Module Referral

Module này quản lý hệ thống giới thiệu và trả thưởng theo khối lượng giao dịch theo mô hình đa cấp.

## Cấu trúc dữ liệu

1. **wallet_referents**: Lưu thông tin quan hệ giới thiệu
   - wr_id: ID quan hệ giới thiệu
   - wr_wallet_invitee: ID ví được giới thiệu (người mới)
   - wr_wallet_referent: ID ví giới thiệu (người giới thiệu)
   - wr_wallet_level: Cấp độ trong hệ thống đa cấp

2. **wallet_ref_rewards**: Lưu thông tin phần thưởng giới thiệu
   - wrr_id: ID phần thưởng
   - wrr_ref_id: ID quan hệ giới thiệu
   - wrr_signature: Chữ ký giao dịch
   - wrr_sol_reward: Phần thưởng bằng SOL
   - wrr_use_reward: Phần thưởng đã sử dụng

3. **referent_settings**: Cài đặt hệ thống giới thiệu
   - rs_id: ID cài đặt
   - rs_ref_level: Số cấp tối đa trong hệ thống đa cấp (mặc định: 7)

## Thiết lập cơ sở dữ liệu

Để tạo các bảng cần thiết, hãy chạy file SQL trong thư mục migrations:

```bash
psql -U username -d database_name -f src/referral/migrations/create-referral-tables.sql
```

Hoặc bạn có thể sao chép nội dung file và thực hiện trực tiếp trong trình quản lý cơ sở dữ liệu. 