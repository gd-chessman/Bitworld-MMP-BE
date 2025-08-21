# Test Admin Airdrop Rewards API

## API Endpoint
```
GET /admin/airdrop-rewards
```

## Authentication
- **JWT Admin Token** required
- Add header: `Authorization: Bearer <admin_jwt_token>`

---

## 1. Basic Test - Get All Rewards

```bash
curl -X GET "http://localhost:3000/admin/airdrop-rewards" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
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
      "wallet_solana_address": "4d9d4hWrrDDgqGiQctkcPwyinZhozyj2xaPRi9MSz44v",
      "wallet_email": "user@example.com",
      "bittworld_uid": "BW123456789",
      "token_name": "MMP Token",
      "token_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

## 2. Filter by Sub Type - Leader Bonus

```bash
curl -X GET "http://localhost:3000/admin/airdrop-rewards?sub_type=leader_bonus" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected:** Only rewards with `ar_sub_type = "leader_bonus"`

---

## 3. Filter by Sub Type - Participation Share

```bash
curl -X GET "http://localhost:3000/admin/airdrop-rewards?sub_type=participation_share" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected:** Only rewards with `ar_sub_type = "participation_share"`

---

## 4. Filter by Sub Type - Top Pool Reward

```bash
curl -X GET "http://localhost:3000/admin/airdrop-rewards?sub_type=top_pool_reward" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected:** Only rewards with `ar_sub_type = "top_pool_reward"`

---

## 5. Combined Filters - Type + Sub Type

```bash
curl -X GET "http://localhost:3000/admin/airdrop-rewards?type=1&sub_type=leader_bonus" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected:** TYPE_1 rewards with leader_bonus sub_type

---

## 6. Combined Filters - Type + Sub Type + Status

```bash
curl -X GET "http://localhost:3000/admin/airdrop-rewards?type=1&sub_type=participation_share&status=can_withdraw" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected:** TYPE_1 rewards with participation_share sub_type and can_withdraw status

---

## 7. Combined Filters - Token + Sub Type

```bash
curl -X GET "http://localhost:3000/admin/airdrop-rewards?token_mint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&sub_type=leader_bonus" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected:** Leader bonus rewards for specific token

---

## 8. Search + Sub Type Filter

```bash
curl -X GET "http://localhost:3000/admin/airdrop-rewards?search=user@example.com&sub_type=participation_share" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected:** Participation share rewards for specific user

---

## 9. Pagination with Sub Type Filter

```bash
curl -X GET "http://localhost:3000/admin/airdrop-rewards?sub_type=leader_bonus&page=2&limit=10" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected:** Page 2 of leader bonus rewards, 10 items per page

---

## 10. Complex Combined Filters

```bash
curl -X GET "http://localhost:3000/admin/airdrop-rewards?type=1&sub_type=participation_share&status=can_withdraw&token_mint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&search=user@example.com&page=1&limit=5" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected:** Complex filter combining all parameters

---

## 11. Error Test - Invalid Sub Type

```bash
curl -X GET "http://localhost:3000/admin/airdrop-rewards?sub_type=invalid_sub_type" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected:** Validation error for invalid enum value

---

## 12. Error Test - Unauthorized

```bash
curl -X GET "http://localhost:3000/admin/airdrop-rewards?sub_type=leader_bonus" \
  -H "Content-Type: application/json"
```

**Expected:** 401 Unauthorized error

---

## 13. Error Test - Invalid Token

```bash
curl -X GET "http://localhost:3000/admin/airdrop-rewards?sub_type=leader_bonus" \
  -H "Authorization: Bearer INVALID_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected:** 401 Unauthorized error

---

## Test Scenarios Summary

| Test Case | Description | Expected Result |
|-----------|-------------|-----------------|
| 1 | Basic API call | All rewards returned |
| 2 | Filter leader_bonus | Only leader bonus rewards |
| 3 | Filter participation_share | Only participation share rewards |
| 4 | Filter top_pool_reward | Only top pool rewards |
| 5 | Type + Sub Type | Combined filtering works |
| 6 | Type + Sub Type + Status | Multiple filters work |
| 7 | Token + Sub Type | Token-specific sub type filtering |
| 8 | Search + Sub Type | User search with sub type |
| 9 | Pagination + Sub Type | Pagination with sub type filter |
| 10 | Complex filters | All filters combined |
| 11 | Invalid sub_type | Validation error |
| 12 | No auth | 401 Unauthorized |
| 13 | Invalid token | 401 Unauthorized |

---

## Expected Sub Type Values

| Sub Type | Description | Type |
|----------|-------------|------|
| `leader_bonus` | 10% Leader Bonus | TYPE_1 |
| `participation_share` | 90% Participation Share | TYPE_1 |
| `top_pool_reward` | TOP Pool Reward | TYPE_2 |

---

## Notes

1. **Admin Authentication Required**: All requests need valid admin JWT token
2. **Enum Validation**: `sub_type` must be one of the valid enum values
3. **Combined Filters**: Multiple filters can be used together
4. **Pagination**: Works with all filter combinations
5. **Search**: Can be combined with sub_type filter
6. **Response Format**: Includes wallet and token information

**API is ready for testing!** 🎉
