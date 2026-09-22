import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const allowedOrigins=new Set(["https://clickonme.pro","https://www.clickonme.pro"]);
const allowed=new Set(["profile_view","audio_play","gallery_nav","video_open","whatsapp_click","phone_click","facebook_click","instagram_click","youtube_click","website_click","custom_click","share_click","copy_click","qr_open","presskit_email","presskit_whatsapp","presskit_pdf"]);

function corsFor(req:Request){
 const origin=req.headers.get("origin")||"";
 return {
  "Access-Control-Allow-Origin":allowedOrigins.has(origin)?origin:"https://clickonme.pro",
  "Vary":"Origin",
  "Access-Control-Allow-Headers":"content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
 };
}

Deno.serve(async(req)=>{
 const cors=corsFor(req);
 const origin=req.headers.get("origin")||"";
 if(origin && !allowedOrigins.has(origin))return new Response("Forbidden",{status:403,headers:cors});
 if(!origin)return new Response("Forbidden",{status:403,headers:cors});
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return new Response("Method not allowed",{status:405,headers:cors});
 try{
  const body=await req.json();
  const slug=String(body.slug||"").toLowerCase().replace(/[^a-z0-9-]/g,"").slice(0,80);
  const type=String(body.type||"").slice(0,40);
  const label=String(body.label||"").slice(0,120);
  if(!slug||!allowed.has(type))return new Response("Invalid event",{status:400,headers:cors});

  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:p}=await sb.from("profiles")
    .select("slug,status,trial_ends_at,current_period_end")
    .eq("slug",slug)
    .maybeSingle();

  if(!p)return new Response("Not found",{status:404,headers:cors});
  const now=Date.now();
  const available=
    (p.status==="active"&&(!p.current_period_end||new Date(p.current_period_end).getTime()>now))||
    (p.status==="trial"&&p.trial_ends_at&&new Date(p.trial_ends_at).getTime()>now);
  if(!available)return new Response("Profile unavailable",{status:410,headers:cors});

  const sid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.session_id||""))?body.session_id:null;
  const {error}=await sb.from("profile_analytics_events").insert({profile_slug:slug,event_type:type,event_label:label||null,session_id:sid});
  if(error)throw error;
  return new Response(null,{status:204,headers:{...cors,"Cache-Control":"no-store"}});
 }catch{
  return new Response("Bad request",{status:400,headers:cors});
 }
});