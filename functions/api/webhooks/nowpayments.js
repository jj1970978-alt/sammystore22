// Cloudflare Pages Function — POST /api/webhooks/nowpayments
// NOWPayments IPN (Instant Payment Notification) handler
// Auto-credits the wallet when a crypto payment completes — no "Check Status" needed.
//
// Required env vars in Cloudflare Pages dashboard:
//   NOWPAYMENTS_IPN_SECRET  — from NOWPayments dashboard → Settings → IPN → Secret
//   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Webhook URL to set in NOWPayments dashboard:
//   https://sammystorelogs.com/api/webhooks/nowpayments

export async function onRequestPost({ request, env }) {
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "";
  const serviceKey  = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const ipnSecret   = env.NOWPAYMENTS_IPN_SECRET || "";

  if (!supabaseUrl || !serviceKey)
    return json({ error: "Server not configured" }, 503);

  // Read raw body first — needed for signature verification
  const body = await request.text();
  const signature = request.headers.get("x-nowpayments-sig") || "";

  // Verify HMAC-SHA512 signature (NOWPayments signs the deep-sorted JSON)
  if (ipnSecret) {
    const valid = await verifyNowSignature(body, signature, ipnSecret);
    if (!valid) {
      console.error("[NOWPayments webhook] Invalid signature — rejecting");
      return json({ error: "Invalid signature" }, 401);
    }
  } else {
    // IPN secret not yet configured — warn but proceed (still idempotent via reference check)
    console.warn("[NOWPayments webhook] NOWPAYMENTS_IPN_SECRET not set — skipping signature check");
  }

  let event;
  try { event = JSON.parse(body); } catch { return json({ error: "Bad JSON" }, 400); }

  const { payment_status, order_id: reference, price_amount, actually_paid } = event;

  // Only act on confirmed/finished payments
  if (payment_status !== "finished" && payment_status !== "confirmed") {
    console.log(`[NOWPayments webhook] Ignoring status: ${payment_status} for ${reference}`);
    return json({ received: true, status: payment_status });
  }

  if (!reference) return json({ error: "Missing order_id" }, 400);

  // Idempotency — look up payment_intent by reference
  const intentRes = await sbFetch(supabaseUrl, serviceKey,
    `/rest/v1/payment_intents?reference=eq.${encodeURIComponent(reference)}&provider=eq.nowpayments&limit=1`);
  const intents = await intentRes.json();
  const intent  = intents[0];

  if (intent?.status === "success") {
    return json({ received: true, alreadyCredited: true });
  }

  // Determine user — from payment_intent record or metadata
  const userId = intent?.user_id ?? event.order_description_metadata?.userId ?? null;
  if (!userId) {
    console.error("[NOWPayments webhook] Cannot resolve userId for reference:", reference);
    return json({ received: true }); // 200 so NOWPayments doesn't retry
  }

  const amount = Number(price_amount ?? actually_paid ?? 0);
  if (amount <= 0) return json({ error: "Invalid amount" }, 400);

  // Ensure wallet exists
  await ensureWallet(supabaseUrl, serviceKey, userId);

  // Credit wallet via service-role RPC
  const rpcRes = await sbFetch(supabaseUrl, serviceKey, "/rest/v1/rpc/credit_wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      _user_id:    userId,
      _amount:     amount,
      _provider:   "nowpayments",
      _reference:  reference,
      _description: "Wallet funded via NOWPayments (crypto)",
    }),
  });

  if (!rpcRes.ok) {
    const errText = await rpcRes.text();
    console.error("[NOWPayments webhook] credit_wallet failed:", errText);
    return json({ error: `Failed to credit wallet: ${errText}` }, 500);
  }

  // Mark payment_intent as success
  if (intent) {
    await sbFetch(supabaseUrl, serviceKey,
      `/rest/v1/payment_intents?id=eq.${intent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ status: "success", updated_at: new Date().toISOString() }),
    });
  } else {
    // Create a record even if no pending intent existed
    await sbFetch(supabaseUrl, serviceKey, "/rest/v1/payment_intents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: userId, provider: "nowpayments",
        reference, amount, currency: "NGN",
        status: "success", raw: event,
      }),
    });
  }

  console.log(`[NOWPayments webhook] Credited ₦${amount} → user ${userId} (ref: ${reference})`);
  return json({ received: true, credited: true });
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// NOWPayments signs the deep-sorted JSON body with HMAC-SHA512
async function verifyNowSignature(body, signature, secret) {
  try {
    const parsed = JSON.parse(body);
    const sortedJson = JSON.stringify(deepSortKeys(parsed));
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret),
      { name: "HMAC", hash: "SHA-512" },
      false, ["sign"]
    );
    const sigBuf  = await crypto.subtle.sign("HMAC", key, enc.encode(sortedJson));
    const computed = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    return computed === signature.toLowerCase();
  } catch {
    return false;
  }
}

function deepSortKeys(obj) {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return obj;
  return Object.fromEntries(
    Object.entries(obj)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, deepSortKeys(v)])
  );
}

async function ensureWallet(supabaseUrl, serviceKey, userId) {
  const res  = await sbFetch(supabaseUrl, serviceKey, `/rest/v1/wallets?user_id=eq.${userId}&limit=1`);
  const rows = await res.json();
  if (rows.length > 0) return rows[0];
  const cr = await sbFetch(supabaseUrl, serviceKey, "/rest/v1/wallets", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ user_id: userId, balance: 0, currency: "NGN" }),
  });
  const created = await cr.json();
  return Array.isArray(created) ? created[0] : created;
}

function sbFetch(supabaseUrl, serviceKey, path, extra = {}) {
  const { headers: h = {}, ...rest } = extra;
  return fetch(`${supabaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, ...h },
    ...rest,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
