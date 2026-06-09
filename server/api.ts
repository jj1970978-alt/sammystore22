import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_PROD = process.env.NODE_ENV === "production";

const app = express();
app.use(cors());
// Preserve raw body buffer for webhook signature verification while still parsing JSON for routes
app.use(express.json({
  verify: (req: any, _res, buf: Buffer) => {
    (req as any).rawBody = buf;
  },
}));

// ─── File upload (multer) ──────────────────────────────────────────────────
const uploadsDir = path.resolve(__dirname, "../public/uploads");
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

// ─── Config ──────────────────────────────────────────────────────────��[...]
// Prefer VITE_SUPABASE_URL (the active project) over the legacy SUPABASE_URL
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PAYSTACK_SECRET_KEY  = process.env.PAYSTACK_SECRET_KEY ?? "";
const NOWPAYMENTS_API_KEY  = process.env.NOWPAYMENTS_API_KEY ?? "";
const ADMIN_EMAIL          = process.env.ADMIN_EMAIL ?? "";

// ─── Supabase admin client ─────────────────────────────────────────────────
let supabaseAdmin: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  try {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    console.log("[API] Supabase admin client initialized");
  } catch (e) {
    console.error("[API] Failed to initialize Supabase client:", e);
  }
} else {
  console.warn("[API] ⚠️  SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY not set — auth-dependent routes will return 503");
}

// ─── Admin auto-seeding ────────────────────────────────────────────────────
async function seedAdmin() {
  if (!supabaseAdmin || !ADMIN_EMAIL) return;
  try {
    // Find the user by email
    const { data: users, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
    if (listErr || !users) return;
    const adminUser = users.users.find((u) => u.email === ADMIN_EMAIL);
    if (!adminUser) {
      console.log(`[API] Admin seed: user ${ADMIN_EMAIL} not found in auth — they must sign up first`);
      return;
    }
    // Check if role already exists
    const { data: existing } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", adminUser.id)
      .eq("role", "admin")
      .limit(1);
    if (existing && existing.length > 0) {
      console.log(`[API] Admin seed: ${ADMIN_EMAIL} already has admin role ✓`);
      return;
    }
    // Insert admin role
    const { error: insertErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: adminUser.id, role: "admin" });
    if (insertErr) {
      console.error("[API] Admin seed: failed to insert role —", insertErr.message);
    } else {
      console.log(`[API] ✅ Admin role granted to ${ADMIN_EMAIL}`);
    }
  } catch (e) {
    console.error("[API] Admin seed error:", e);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────�[...]
function requireSupabase(res: express.Response): supabaseAdmin is SupabaseClient {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Service temporarily unavailable — Supabase not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Replit Secrets." });
    return false;
  }
  return true;
}

async function getAuthUser(req: express.Request) {
  if (!supabaseAdmin) return null;
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

function err(res: express.Response, status: number, msg: string) {
  return res.status(status).json({ error: msg });
}

// ─── Routes ──────────────────────────────────────────────────────────�[...]

// Image upload — no auth required (admin-only UI enforces access control)
app.post("/api/upload/image", upload.single("file"), (req, res) => {
  if (!req.file) return err(res, 400, "No file uploaded");
  const siteUrl =
    process.env.VITE_SITE_URL ??
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
  const url = siteUrl
    ? `${siteUrl}/uploads/${req.file.filename}`
    : `/uploads/${req.file.filename}`;
  return res.json({ url });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    supabase: !!supabaseAdmin,
    paystack: !!PAYSTACK_SECRET_KEY,
    nowpayments: !!NOWPAYMENTS_API_KEY,
    adminEmail: ADMIN_EMAIL || null,
  });
});

