import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
};

async function validSignature(req: Request, dataId: string, secret: string) {
  const signature = req.headers.get("x-signature") ?? "";
  const requestId = req.headers.get("x-request-id") ?? "";
  const parts = Object.fromEntries(signature.split(",").map((part) => part.trim().split("=")).filter((x) => x.length === 2));
  const ts = parts.ts ?? "";
  const received = parts.v1 ?? "";
  if (!ts || !received || !requestId || !/^\d+$/.test(dataId)) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)));
  return safeEqual(digest.toLowerCase(), received.toLowerCase());
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response({ ok: false }, 405);
  try {
    const secret = Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET") ?? "";
    const token = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!secret || !token || !supabaseUrl || !serviceKey) return response({ error: "Webhook no configurado" }, 503);

    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const dataId = String(url.searchParams.get("data.id") ?? body?.data?.id ?? "").toLowerCase();
    const type = String(url.searchParams.get("type") ?? body?.type ?? "");
    if (type !== "payment") return response({ ok: true, ignored: true });
    if (!(await validSignature(req, dataId, secret))) return response({ error: "Firma inválida" }, 401);

    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!mpResponse.ok) return response({ error: "Pago no disponible" }, 409);
    const mp = await mpResponse.json();
    const externalReference = String(mp.external_reference ?? "");
    if (!externalReference.startsWith("clickonme-")) return response({ ok: true, ignored: true });

    const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" };
    const findResponse = await fetch(`${supabaseUrl}/rest/v1/payments?external_reference=eq.${encodeURIComponent(externalReference)}&select=id,profile_id,user_id,amount_mxn,status`, { headers });
    const rows = await findResponse.json();
    const payment = rows?.[0];
    if (!findResponse.ok || !payment) return response({ error: "Orden desconocida" }, 404);
    if (Number(mp.transaction_amount) !== Number(payment.amount_mxn) || String(mp.currency_id) !== "MXN") return response({ error: "Importe inválido" }, 409);

    const allowed = new Set(["pending", "approved", "rejected", "cancelled", "refunded"]);
    const nextStatus = allowed.has(String(mp.status)) ? String(mp.status) : "pending";
    const rpc = await fetch(`${supabaseUrl}/rest/v1/rpc/apply_verified_payment_gateway`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_payment_id: payment.id,
        p_provider_payment_id: dataId,
        p_status: nextStatus,
        p_provider_payload: {
          payment_id: dataId,
          status: mp.status,
          status_detail: mp.status_detail,
          payment_type_id: mp.payment_type_id,
          date_approved: mp.date_approved,
        },
      }),
    });
    if (!rpc.ok) throw new Error(await rpc.text());
    return response({ ok: true });
  } catch (error) {
    console.error("Webhook error", error);
    return response({ error: "Error interno" }, 500);
  }
});
