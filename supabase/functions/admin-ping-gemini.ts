// ============================================================
// NOVA AI — Edge Function: admin-ping-gemini
// Prueba la clave de Gemini contra la API de Gemini.
// Requiere rol admin.
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

  // 1. Obtener la clave de Gemini
  const { data: secret, error: secretError } = await supabase
    .from("secrets")
    .select("secret_value")
    .eq("secret_key", "GEMINI_API_KEY")
    .single();

  if (secretError || !secret?.secret_value) {
    return new Response(JSON.stringify({ error: "No hay clave de Gemini configurada" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Prueba contra Gemini API
  const geminiKey = secret.secret_value;
  const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;

  try {
    const testRes = await fetch(testUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Responde con una sola palabra: OK" }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 10 },
      }),
    });

    if (!testRes.ok) {
      const errText = await testRes.text();
      return new Response(JSON.stringify({ ok: false, error: errText }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const testData = await testRes.json();
    const response = testData?.choices?.[0]?.message?.content || "";

    // 3. Registrar en audit_log
    await supabase.from("audit_log").insert([{
      user_id: user.id,
      action: "admin_ping_test",
      details: { result: "ok", response: response },
    }]);

    return new Response(JSON.stringify({
      ok: true,
      ping: "Gemini online",
      response: response,
      model: "gemini-2.0-flash",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await supabase.from("audit_log").insert([{
      user_id: user.id,
      action: "admin_ping_test",
      details: { result: "error", error: String(e) },
    }]);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

if (Deno.env.get("SUPABASE_HTTP_URL")) {
  serve(handler);
}
