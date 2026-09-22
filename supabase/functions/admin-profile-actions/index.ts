import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const allowedOrigins=new Set(["https://clickonme.pro","https://www.clickonme.pro"]);
const allowedActions=new Set(["health","authorize_plan","set_suspension","delete_profile"]);

function corsFor(req:Request){
  const origin=req.headers.get("origin")||"";
  return {
    "Access-Control-Allow-Origin":allowedOrigins.has(origin)?origin:"https://clickonme.pro",
    "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Vary":"Origin",
    "Cache-Control":"no-store",
  };
}

function json(req:Request,body:unknown,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{...corsFor(req),"Content-Type":"application/json"},
  });
}

Deno.serve(async(req)=>{
  const origin=req.headers.get("origin")||"";
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsFor(req)});
  if(origin&&!allowedOrigins.has(origin))return json(req,{error:"Origen no permitido"},403);
  if(req.method!=="POST")return json(req,{error:"Método no permitido"},405);

  const authHeader=req.headers.get("Authorization")||"";
  if(!authHeader.startsWith("Bearer "))return json(req,{error:"No autorizado"},401);
  const token=authHeader.slice(7).trim();
  if(!token)return json(req,{error:"No autorizado"},401);

  const supabaseUrl=Deno.env.get("SUPABASE_URL")||"";
  const anonKey=Deno.env.get("SUPABASE_ANON_KEY")||"";
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!supabaseUrl||!anonKey||!serviceKey)return json(req,{error:"Configuración incompleta"},503);

  const userClient=createClient(supabaseUrl,anonKey,{
    global:{headers:{Authorization:authHeader}},
    auth:{persistSession:false,autoRefreshToken:false},
  });
  const {data:userData,error:userError}=await userClient.auth.getUser(token);
  const user=userData?.user;
  if(userError||!user)return json(req,{error:"Sesión inválida"},401);

  const adminClient=createClient(supabaseUrl,serviceKey,{
    auth:{persistSession:false,autoRefreshToken:false},
  });

  const {data:adminRow,error:adminError}=await adminClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id",user.id)
    .maybeSingle();

  if(adminError)return json(req,{error:"No se pudo verificar el administrador"},500);
  if(!adminRow)return json(req,{error:"Permisos de administrador requeridos"},403);

  let body:any={};
  try{ body=await req.json(); }
  catch{ return json(req,{error:"Solicitud inválida"},400); }

  const action=String(body?.action||"").trim().toLowerCase();
  if(!allowedActions.has(action))return json(req,{error:"Acción inválida"},400);

  if(action==="health"){
    return json(req,{ok:true,admin:true,user_id:user.id});
  }

  const profileId=Number(body?.profile_id);
  if(!Number.isSafeInteger(profileId)||profileId<1){
    return json(req,{error:"Perfil inválido"},400);
  }

  const plan=body?.plan==null?null:String(body.plan).trim().toLowerCase();
  const confirmSlug=body?.confirm_slug==null?null:String(body.confirm_slug).trim().toLowerCase();
  const suspended=typeof body?.suspended==="boolean"?body.suspended:null;

  if(action==="authorize_plan"&&!["personal","business","artist","creator"].includes(String(plan||""))){
    return json(req,{error:"Plan inválido"},400);
  }
  if(action==="delete_profile"&&(!confirmSlug||confirmSlug.length>120)){
    return json(req,{error:"Confirmación inválida"},400);
  }
  if(action==="set_suspension"&&suspended===null){
    return json(req,{error:"Estado de suspensión requerido"},400);
  }

  const {data,error}=await adminClient.rpc("admin_profile_action_server",{
    p_admin_user_id:user.id,
    p_action:action,
    p_profile_id:profileId,
    p_plan:plan,
    p_confirm_slug:confirmSlug,
    p_suspended:suspended,
  });

  if(error){
    const msg=String(error.message||"No se pudo completar la operación");
    if(/admin required/i.test(msg))return json(req,{error:"Permisos de administrador requeridos"},403);
    if(/profile not found/i.test(msg))return json(req,{error:"Perfil no encontrado"},404);
    if(/internal profiles/i.test(msg))return json(req,{error:"Este perfil interno no puede modificarse aquí"},409);
    if(/confirmation slug mismatch/i.test(msg))return json(req,{error:"La confirmación no coincide"},409);
    if(/invalid plan|invalid action|suspension flag/i.test(msg))return json(req,{error:"Datos de operación inválidos"},400);
    console.error("admin-profile-actions rpc error",error.code,error.message);
    return json(req,{error:"No se pudo completar la operación"},500);
  }

  return json(req,data??{ok:true});
});
