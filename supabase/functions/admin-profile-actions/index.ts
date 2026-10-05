import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const allowedOrigins=new Set(["https://clickonme.pro","https://www.clickonme.pro"]);
const allowedActions=new Set(["health","authorize_plan","set_suspension","delete_profile","assign_owner","set_nfc","update_unowned_profile"]);

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
  const ownerEmail=body?.owner_email==null?null:String(body.owner_email).trim().toLowerCase();
  const nfcStatus=body?.nfc_status==null?null:String(body.nfc_status).trim().toLowerCase();
  const nfcCardId=body?.nfc_card_id==null?null:String(body.nfc_card_id).trim();

  if(action==="authorize_plan"&&!["personal","business","artist","creator"].includes(String(plan||""))){
    return json(req,{error:"Plan inválido"},400);
  }
  if(action==="delete_profile"&&(!confirmSlug||confirmSlug.length>120)){
    return json(req,{error:"Confirmación inválida"},400);
  }
  if(action==="set_suspension"&&suspended===null){
    return json(req,{error:"Estado de suspensión requerido"},400);
  }
  if(action==="assign_owner"&&(!ownerEmail||ownerEmail.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail))){
    return json(req,{error:"Correo del cliente inválido"},400);
  }

  if(action==="set_nfc"&&!["sin_tarjeta","solicitada","programada","entregada"].includes(String(nfcStatus||""))){
    return json(req,{error:"Estado NFC inválido"},400);
  }
  if(action==="set_nfc"&&nfcCardId&&nfcCardId.length>120){
    return json(req,{error:"ID NFC demasiado largo"},400);
  }

  if(action==="set_nfc"){
    const {data,error}=await adminClient
      .from("profiles")
      .update({
        nfc_status:nfcStatus,
        nfc_card_id:nfcCardId||null,
        updated_at:new Date().toISOString(),
      })
      .eq("id",profileId)
      .neq("account_role","team")
      .eq("demo_profile",false)
      .select("id,nfc_status,nfc_card_id")
      .maybeSingle();
    if(error){
      console.error("set nfc profile error",error.code,error.message);
      return json(req,{error:"No se pudo guardar el estado NFC"},500);
    }
    if(!data)return json(req,{error:"Perfil no encontrado o no elegible para NFC"},404);
    return json(req,data);
  }

  if(action==="update_unowned_profile"){
    const p=body?.profile;
    if(!p||typeof p!=="object"||Array.isArray(p)){
      return json(req,{error:"Datos de perfil inválidos"},400);
    }
    const slug=String(p.slug||"").trim().toLowerCase();
    const name=String(p.name||"").trim();
    const role=String(p.role||"").trim();
    if(!/^[a-z0-9-]{3,40}$/.test(slug)||!name||!role){
      return json(req,{error:"Nombre, actividad o dirección inválidos"},400);
    }
    if(!p.data||typeof p.data!=="object"||Array.isArray(p.data)){
      return json(req,{error:"Contenido de perfil inválido"},400);
    }
    const updatePayload={
      slug,
      name,
      role,
      description:String(p.description||""),
      photo_url:String(p.photo_url||""),
      whatsapp:String(p.whatsapp||""),
      phone:String(p.phone||""),
      facebook:String(p.facebook||""),
      instagram:String(p.instagram||""),
      youtube:String(p.youtube||""),
      website:String(p.website||""),
      data:p.data,
      updated_at:new Date().toISOString(),
    };
    const {data,error}=await adminClient
      .from("profiles")
      .update(updatePayload)
      .eq("id",profileId)
      .is("user_id",null)
      .neq("account_role","team")
      .eq("demo_profile",false)
      .select("id,slug,data,whatsapp,phone,facebook,instagram,youtube,website,updated_at")
      .maybeSingle();
    if(error){
      console.error("update unowned profile error",error.code,error.message);
      if(error.code==="23505")return json(req,{error:"Esa dirección ya está ocupada"},409);
      return json(req,{error:"No se pudo guardar la tarjeta sin propietario"},500);
    }
    if(!data)return json(req,{error:"Perfil no encontrado, ya entregado o no elegible"},404);
    return json(req,data);
  }

  if(action==="assign_owner"){
    const {data,error}=await adminClient.rpc("admin_assign_profile_owner_server",{
      p_admin_user_id:user.id,
      p_profile_id:profileId,
      p_owner_email:ownerEmail,
    });
    if(error){
      const msg=String(error.message||"No se pudo entregar la tarjeta");
      if(/admin required/i.test(msg))return json(req,{error:"Permisos de administrador requeridos"},403);
      if(/profile not found/i.test(msg))return json(req,{error:"Perfil no encontrado"},404);
      if(/internal profiles/i.test(msg))return json(req,{error:"Este perfil interno no puede asignarse"},409);
      if(/profile already assigned/i.test(msg))return json(req,{error:"Esta tarjeta ya fue entregada a una cuenta"},409);
      if(/confirmed owner account not found/i.test(msg))return json(req,{error:"El cliente debe registrarse y confirmar ese correo antes de recibir la tarjeta"},404);
      if(/owner already has profile/i.test(msg))return json(req,{error:"Esa cuenta ya tiene una tarjeta ClickOnMe"},409);
      if(/invalid owner email/i.test(msg))return json(req,{error:"Correo del cliente inválido"},400);
      console.error("admin assign owner rpc error",error.code,error.message);
      return json(req,{error:"No se pudo entregar la tarjeta"},500);
    }
    return json(req,data??{ok:true});
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
