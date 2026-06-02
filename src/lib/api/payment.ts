import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Paystack: verify payment + credit wallet ─────────────────────────────────
export const verifyPaystackPayment = createServerFn({ method: "POST" })
  .inputValidator(z.object({ reference: z.string().min(1), userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { data: intent, error: intentErr } = await supabaseAdmin
      .from("payment_intents")
      .select("*")
      .eq("reference", data.reference)
      .eq("user_id", data.userId)
      .eq("provider", "paystack")
      .single();

    if (intentErr || !intent) throw new Error("Invalid or expired payment reference");
    if (intent.status === "success") return { success: true, amount: Number(intent.amount), alreadyCredited: true };

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) throw new Error("Paystack is not configured — contact support");

    const res = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(data.reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    if (!res.ok) throw new Error("Could not reach Paystack — please try again");

    const json = (await res.json()) as { status: boolean; data?: { status: string; amount: number } };
    if (!json.status || json.data?.status !== "success") {
      throw new Error("Payment not confirmed — contact support if you were charged");
    }

    const amount = (json.data?.amount ?? 0) / 100;

    const { error: creditErr } = await supabaseAdmin.rpc(
      "credit_wallet" as never,
      { _user_id: data.userId, _amount: amount, _provider: "paystack", _reference: data.reference, _description: "Wallet funded via Paystack" } as never
    );
    if (creditErr) throw new Error(creditErr.message);

    await supabaseAdmin
      .from("payment_intents")
      .update({ status: "success", updated_at: new Date().toISOString() })
      .eq("reference", data.reference);

    return { success: true, amount, alreadyCredited: false };
  });

// ── NOWPayments: create crypto invoice ──────────────────────────────────────
export const createNowPaymentsInvoice = createServerFn({ method: "POST" })
  .inputValidator(z.object({ amount: z.number().positive().max(100_000_000), userId: z.string().uuid(), reference: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { data: intent, error: intentErr } = await supabaseAdmin
      .from("payment_intents")
      .select("id")
      .eq("reference", data.reference)
      .eq("user_id", data.userId)
      .eq("provider", "nowpayments")
      .single();

    if (intentErr || !intent) throw new Error("Invalid payment reference");

    const apiKey = process.env.NOWPAYMENTS_API_KEY;
    if (!apiKey) throw new Error("NOWPayments is not configured — contact support");

    const siteUrl =
      process.env.VITE_SITE_URL ??
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://your-app.replit.app");

    const res = await fetch("https://api.nowpayments.io/v1/invoice", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        price_amount: data.amount,
        price_currency: "ngn",
        order_id: data.reference,
        order_description: "Sammy Store Logs — Wallet Funding",
        success_url: `${siteUrl}/wallet?funded=crypto`,
        cancel_url: `${siteUrl}/wallet`,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`NOWPayments error: ${errText}`);
    }
    const invoice = (await res.json()) as { invoice_url: string; id: string };
    return { invoiceUrl: invoice.invoice_url, invoiceId: invoice.id };
  });

// ── NOWPayments: poll + finalise payment ────────────────────────────────────
export const checkNowPaymentsStatus = createServerFn({ method: "POST" })
  .inputValidator(z.object({ reference: z.string().min(1), userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { data: intent } = await supabaseAdmin
      .from("payment_intents")
      .select("*")
      .eq("reference", data.reference)
      .eq("user_id", data.userId)
      .single();

    if (!intent) throw new Error("Payment intent not found");
    if (intent.status === "success") return { status: "success", alreadyCredited: true };

    const apiKey = process.env.NOWPAYMENTS_API_KEY;
    if (!apiKey) throw new Error("NOWPayments not configured");

    const res = await fetch(
      `https://api.nowpayments.io/v1/payment?order_id=${encodeURIComponent(data.reference)}&limit=1`,
      { headers: { "x-api-key": apiKey } }
    );
    if (!res.ok) throw new Error("Failed to check payment status");

    const json = (await res.json()) as { data?: { payment_status?: string }[] };
    const paymentStatus = json.data?.[0]?.payment_status ?? "waiting";

    if (paymentStatus === "finished" || paymentStatus === "confirmed") {
      const { error: creditErr } = await supabaseAdmin.rpc(
        "credit_wallet" as never,
        { _user_id: data.userId, _amount: Number(intent.amount), _provider: "nowpayments", _reference: data.reference, _description: "Wallet funded via NOWPayments (crypto)" } as never
      );
      if (!creditErr) {
        await supabaseAdmin
          .from("payment_intents")
          .update({ status: "success", updated_at: new Date().toISOString() })
          .eq("reference", data.reference);
        return { status: "success", alreadyCredited: false };
      }
    }
    return { status: paymentStatus, alreadyCredited: false };
  });

// ── Admin: manually credit a user wallet ────────────────────────────────────
export const adminCreditWalletFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    targetUserId: z.string().uuid(),
    amount: z.number().positive(),
    description: z.string().min(1).max(255),
    adminToken: z.string().min(1),
  }))
  .handler(async ({ data }) => {
    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(data.adminToken);
    if (authErr || !authData.user) throw new Error("Unauthorized");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", authData.user.id)
      .eq("role", "admin")
      .limit(1);
    if (!roles?.length) throw new Error("Forbidden: admin access required");

    const ref = `admin-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    const { error: creditErr } = await supabaseAdmin.rpc(
      "credit_wallet" as never,
      { _user_id: data.targetUserId, _amount: data.amount, _provider: "manual", _reference: ref, _description: data.description } as never
    );
    if (creditErr) throw new Error(creditErr.message);

    await supabaseAdmin.from("activity_logs").insert({
      actor_id: authData.user.id,
      action: "admin_credit_wallet",
      target: data.targetUserId,
      metadata: { amount: data.amount, description: data.description, ref },
    });

    return { success: true };
  });
