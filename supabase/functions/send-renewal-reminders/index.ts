import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const day = 86_400_000;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const cronSecret = Deno.env.get("REMINDER_CRON_SECRET") ?? "";
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) return json({ error: "No autorizado" }, 401);
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!resendKey || !supabaseUrl || !serviceKey) return json({ error: "Recordatorios no configurados" }, 503);
  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" };
  const profilesResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?status=in.(trial,active)&select=id,user_id,name,slug,status,trial_ends_at,current_period_end`, { headers });
  const profiles = await profilesResponse.json();
  if (!profilesResponse.ok) return json({ error: "No se pudieron consultar las tarjetas" }, 500);

  let sent = 0;
  for (const profile of profiles) {
    const endValue = profile.status === "active" ? profile.current_period_end : profile.trial_ends_at;
    if (!endValue) continue;
    const days = Math.ceil((new Date(endValue).getTime() - Date.now()) / day);
    if (![7, 3, 0].includes(days)) continue;
    const kind = `expiry_${days}d`;
    const existingResponse = await fetch(`${supabaseUrl}/rest/v1/notification_log?profile_id=eq.${profile.id}&kind=eq.${kind}&period_end=eq.${encodeURIComponent(endValue)}&select=id`, { headers });
    const existing = await existingResponse.json();
    if (existing?.length) continue;
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${profile.user_id}`, { headers });
    if (!userResponse.ok) continue;
    const user = await userResponse.json();
    if (!user.email) continue;
    const urgent = days <= 3;
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "ClickOnMe <avisos@clickonme.pro>", to: [user.email],
        subject: days === 0 ? "Tu tarjeta ClickOnMe vence hoy" : `Tu tarjeta ClickOnMe vence en ${days} días`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h1 style="color:#6d28d9">${urgent ? "Es momento de renovar" : "Aviso de renovación"}</h1><p>Hola ${String(profile.name).replace(/[<>&\"]/g, "")},</p><p>Tu tarjeta <strong>${String(profile.slug)}</strong> ${days === 0 ? "vence hoy" : `vence en ${days} días`}.</p><p>Renueva tu Plan Pro para mantenerla publicada.</p><p><a href="https://clickonme.pro/crear/?id=${profile.id}" style="background:#6d28d9;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Revisar mi plan</a></p><p>Si ya renovaste, puedes ignorar este mensaje.</p></div>`,
      }),
    });
    if (!emailResponse.ok) { console.error("Resend error", await emailResponse.text()); continue; }
    const email = await emailResponse.json();
    await fetch(`${supabaseUrl}/rest/v1/notification_log`, { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ profile_id: profile.id, user_id: profile.user_id, kind, period_end: endValue, provider_message_id: email.id }) });
    sent++;
  }
  return json({ ok: true, sent });
});
