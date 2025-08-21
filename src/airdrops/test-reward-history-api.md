# Test Cases for Airdrop Reward History API

## 🧪 Test Scenarios

### **1. Basic Functionality Tests**

#### **Test 1.1: Get all reward history**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- Status: 200 OK
- Contains: rewards array, stats, pagination
- Rewards count > 0 (if user has rewards)

#### **Test 1.2: Pagination test**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?page=1&limit=5" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- Status: 200 OK
- rewards.length <= 5
- pagination.page = 1
- pagination.limit = 5

### **2. Filter Tests**

#### **Test 2.1: Filter by reward type**
```bash
# Test TYPE_1 rewards
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?type=1" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test TYPE_2 rewards
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?type=2" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- All rewards have ar_type matching the filter
- stats.breakdown_by_type shows correct counts

#### **Test 2.2: Filter by sub type**
```bash
# Test leader bonus
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?sub_type=leader_bonus" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test participation share
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?sub_type=participation_share" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test top pool reward
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?sub_type=top_pool_reward" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- All rewards have ar_sub_type matching the filter
- stats.breakdown_by_sub_type shows correct counts

#### **Test 2.3: Filter by status**
```bash
# Test can_withdraw
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?status=can_withdraw" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test withdrawn
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?status=withdrawn" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- All rewards have ar_status matching the filter
- stats.can_withdraw_count or stats.withdrawn_count matches

#### **Test 2.4: Filter by amount range**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?min_amount=1000000&max_amount=10000000" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- All rewards have ar_amount between min_amount and max_amount
- stats.total_amount reflects filtered amount

#### **Test 2.5: Filter by date range**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?from_date=2024-01-01T00:00:00.000Z&to_date=2024-12-31T23:59:59.999Z" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- All rewards have ar_date within the date range
- Date filtering works correctly

### **3. Search Tests**

#### **Test 3.1: Search by token name**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?search_token=MMP" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- All rewards have token_name containing "MMP"
- Case-insensitive search works

#### **Test 3.2: Search by token mint**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?token_mint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- All rewards have token_mint matching the filter
- Exact match filtering works

### **4. Sorting Tests**

#### **Test 4.1: Sort by date**
```bash
# Sort by date descending (default)
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?sort_by=date&sort_order=desc" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Sort by date ascending
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?sort_by=date&sort_order=asc" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- Rewards are sorted by ar_date in correct order
- Newest first for desc, oldest first for asc

#### **Test 4.2: Sort by amount**
```bash
# Sort by amount descending
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?sort_by=amount&sort_order=desc" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Sort by amount ascending
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?sort_by=amount&sort_order=asc" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- Rewards are sorted by ar_amount in correct order
- Highest first for desc, lowest first for asc

#### **Test 4.3: Sort by type**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?sort_by=type&sort_order=asc" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- Rewards are sorted by ar_type in ascending order
- TYPE_1 comes before TYPE_2

### **5. Combined Filter Tests**

#### **Test 5.1: Multiple filters**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?type=1&sub_type=participation_share&status=can_withdraw&min_amount=1000000&sort_by=date&sort_order=desc&page=1&limit=10" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- All filters are applied correctly
- Results match all filter criteria
- Sorting and pagination work with filters

#### **Test 5.2: Complex search**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?search_token=MMP&from_date=2024-01-01T00:00:00.000Z&max_amount=50000000&sort_by=amount&sort_order=desc" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- Complex filtering works correctly
- All conditions are satisfied

### **6. Statistics Tests**

#### **Test 6.1: Verify statistics accuracy**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- stats.total_rewards matches rewards.length
- stats.total_amount equals sum of all ar_amount
- stats.breakdown_by_type counts match actual data
- stats.breakdown_by_sub_type counts match actual data
- stats.breakdown_by_token counts match actual data

#### **Test 6.2: Statistics with filters**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?type=1&status=can_withdraw" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- Statistics reflect filtered data only
- Breakdown counts match filtered results

### **7. Error Handling Tests**

#### **Test 7.1: Invalid authentication**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history"
```

**Expected Response:**
- Status: 401 Unauthorized
- Error message about missing token

#### **Test 7.2: Invalid token**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history" \
  -H "Authorization: Bearer INVALID_TOKEN"