app.post("/api/payment/verify-paystack", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");

  const { reference, userId } = req.body as { reference?: string; userId?: string };
  if (!reference || !userId) return err(res, 400, "reference and userId are required");
  if (userId !== user.id) return err(res, 403, "Forbidden");

  const { data: intent, error: intentErr } = await supabaseAdmin!
    .from("payment_intents")
    .select("*")
    .eq("reference", reference)
    .eq("user_id", userId)
    .eq("provider", "paystack")
    .single();

  if (intentErr || !intent) return err(res, 400, "Invalid or expired payment reference");
  if ((intent as Record<string, unknown>).status === "success") {
    return res.json({ success: true, amount: Number((intent as Record<string, unknown>).amount), alreadyCredited: true });
  }

  if (!PAYSTACK_SECRET_KEY) return err(res, 500, "Paystack is not configured — contact support");

  let paystackRes: Response;
  try {
    paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
    );
  } catch {
    return err(res, 502, "Could not reach Paystack — please try again later");
  }

  if (!paystackRes.ok) return err(res, 502, "Could not verify with Paystack — please try again");

  const json = (await paystackRes.json()) as { status: boolean; data?: { status: string; amount: number } };
  if (!json.status || json.data?.status !== "success") {
    return err(res, 400, "Payment not confirmed — contact support if you were charged");
  }

  const amount = (json.data?.amount ?? 0) / 100;

  const { error: creditErr } = await supabaseAdmin!.rpc(
    "credit_wallet" as never,
    { _user_id: userId, _amount: amount, _provider: "paystack", _reference: reference, _description: "Wallet funded via Paystack" } as never
  );
  if (creditErr) return err(res, 500, (creditErr as { message: string }).message);

  await supabaseAdmin!
    .from("payment_intents")
    .update({ status: "success", updated_at: new Date().toISOString() })
    .eq("reference", reference);

  return res.json({ success: true, amount, alreadyCredited: false });
});

app.post("/api/payment/nowpayments-invoice", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");

  const { amount, userId, reference } = req.body as { amount?: number; userId?: string; reference?: string };
  if (!amount || !userId || !reference) return err(res, 400, "amount, userId and reference are required");
  if (userId !== user.id) return err(res, 403, "Forbidden");

  const { data: intent, error: intentErr } = await supabaseAdmin!
    .from("payment_intents")
    .select("id")
    .eq("reference", reference)
    .eq("user_id", userId)
    .eq("provider", "nowpayments")
    .single();

  if (intentErr || !intent) return err(res, 400, "Invalid payment reference");
  if (!NOWPAYMENTS_API_KEY) return err(res, 500, "NOWPayments is not configured — contact support");

  const siteUrl =
    process.env.VITE_SITE_URL ??
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://mmystorelogs.com");

  let nowRes: Response;
  try {
    nowRes = await fetch("https://api.nowpayments.io/v1/invoice", {
      method: "POST",
      headers: { "x-api-key": NOWPAYMENTS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        price_amount: amount,
        price_currency: "ngn",
        order_id: reference,
        order_description: "Sammy Store Logs — Wallet Funding",
        success_url: `${siteUrl}/wallet?funded=crypto`,
        cancel_url: `${siteUrl}/wallet`,
      }),
    });
  } catch {
    return err(res, 502, "Could not reach NOWPayments — please try again later");
  }

  if (!nowRes.ok) {
    const errText = await nowRes.text();
    return err(res, 502, `NOWPayments error: ${errText}`);
  }
  const invoice = (await nowRes.json()) as { invoice_url: string; id: string };
  return res.json({ invoiceUrl: invoice.invoice_url, invoiceId: invoice.id });
});

app.post("/api/payment/nowpayments-status", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");

  const { reference, userId } = req.body as { reference?: string; userId?: string };
  if (!reference || !userId) return err(res, 400, "reference and userId are required");
  if (userId !== user.id) return err(res, 403, "Forbidden");

  const { data: intent } = await supabaseAdmin!
    .from("payment_intents")
    .select("*")
    .eq("reference", reference)
    .eq("user_id", userId)
    .single();

  if (!intent) return err(res, 404, "Payment intent not found");
  if ((intent as Record<string, unknown>).status === "success") return res.json({ status: "success", alreadyCredited: true });

  if (!NOWPAYMENTS_API_KEY) return err(res, 500, "NOWPayments not configured");

  let nowRes: Response;
  try {
    nowRes = await fetch(
      `https://api.nowpayments.io/v1/payment?order_id=${encodeURIComponent(reference)}&limit=1`,
      { headers: { "x-api-key": NOWPAYMENTS_API_KEY } }
    );
  } catch {
    return err(res, 502, "Failed to check payment status — please try again");
  }

  if (!nowRes.ok) return err(res, 502, "Failed to check payment status");

  const json = (await nowRes.json()) as { data?: { payment_status?: string }[] };
  const paymentStatus = json.data?.[0]?.payment_status ?? "waiting";

  if (paymentStatus === "finished" || paymentStatus === "confirmed") {
    const { error: creditErr } = await supabaseAdmin!.rpc(
      "credit_wallet" as never,
      { _user_id: userId, _amount: Number((intent as Record<string, unknown>).amount), _provider: "nowpayments", _reference: reference, _description: "Wallet funded via NOWPayments (crypto)" } as never
    );
    if (!creditErr) {
      await supabaseAdmin!
        .from("payment_intents")
        .update({ status: "success", updated_at: new Date().toISOString() })
        .eq("reference", reference);
      return res.json({ status: "success", alreadyCredited: false });
    }
  }
  return res.json({ status: paymentStatus, alreadyCredited: false });
});

