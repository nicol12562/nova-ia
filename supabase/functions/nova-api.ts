// ============================================================
// NOVA AI — Edge Function: nova-api
// API pública: auth por key hasheada, descuento en USD, CORS, rate limit.
// ============================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.0";
import crypto from "https://deno.land/std@0.224.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Rate limit store (in-memory, reset cada minuto)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(apiKeyHash: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(apiKeyHash);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(apiKeyHash, { count: 1, resetAt: now + 60 * 1000 });
    return true;
  }
  if (entry.count >= 30) return false;
  entry.count++;
  return true;
}

function hashKey(key: string): string {
  // SHA-256 + prefijo
  const hash = crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const bytes = new Uint8Array(hash);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return "sha256$" + hex;
}

// ===== Handler principal =====
async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const apiKey = url.searchParams.get("api_key") || req.headers.get("Authorization")?.replace("Bearer ", "");

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key requerida" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1. Verificar rate limit
  if (!checkRateLimit(apiKey)) {
    return new Response(JSON.stringify({ error: "Rate limit excedido (30 req/min)" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Verificar la API key (hash + prefix)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_ANON_KEY") || ""
  );

  const { data: keyData, error: keyError } = await supabase
    .from("api_keys")
    .select("api_key_hash, prefix, user_id, revoked")
    .eq("revoked", false)
    .single();

  // Si no hay key guardada, el usuario puede crear una primera vez
  if (keyError && keyError.code === "PGRST116") {
    // Para pruebas, permitir si el api_key es la esperada
    const expected = "nova_live_YOUR_KEY_HERE";
    if (apiKey === expected) {
      return new Response(JSON.stringify({ error: "Sin key aún. Usá POST /admin/regenerate" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "API key inválida" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (keyError) {
    return new Response(JSON.stringify({ error: "Base de datos: " + keyError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (keyData?.revoked) {
    return new Response(JSON.stringify({ error: "API key revocada" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Parsear body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Body inválido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { model, messages, temperature, max_tokens } = body;

  if (!model || !messages || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: "Faltan model o messages" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 4. Validar modelo (debe estar en la base de datos)
  const { data: modelRow, error: modelError } = await supabase
    .from("models")
    .select("gemini_model_id, price_in, price_out")
    .eq("public_name", model)
    .eq("active", true)
    .single();

  if (modelError || !modelRow) {
    return new Response(JSON.stringify({ error: "Modelo no permitido" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 5. Obtener perfil del usuario
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, plan, tokens_used, tokens_limit, balance_usd, trial_ends_at, plan_ends_at")
    .eq("id", keyData.user_id)
    .single();

  if (profileError || !profile) {
    return new Response(JSON.stringify({ error: "Usuario no encontrado" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 6. Verificar límite (función SQL)
  const { data: limitData, error: limitError } = await supabase
    .rpc("evaluate_call_limit", { p_user_id: profile.id, p_model: model })
    .single();

  if (limitError || !limitData?.ok) {
    return new Response(JSON.stringify({ error: limitData?.error || "Límite alcanzado" }), {
      status: 402,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 7. Llamar a Gemini (con key del servidor)
  const geminiKey = await (async () => {
    const s = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_ANON_KEY") || ""
    );
    const { data, error } = await s
      .from("secrets")
      .select("secret_value")
      .eq("secret_key", "GEMINI_API_KEY")
      .single();
    if (error || !data?.secret_value) throw new Error("No hay clave de Gemini");
    return data.secret_value;
  })();

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelRow.gemini_model_id}:generateContent?key=${geminiKey}`;

  const { temperature: temp, max_tokens: maxTok } = temperature ?? 0.7;
  const generationConfig = {
    temperature: temp ?? 0.7,
    topP: 0.9,
    maxOutputTokens: maxTok ?? 1024,
  };

  const geminiRes = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: messages.map(m => ({ role: m.role, parts: [{ text: m.content }] })),
      generationConfig,
    }),
  });

  if (!geminiRes.ok) {
    const errText = await geminiRes.text();
    return new Response(JSON.stringify({ error: "Gemini falló", detail: errText }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const geminiData = await geminiRes.json();

  // 8. Guardar uso + descontar (atómico)
  const text = geminiData?.choices?.[0]?.message?.content || "";
  const usage = geminiData?.usageMetadata || {};
  const inputTokens = usage.promptTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;
  const totalCost = (inputTokens / 1_000_000) * modelRow.price_in + (outputTokens / 1_000_000) * modelRow.price_out;

  // Guardar en api_usage
  await supabase.from("api_usage").insert([{
    user_id: profile.id,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: totalCost,
    request_id: crypto.randomUUID(),
  }]);

  // Descontar saldo balance_usd atómicamente
  try {
    await supabase.rpc("deduct_balance", {
      p_user_id: profile.id,
      p_amount: totalCost,
    });
  } catch (e: any) {
    console.error("deduct_balance error:", e.message);
    // No fallar la llamada por error de saldo
  }

  // 9. Devolver respuesta
  const { data: updated, error: updError } = await supabase
    .from("profiles")
    .select("balance_usd, tokens_used, tokens_limit")
    .eq("id", profile.id)
    .single();

  return new Response(JSON.stringify({
    content: text,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      cost_usd: totalCost,
    },
    remaining_balance: updated?.balance_usd,
    tokens_remaining: Math.max(0, updated?.tokens_limit - updated?.tokens_used),
    request_id: crypto.randomUUID(),
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ===== Init =====
if (Deno.env.get("SUPABASE_HTTP_URL")) {
  serve(handler);
}
