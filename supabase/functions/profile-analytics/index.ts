import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const allowed=new Set(["profile_view","audio_play","gallery_nav","video_open","whatsapp_click","phone_click","facebook_click","instagram_click","youtube_click","website_click","custom_click","share_click","copy_click","qr_open","presskit_email","presskit_whatsapp","presskit_pdf"]);
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return new Response("Method not allowed",{status:405,headers:cors});
 try{
  const body=await req.json(),slug=String(body.slug||"").toLowerCase().replace(/[^a-z0-9-]/g,"").slice(0,80),type=String(body.type||"").slice(0,40),label=String(body.label||"").slice(0,120);
  if(!slug||!allowed.has(type))return new Response("Invalid event",{status:400,headers:cors});
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:p}=await sb.from("profiles").select("slug,status").eq("slug",slug).maybeSingle();
  if(!p)return new Response("Not found",{status:404,headers:cors});
  const sid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.session_id||""))?body.session_id:null;
  const {error}=await sb.from("profile_analytics_events").insert({profile_slug:slug,event_type:type,event_label:label||null,session_id:sid});
  if(error)throw error;
  return new Response(null,{status:204,headers:{...cors,"Cache-Control":"no-store"}});
 }catch{return new Response("Bad request",{status:400,headers:cors});}
});