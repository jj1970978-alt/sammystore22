import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";

export async function assignCredentialToOrder(data: { orderId: string; productId: string }) {
  let token: string | null = null;
  if (isSupabaseConfigured()) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      token = sessionData.session?.access_token ?? null;
    } catch {
      token = null;
    }
  }

  const res = await fetch("/api/delivery/assign-credential", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({ error: "Delivery failed" }));
    throw new Error((json as { error?: string }).error ?? "Delivery failed");
  }
  return res.json() as Promise<{ assigned: boolean; content: string | null; label: string | null }>;
}
