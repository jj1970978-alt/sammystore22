---
name: Wallet System
description: How wallet creation, funding, and webhooks work in Sammy Store Logs
---

## Wallet creation strategy (4-step, 3 attempts, 2s delay)
1. SELECT existing row (idempotency — never double-create)
2. POST /api/wallet/ensure (CF Pages Function, uses service_role — bypasses RLS)
3. ensure_user_wallet() SECURITY DEFINER RPC (client-callable fallback)
4. Direct INSERT via anon client (wallets_self_insert policy)

**Why:** credit_wallet RPC is service_role only; wallets table has RLS; old SUPABASE_URL env var pointed at wrong project (jerhefcpsmcvxkmvyyqe); active project is bevmllrasbnmujbgbnuo via VITE_SUPABASE_URL.

## Background provisioning
AuthProvider fires provisionWalletBackground() on SIGNED_IN and INITIAL_SESSION events.
Fire-and-forget — never blocks auth flow.

## CF Pages Function env vars (must be set in Cloudflare Pages dashboard)
- VITE_SUPABASE_URL = https://bevmllrasbnmujbgbnuo.supabase.co
- SUPABASE_SERVICE_ROLE_KEY
- PAYSTACK_SECRET_KEY
- NOWPAYMENTS_API_KEY
- NOWPAYMENTS_IPN_SECRET  ← needed for webhook signature verification
- SITE_URL = https://sammystorelogs.com  (NOT mmystorelogs.com)

## Webhooks
- Paystack: POST /api/webhooks/paystack — HMAC-SHA512 of raw body using PAYSTACK_SECRET_KEY
- NOWPayments: POST /api/webhooks/nowpayments — HMAC-SHA512 of deep-sorted JSON using NOWPAYMENTS_IPN_SECRET

## Supabase migration to apply manually
Run in Supabase SQL Editor (project bevmllrasbnmujbgbnuo):
  supabase/migrations/20260605_ensure_user_wallet_rpc.sql
  (creates ensure_user_wallet() SECURITY DEFINER function)
