import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigins = new Set(["https://clickonme.pro", "https://www.clickonme.pro"]);
function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://clickonme.pro",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors(req), "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Método no permitido" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const mpToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";
    const authorization = req.headers.get("Authorization") ?? "";
    if (!supabaseUrl || !anonKey || !serviceKey || !mpToken) return json(req, { error: "Configuración incompleta" }, 500);

    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: anonKey },
    });
    if (!userResponse.ok) return json(req, { error: "Tu sesión venció. Vuelve a iniciar sesión." }, 401);
    const user = await userResponse.json();

    const body = await req.json().catch(() => ({}));
    const paymentId = String(body.paymentId ?? "").trim();
    const profileId = Number(body.profileId);
    if (!/^\d+$/.test(paymentId) || !Number.isInteger(profileId)) return json(req, { error: "Referencia de pago inválida" }, 400);

    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${mpToken}` },
    });
    if (!mpResponse.ok) return json(req, { error: "Mercado Pago aún no confirma este pago" }, 409);
    const mp = await mpResponse.json();
    const externalReference = String(mp.external_reference ?? "");

    const adminHeaders = {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    };
    const rowResponse = await fetch(
      `${supabaseUrl}/rest/v1/payments?external_reference=eq.${encodeURIComponent(externalReference)}&user_id=eq.${user.id}&profile_id=eq.${profileId}&select=id,profile_id,amount_mxn,status`,
      { headers: adminHeaders },
    );
    const rows = await rowResponse.json();
    const payment = rows?.[0];
    if (!rowResponse.ok || !payment) return json(req, { error: "El pago no corresponde a tu cuenta" }, 403);

    const amount = Number(mp.transaction_amount ?? 0);
    if (amount !== Number(payment.amount_mxn) || String(mp.currency_id ?? "") !== "MXN") {
      return json(req, { error: "El importe del pago no coincide" }, 409);
    }

    const allowed = new Set(["pending", "approved", "rejected", "cancelled", "refunded"]);
    const nextStatus = allowed.has(String(mp.status)) ? String(mp.status) : "pending";
    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/apply_verified_payment_gateway`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        p_payment_id: payment.id,
        p_provider_payment_id: paymentId,
        p_status: nextStatus,
        p_provider_payload: {
          payment_id: paymentId,
          status: mp.status,
          status_detail: mp.status_detail,
          payment_type_id: mp.payment_type_id,
          date_approved: mp.date_approved,
        },
      }),
    });
    if (!rpcResponse.ok) throw new Error(await rpcResponse.text());
    const applied = await rpcResponse.json();
    const result = Array.isArray(applied) ? applied[0] : applied;
    if (!result || !allowed.has(String(result.status))) throw new Error("Invalid payment application response");
    const periodEnd = result.current_period_end ?? null;
    return json(req, { status: result.status, active: result.status === "approved", currentPeriodEnd: periodEnd });
  } catch (error) {
    console.error("Payment confirmation error", error);
    return json(req, { error: "No se pudo confirmar el pago" }, 500);
  }
});