```

**Expected Response:**
- Status: 401 Unauthorized
- Error message about invalid token

#### **Test 7.3: Invalid parameters**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?page=0&limit=200" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- Status: 400 Bad Request
- Validation error messages

#### **Test 7.4: Invalid date format**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?from_date=invalid-date" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- Status: 400 Bad Request
- Date format validation error

### **8. Performance Tests**

#### **Test 8.1: Large dataset**
```bash
# Test with large number of rewards
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?limit=100" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- Response time < 2 seconds
- Memory usage reasonable
- No timeout errors

#### **Test 8.2: Complex query performance**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?type=1&sub_type=participation_share&status=can_withdraw&min_amount=1000000&max_amount=100000000&from_date=2024-01-01T00:00:00.000Z&to_date=2024-12-31T23:59:59.999Z&sort_by=amount&sort_order=desc&page=1&limit=50" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- Complex query executes efficiently
- Response time acceptable
- All filters work correctly

### **9. Edge Cases**

#### **Test 9.1: User with no rewards**
```bash
# Test with user who has no reward history
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history" \
  -H "Authorization: Bearer USER_WITH_NO_REWARDS_TOKEN"
```

**Expected Response:**
- Status: 200 OK
- rewards array is empty
- stats show zero values
- pagination.total = 0

#### **Test 9.2: Empty filters**
```bash
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?type=999&sub_type=nonexistent" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- Status: 200 OK
- rewards array is empty (no matches)
- stats reflect empty results

#### **Test 9.3: Boundary values**
```bash
# Test with maximum limit
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?limit=100" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test with minimum values
curl -X GET "http://localhost:3000/api/v1/airdrops/reward-history?min_amount=0&max_amount=1" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
- Boundary values handled correctly
- No errors with edge cases

## 📊 Test Data Setup

### **Prerequisites:**
1. Database with test data
2. User with JWT token
3. Multiple reward records with different types, sub_types, statuses
4. Different token types and amounts

### **Test Data Structure:**
```sql
-- Sample test data
INSERT INTO airdrop_rewards (
  ar_token_airdrop_id, ar_wallet_id, ar_wallet_address, 
  ar_amount, ar_type, ar_sub_type, ar_status, ar_date
) VALUES 
(1, 123, 'wallet1', 8000000, '1', 'leader_bonus', 'can_withdraw', '2024-01-15'),
(1, 123, 'wallet1', 54000000, '1', 'participation_share', 'can_withdraw', '2024-01-15'),
(1, 123, 'wallet1', 10000000, '2', 'top_pool_reward', 'withdrawn', '2024-01-16'),
(2, 123, 'wallet1', 5000000, '1', 'participation_share', 'can_withdraw', '2024-01-17');
```

## ✅ Test Checklist

### **Functionality:**
- [ ] Basic API call works
- [ ] Pagination works correctly
- [ ] All filters work individually
- [ ] Combined filters work
- [ ] Sorting works for all fields
- [ ] Search functionality works
- [ ] Statistics are accurate

### **Security:**
- [ ] Authentication required
- [ ] Authorization works (user can only see own data)
- [ ] Input validation works
- [ ] SQL injection prevention

### **Performance:**
- [ ] Response time acceptable
- [ ] Memory usage reasonable
- [ ] Database queries optimized
- [ ] No N+1 query problems

### **Error Handling:**
- [ ] Invalid parameters handled
- [ ] Authentication errors handled
- [ ] Database errors handled
- [ ] Graceful error responses

## 🎯 Success Criteria

### **All tests should pass:**
1. ✅ API returns correct data structure
2. ✅ Filters work as expected
3. ✅ Sorting works correctly
4. ✅ Statistics are accurate
5. ✅ Pagination works properly
6. ✅ Error handling is robust
7. ✅ Performance is acceptable
8. ✅ Security is maintained

### **Performance benchmarks:**
- Response time: < 2 seconds for complex queries
- Memory usage: < 100MB for large datasets
- Database queries: < 5 queries per request
- Error rate: < 1% for valid requests

## 🚀 Deployment Checklist

### **Before deploying to production:**
1. ✅ All unit tests pass
2. ✅ Integration tests pass
3. ✅ Performance tests pass
4. ✅ Security tests pass
5. ✅ Documentation is complete
6. ✅ Error handling is comprehensive
7. ✅ Monitoring is in place
8. ✅ Logging is configured

**API is ready for production use!** 🎉
