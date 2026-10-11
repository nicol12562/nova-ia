// ============================================================
// NOVA AI — Edge Function: admin-change-plan
// Cambia el plan de un usuario. Requiere rol admin.
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
  const { user_id, plan, tokens_limit, balance_usd } = body;

  // 1. Registrar en audit_log
  await supabase.from("audit_log").insert([{
    user_id: user.id,
    action: "admin_change_plan",
    details: { target: user_id, plan, tokens_limit, balance_usd },
  }]);

  // 2. Actualizar el perfil
  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      plan,
      tokens_limit: tokens_limit ?? null,
      balance_usd: balance_usd ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user_id);

  if (updateError) {
    return new Response(JSON.stringify({ error: "No se pudo actualizar el perfil" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true, message: "Plan cambiado a " + plan }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

if (Deno.env.get("SUPABASE_HTTP_URL")) {
  serve(handler);
}
