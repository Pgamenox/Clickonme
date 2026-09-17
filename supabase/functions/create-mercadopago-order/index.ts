import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const origins = new Set(["https://clickonme.pro", "https://www.clickonme.pro"]);
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": origins.has(req.headers.get("origin") ?? "") ? req.headers.get("origin")! : "https://clickonme.pro",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors(req), "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Método no permitido" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const mpToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";
    const environment = Deno.env.get("MERCADO_PAGO_ENVIRONMENT") === "production" ? "production" : "test";
    if (!supabaseUrl || !anonKey || !serviceKey || !mpToken) return json(req, { error: "Configuración de pagos incompleta" }, 503);

    const auth = req.headers.get("Authorization") ?? "";
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { Authorization: auth, apikey: anonKey } });
    if (!userResponse.ok) return json(req, { error: "Tu sesión venció. Vuelve a iniciar sesión." }, 401);
    const user = await userResponse.json();
    const body = await req.json().catch(() => ({}));
    const profileId = Number(body.profileId);
    if (!Number.isInteger(profileId)) return json(req, { error: "Primero guarda una tarjeta válida" }, 400);

    const adminHeaders = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" };
    const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${profileId}&user_id=eq.${user.id}&select=id,slug,name`, { headers: adminHeaders });
    const profiles = await profileResponse.json();
    if (!profileResponse.ok || !profiles?.[0]) return json(req, { error: "Esta tarjeta no pertenece a tu cuenta" }, 403);
    const profile = profiles[0];
    const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/business_settings?id=eq.main&select=annual_price_mxn`, { headers: adminHeaders });
    const settings = await settingsResponse.json();
    const amount = Number(settings?.[0]?.annual_price_mxn ?? 599);
    if (!Number.isInteger(amount) || amount < 1) return json(req, { error: "Precio anual inválido" }, 500);

    const attemptId = crypto.randomUUID();
    const externalReference = `clickonme-${profile.id}-${attemptId}`;
    const preferenceResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${mpToken}`, "Content-Type": "application/json", "X-Idempotency-Key": attemptId },
      body: JSON.stringify({
        items: [{ id: "clickonme-pro-anual", title: "Plan Pro anual ClickOnMe", currency_id: "MXN", quantity: 1, unit_price: amount }],
        payer: { email: String(user.email ?? "") },
        external_reference: externalReference,
        notification_url: `${supabaseUrl}/functions/v1/mercadopago-webhook?source_news=webhooks`,
        back_urls: {
          success: `https://clickonme.pro/crear/?id=${profile.id}&payment=success`,
          pending: `https://clickonme.pro/crear/?id=${profile.id}&payment=pending`,
          failure: `https://clickonme.pro/crear/?id=${profile.id}&payment=failure`,
        },
        auto_return: "approved",
      }),
    });
    const preference = await preferenceResponse.json().catch(() => ({}));
    const checkoutUrl = environment === "production" ? preference.init_point : preference.sandbox_init_point;
    if (!preferenceResponse.ok || !preference.id || !checkoutUrl) {
      console.error("Mercado Pago preference error", preferenceResponse.status, preference);
      return json(req, { error: "Mercado Pago rechazó la orden" }, 502);
    }

    const saveResponse = await fetch(`${supabaseUrl}/rest/v1/payments`, {
      method: "POST", headers: { ...adminHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: user.id, profile_id: profile.id, provider_order_id: String(preference.id), external_reference: externalReference, amount_mxn: amount, status: "created", environment, checkout_url: String(checkoutUrl), provider_payload: { api: "preferences", collector_id: preference.collector_id } }),
    });
    if (!saveResponse.ok) throw new Error(await saveResponse.text());
    return json(req, { checkoutUrl, orderId: String(preference.id), amount, environment });
  } catch (error) {
    console.error("Checkout error", error);
    return json(req, { error: "No se pudo preparar el pago" }, 500);
  }
});