app.post("/api/payment/admin-credit", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");

  const { data: roles } = await supabaseAdmin!
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .limit(1);
  if (!roles?.length) return err(res, 403, "Forbidden: admin access required");

  const { targetUserId, amount, description } = req.body as { targetUserId?: string; amount?: number; description?: string };
  if (!targetUserId || !amount || !description) return err(res, 400, "targetUserId, amount and description are required");

  const ref = `admin-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  const { error: creditErr } = await supabaseAdmin!.rpc(
    "credit_wallet" as never,
    { _user_id: targetUserId, _amount: amount, _provider: "manual", _reference: ref, _description: description } as never
  );
  if (creditErr) return err(res, 500, (creditErr as { message: string }).message);

  await supabaseAdmin!.from("activity_logs").insert({
    actor_id: user.id,
    action: "admin_credit_wallet",
    target: targetUserId,
    metadata: { amount, description, ref },
  });

  return res.json({ success: true });
});

app.post("/api/delivery/assign-credential", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");

  const { orderId, productId } = req.body as { orderId?: string; productId?: string };
  if (!orderId || !productId) return err(res, 400, "orderId and productId are required");

  const { data: order } = await supabaseAdmin!
    .from("orders").select("id, user_id, status").eq("id", orderId).single();
  if (!order) return err(res, 404, "Order not found");
  if ((order as Record<string, unknown>).user_id !== user.id) return err(res, 403, "Forbidden");

  // Step 1: Already delivered? Return stored content directly (no credential lookup needed).
  const { data: existingItem } = await supabaseAdmin!
    .from("order_items").select("delivered_payload")
    .eq("order_id", orderId).eq("product_id", productId).limit(1).single();
  if (existingItem?.delivered_payload) {
    return res.json({ assigned: true, content: existingItem.delivered_payload, label: null });
  }

  // Step 2: purchase_with_wallet calls assign_credential_to_order which sets order_id on the
  // credential but does NOT update order_items.delivered_payload. Find that credential here.
  const { data: assignedCred } = await supabaseAdmin!
    .from("product_credentials").select("id, content, label")
    .eq("order_id", orderId).eq("product_id", productId).limit(1).single();

  let credId: string | null = null;
  let credContent: string | null = null;
  let credLabel: string | null = null;

  if (assignedCred) {
    credId      = (assignedCred as Record<string, unknown>).id as string;
    credContent = (assignedCred as Record<string, unknown>).content as string;
    credLabel   = (assignedCred as Record<string, unknown>).label as string | null;
  } else {
    // Step 3: Assign a new credential (product still has stock and none pre-assigned yet)
    const { data: newCredId, error: assignErr } = await supabaseAdmin!.rpc(
      "assign_credential_to_order" as never,
      { _order_id: orderId, _product_id: productId } as never
    );
    if (assignErr) return err(res, 500, (assignErr as { message: string }).message);
    if (!newCredId) return res.json({ assigned: false, content: null, label: null });

    const { data: c } = await supabaseAdmin!
      .from("product_credentials").select("content, label").eq("id", newCredId as string).single();
    credId      = newCredId as string;
    credContent = (c as Record<string, unknown> | null)?.content as string | null;
    credLabel   = (c as Record<string, unknown> | null)?.label as string | null;
  }

  if (!credContent) return res.json({ assigned: false, content: null, label: null });

  // Step 4: Store content string directly in delivered_payload (not the credential UUID)
  await supabaseAdmin!.from("order_items")
    .update({ delivered_payload: credContent })
    .eq("order_id", orderId).eq("product_id", productId);

  // Step 5: Delete credential — content is now safely stored in delivered_payload
  if (credId) await supabaseAdmin!.from("product_credentials").delete().eq("id", credId);

  return res.json({ assigned: true, content: credContent, label: credLabel });
});

// ─── Paystack webhook (automatic — Paystack calls this after payment) ─────────
// Configure in Paystack Dashboard → Settings → API Keys & Webhooks
// Webhook URL: https://yourdomain.com/api/payment/paystack-webhook
app.post("/api/payment/paystack-webhook", async (req, res) => {
  // Verify HMAC-SHA512 signature using the raw request bytes
  const secret = PAYSTACK_SECRET_KEY;
  if (secret) {
    const sig = (req.headers["x-paystack-signature"] || "") as string;
    if (!sig) return err(res, 400, "Missing signature");
    const crypto = await import("node:crypto");
    const raw = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body));
    const expected = crypto.createHmac("sha512", secret).update(raw).digest("hex");
    if (sig !== expected) return err(res, 401, "Invalid signature");
  }

  // Parse event (prefer parsed body)
  const event = req.body && typeof req.body === "object"
    ? req.body
    : JSON.parse(((req as any).rawBody ?? Buffer.from("{}")).toString("utf8"));

  // Only handle successful charges here
  if (event.event !== "charge.success") return res.json({ received: true });
  if (!requireSupabase(res)) return;

  const reference = event.data?.reference;
  const amountKobo = event.data?.amount ?? 0;
  const amount = amountKobo / 100;
  const userId = event.data?.metadata?.userId;

  if (!reference || !userId || amount <= 0) return res.json({ received: true });

  // Check intent exists and is pending
  const { data: intent } = await supabaseAdmin!
    .from("payment_intents")
    .select("id, status, user_id")
    .eq("reference", reference)
    .maybeSingle();

  if (!intent) return res.json({ received: true });
  if ((intent as Record<string, unknown>).status === "success") return res.json({ received: true });

  // Extra server-side verification with Paystack before crediting
  if (PAYSTACK_SECRET_KEY) {
    try {
      const verifyResp = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
      });
      if (!verifyResp.ok) {
        console.warn("[Webhook] Paystack verify returned non-OK for", reference);
        return res.json({ received: true });
      }
      const verifyJson = await verifyResp.json() as { status: boolean; data?: { status?: string; amount?: number; metadata?: any } };
      if (!verifyJson.status || verifyJson.data?.status !== "success") {
        console.warn("[Webhook] Paystack verify not successful for", reference, verifyJson);
        return res.json({ received: true });
      }
      const verifiedAmount = (verifyJson.data?.amount ?? 0) / 100;
      if (Math.abs(verifiedAmount - amount) > 0.01) {
        console.warn("[Webhook] Amount mismatch for", reference, { webhookAmount: amount, verifiedAmount });
        return res.json({ received: true });
      }
      if (verifyJson.data?.metadata?.userId && verifyJson.data.metadata.userId !== userId) {
        console.warn("[Webhook] Metadata userId mismatch", { reference, userId, metaUserId: verifyJson.data.metadata.userId });
        return res.json({ received: true });
      }
    } catch (e) {
      console.error("[Webhook] Error verifying with Paystack:", e);
      // Do not credit if we can't verify
      return res.json({ received: true });
    }
  }

  // Credit the wallet (idempotent because we checked intent.status)
  try {
    await supabaseAdmin!.rpc(
      "credit_wallet" as never,
      { _user_id: userId, _amount: amount, _provider: "paystack", _reference: reference, _description: "Wallet funded via Paystack" } as never
    );

    await supabaseAdmin!
      .from("payment_intents")
      .update({ status: "success", updated_at: new Date().toISOString() })
      .eq("reference", reference);

    console.log(`[Webhook] Paystack charge.success credited ₦${amount} to user ${userId}`);
  } catch (e) {
    console.error("[Webhook] Failed to credit wallet for", reference, e);
    // still respond 200 to Paystack to avoid retries; consider alerting or retrying via background job
  }

  return res.json({ received: true });
});

// ─── Admin re-dispense (no age check — admin-initiated) ────────────────────
app.post("/api/delivery/admin-redispense", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");

  const { data: roles } = await supabaseAdmin!
    .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").limit(1);
  if (!roles?.length) return err(res, 403, "Forbidden: admin access required");

  const { orderId, productId } = req.body as { orderId?: string; productId?: string };
  if (!orderId || !productId) return err(res, 400, "orderId and productId are required");

  // Already delivered? Return stored content.
  const { data: existingItem } = await supabaseAdmin!
    .from("order_items").select("delivered_payload")
    .eq("order_id", orderId).eq("product_id", productId).limit(1).single();
  if (existingItem?.delivered_payload) {
    return res.json({ assigned: true, content: existingItem.delivered_payload });
  }

  // Credential already assigned to this order by purchase_with_wallet?
  const { data: assignedCred } = await supabaseAdmin!
    .from("product_credentials").select("id, content")
    .eq("order_id", orderId).eq("product_id", productId).limit(1).single();

  let credId: string | null = null;
  let credContent: string | null = null;

  if (assignedCred) {
    credId      = (assignedCred as Record<string, unknown>).id as string;
    credContent = (assignedCred as Record<string, unknown>).content as string;
  } else {
    const { data: newCredId, error: assignErr } = await supabaseAdmin!.rpc(
      "assign_credential_to_order" as never,
      { _order_id: orderId, _product_id: productId } as never
    );
    if (assignErr) return err(res, 500, (assignErr as { message: string }).message);
    if (!newCredId) return res.json({ assigned: false, message: "No available credentials for this product" });

    const { data: c } = await supabaseAdmin!
      .from("product_credentials").select("content").eq("id", newCredId as string).single();
    credId      = newCredId as string;
    credContent = (c as Record<string, unknown> | null)?.content as string | null;
  }

  if (!credContent) return res.json({ assigned: false, message: "Credential content not found" });

  // Store content in delivered_payload
  await supabaseAdmin!.from("order_items")
    .update({ delivered_payload: credContent })
    .eq("order_id", orderId).eq("product_id", productId);

  // Delete credential
  if (credId) await supabaseAdmin!.from("product_credentials").delete().eq("id", credId);

  return res.json({ assigned: true, content: credContent });
});

// ─── Product management (admin-only, uses service role to bypass RLS) ────────
app.post("/api/products/upsert", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");
  const { data: roles } = await supabaseAdmin!.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").limit(1);
  if (!roles?.length) return err(res, 403, "Forbidden");
  const { id, ...payload } = req.body as { id?: string; [key: string]: unknown };
  const now = new Date().toISOString();
  if (id) {
    const { data, error } = await supabaseAdmin!.from("products").update({ ...payload, updated_at: now }).eq("id", id).select().single();
    if (error) return err(res, 400, error.message);
    return res.json({ product: data });
  }
  const { data, error } = await supabaseAdmin!.from("products").insert({ ...payload, created_at: now, updated_at: now }).select().single();
  if (error) return err(res, 400, error.message);
  return res.json({ product: data });
});

app.delete("/api/products/:id", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");
  const { data: roles } = await supabaseAdmin!.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").limit(1);
  if (!roles?.length) return err(res, 403, "Forbidden");
  const { error } = await supabaseAdmin!.from("products").delete().eq("id", req.params.id);
  if (error) return err(res, 400, error.message);
  return res.json({ success: true });
});

app.post("/api/categories/upsert", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");
  const { data: roles } = await supabaseAdmin!.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").limit(1);
  if (!roles?.length) return err(res, 403, "Forbidden");
  const { id, ...payload } = req.body as { id?: string; [key: string]: unknown };
  if (id) {
    const { data, error } = await supabaseAdmin!.from("product_categories").update(payload).eq("id", id).select().single();
    if (error) return err(res, 400, error.message);
    return res.json({ category: data });
  }
  const { data, error } = await supabaseAdmin!.from("product_categories").insert(payload).select().single();
  if (error) return err(res, 400, error.message);
  return res.json({ category: data });
});

app.delete("/api/categories/:id", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");
  const { data: roles } = await supabaseAdmin!.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").limit(1);
  if (!roles?.length) return err(res, 403, "Forbidden");
  const { error } = await supabaseAdmin!.from("product_categories").delete().eq("id", req.params.id);
  if (error) return err(res, 400, error.message);
  return res.json({ success: true });
});

app.post("/api/wallet/ensure", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");

  const { data: existing } = await supabaseAdmin!
    .from("wallets")
    .select("id, balance, currency, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) return res.json({ wallet: existing });

  const { data: created, error: createErr } = await supabaseAdmin!
    .from("wallets")
    .insert({ user_id: user.id, balance: 0, currency: "NGN" })
    .select("id, balance, currency, updated_at")
    .single();

  if (createErr) return err(res, 500, createErr.message);
  return res.json({ wallet: created });
});

// ─── Static file serving ──────────────────────────────────────────────────
// Always serve /uploads so product images work in dev & prod
app.use("/uploads", express.static(uploadsDir));

if (IS_PROD) {
  const distPath = path.resolve(__dirname, "../dist");
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
  console.log(`[API] Serving static files from ${distPath}`);
}

// ─── Start ──────────────────────────────────────────────────────────��[...]
const PORT = parseInt(process.env.PORT ?? process.env.API_PORT ?? (IS_PROD ? "5000" : "3001"), 10);
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`[API] Server running on port ${PORT} (${IS_PROD ? "production" : "development"})`);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) console.warn("[API] ⚠️  Supabase not configured — add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Replit Secrets");
  if (!PAYSTACK_SECRET_KEY)  console.warn("[API] ⚠️  PAYSTACK_SECRET_KEY not set");
  if (!NOWPAYMENTS_API_KEY)  console.warn("[API] ⚠️  NOWPAYMENTS_API_KEY not set");
  if (ADMIN_EMAIL) {
    await seedAdmin();
  } else {
    console.log("[API] ℹ️  ADMIN_EMAIL not set — skipping admin seed. Add it to Replit Secrets to auto-grant admin.");
  }
});
