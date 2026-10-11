// ============================================================
// NOVA AI — Edge Function: admin-regenerate-api-key
// Regenera la API key de un usuario. Requiere rol admin.
// ============================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.0";
import crypto from "https://deno.land/std@0.224.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function hashKey(key: string): { hash: string; prefix: string } {
  const hash = crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const bytes = new Uint8Array(hash);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return {
    hash: "sha256$" + hex,
    prefix: key.substring(0, 12) + "_",
  };
}

async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_ANON_KEY") || ""
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Token inválido" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || profile?.role !== "admin") {
    return new Response(JSON.stringify({ error: "Solo admin" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json();
  const { user_id, revoke_existing = true } = body;

  // 1. Revocar la key anterior si se solicita
  if (revoke_existing) {
    await supabase
      .from("api_keys")
      .update({ revoked: true, revoked_at: new Date().toISOString() })
      .eq("user_id", user_id);
  }

  // 2. Generar nueva key
  const newKey = crypto.randomUUID().replace(/-/g, "").substring(0, 32);
  const { hash, prefix } = hashKey("nova_live_" + newKey);

  // 3. Guardar la nueva key hasheada
  const { error: insertError } = await supabase
    .from("api_keys")
    .insert([{
      user_id,
      api_key_hash: hash,
      prefix,
      revoked: false,
      revoked_at: null,
      created_at: new Date().toISOString(),
    }]);

  if (insertError) {
    return new Response(JSON.stringify({ error: "No se pudo generar la clave" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 4. Registrar en audit_log
  await supabase.from("audit_log").insert([{
    user_id: user.id,
    action: "admin_regenerate_api_key",
    details: { target: user_id },
  }]);

  // 5. Devolver la clave completa (solo una vez)
  return new Response(JSON.stringify({
    success: true,
    message: "Clave generada. ¡Esta es la única vez que se muestra!",
    api_key: "nova_live_" + newKey,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

if (Deno.env.get("SUPABASE_HTTP_URL")) {
  serve(handler);
}
