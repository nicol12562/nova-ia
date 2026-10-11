// ============================================================
// NOVA AI — Edge Function: admin-save-credentials
// Guarda secretas (Gemini key, OpenRouter key) en la tabla secrets.
// Requiere rol admin (verificado en servidor).
// ============================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 1. Verificar JWT admin
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

  // 2. Registramos en audit_log
  await supabase.from("audit_log").insert([{
    user_id: user.id,
    action: "admin_save_credentials",
    details: { keys: Object.keys(req.body || {}) },
  }]);

  // 3. Guardar secretas (solo service_role puede leer la tabla)
  const body = await req.json();
  const { data, error: insertError } = await supabase
    .from("secrets")
    .upsert([
      { secret_key: "GEMINI_API_KEY", secret_value: body.gemini_key || "", updated_at: new Date().toISOString() },
      { secret_key: "OPENROUTER_API_KEY", secret_value: body.openrouter_key || "", updated_at: new Date().toISOString() },
    ], { onConflict: "secret_key" });

  if (insertError) {
    return new Response(JSON.stringify({ error: "No se pudieron guardar las credenciales" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true, message: "Credenciales configuradas ✓" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

if (Deno.env.get("SUPABASE_HTTP_URL")) {
  serve(handler);
}
