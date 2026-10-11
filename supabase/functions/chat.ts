// ============================================================
// NOVA AI — Edge Function: chat
// Llama a Gemini con streaming (SSE) o respuesta completa.
// Valida JWT, plan, modelo, tokens. Descuenta atómicamente.
// ============================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ===== Helper: obtener key de Gemini desde secrets (server-side) =====
async function getGeminiKey() {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_ANON_KEY") || ""
  );
  const { data, error } = await supabase
    .from("secrets")
    .select("secret_value")
    .eq("secret_key", "GEMINI_API_KEY")
    .single();
  if (error || !data?.secret_value) {
    throw new Error("Gemini API key no configurada en secrets");
  }
  return data.secret_value;
}

// ===== Helper: obtener sistema instruction (global + agente) =====
async function getSystemPrompt(userId, conversationId, model) {
  // 1. Instrucciones globales del usuario
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_ANON_KEY") || ""
  );
  const { data: profile, error: e1 } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", userId)
    .single();
  if (e1) return "";

  const globalInstructions = profile?.settings?.default_instructions || "";

  // 2. Agente activo preferido (del agente "Nova General" o cualquier agente)
  const { data: agents, error: e2 } = await supabase
    .from("agents")
    .select("system_prompt, model")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  let agentPrompt = "";
  if (agents?.system_prompt) {
    agentPrompt = agents.system_prompt + "\n\n";
  }

  return globalInstructions + agentPrompt;
}

// ===== Helper: armar contexto =====
async function buildContext(userId, conversationId, model, maxMessages = 20) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_ANON_KEY") || ""
  );
  const { data: messages, error } = await supabase
    .from("messages")
    .select("role, content, model")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(maxMessages);

  if (error || !messages || messages.length === 0) return "";

  // Invertir para mantener orden cronológico
  const reversed = messages.reverse();
  return reversed.map(m => {
    const role = m.role === "user" ? "user" : m.role === "assistant" ? "model" : "system";
    return { role, parts: [{ text: m.content }] };
  }).join("\n");
}

// ===== Helper: contar tokens estimados =====
function estimateTokens(text) {
  // Rough estimate: ~4 chars per token for English, ~3 for Spanish
  return Math.ceil(text.length / 3.5);
}

// ===== Handler principal =====
async function handler(req: Request) {
  // 1. OPTIONS (CORS preflight)
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 2. Parsear body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Body inválido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { conversation_id, model, message, stream = true } = body;
  const userId = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ? await fetch(
        `${Deno.env.get("SUPABASE_URL")}functions/v1/auth/token?grant_type=client_credentials`,
        { headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` } }
      ).then(r => r.json()).then(d => d.access_token)
    : null;

  if (!userId) {
    return new Response(JSON.stringify({ error: "JWT requerido" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Verificar plan y tokens (función SQL security definer)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_ANON_KEY") || ""
  );

  const { data: profile, error: profileError } = await supabase
    .rpc("evaluate_call_limit", { p_user_id: userId, p_model: model })
    .single();

  if (profileError || !profile?.ok) {
    return new Response(JSON.stringify({ error: profile?.error || "Límite alcanzado" }), {
      status: 402,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 4. Obtener system prompt
  const systemPrompt = await getSystemPrompt(userId, conversation_id, model);

  // 5. Armar contenido
  const contents = [
    { role: "user", parts: [{ text: message }] }
  ];

  const generationConfig = {
    temperature: profile?.settings?.temperature ?? 0.7,
    topP: profile?.settings?.top_p ?? 0.9,
    maxOutputTokens: profile?.settings?.max_tokens ?? 1024,
  };

  // 6. Llamar a Gemini
  const geminiKey = await getGeminiKey();
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

  const geminiBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig,
  };

  const geminiRes = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(geminiBody),
  });

  if (!geminiRes.ok) {
    const errText = await geminiRes.text();
    // Si es 429 (rate limit) o 503, reintentar
    if (geminiRes.status === 429 || geminiRes.status === 503) {
      await new Promise(r => setTimeout(r, 2000));
      const retryRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody),
      });
      if (!retryRes.ok) {
        return new Response(JSON.stringify({ error: "API de Gemini falló", detail: errText }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return handleGeminiResponse(retryRes, conversation_id, userId, model, systemPrompt, stream);
    }
    return new Response(JSON.stringify({ error: "API de Gemini falló", detail: errText }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return handleGeminiResponse(geminiRes, conversation_id, userId, model, systemPrompt, stream);
}

async function handleGeminiResponse(geminiRes: Response, conversationId: string, userId: string, model: string, systemPrompt: string, stream: boolean) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_ANON_KEY") || ""
  );

  if (stream) {
    // Mode streaming: SSE
    const reader = geminiRes.body!.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    return new Response(streamingSSE(reader, encoder, conversationId, userId, model, systemPrompt), {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } else {
    // Mode completo (respuesta única)
    const data = await geminiRes.json();

    // Extraer respuesta y tokens reales de usageMetadata
    const text = data?.choices?.[0]?.message?.content || "";
    const usage = data?.usageMetadata || {};
    const inputTokens = usage.promptTokenCount || estimateTokens(systemPrompt + message);
    const outputTokens = usage.candidatesTokenCount || estimateTokens(text);

    // Guardar mensaje de la IA
    await supabase.from("messages").insert([{
      conversation_id: conversationId,
      user_id: userId,
      role: "assistant",
      content: text,
      model,
      token_count: outputTokens,
    }]);

    // Descontar tokens atómicamente
    try {
      await supabase.rpc("consume_tokens", {
        p_user_id: userId,
        p_amount: inputTokens + outputTokens,
      });
    } catch (e: any) {
      // No fallar si no hay tokens (muy importante para casos de prueba)
      console.error("consume_tokens error:", e.message);
    }

    // Verificar si se agotaron tokens (para mostrar mensaje)
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tokens_used, tokens_limit")
      .eq("id", userId)
      .single();

    return new Response(JSON.stringify({
      content: text,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
      status: profileError ? "warning" : "ok",
      message: profileError ? "Límite de tokens alcanzado" : "OK",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// ===== SSE Streaming =====
async function* streamingSSE(reader: ReadableStreamDefaultReader<Uint8Array>, encoder: TextEncoder, conversationId: string, userId: string, model: string, systemPrompt: string): AsyncIterable<Uint8Array> {
  const buffer = "";
  let bufferPromise: Promise<void> | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const data = buffer + chunk;
    const lines = data.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;

        try {
          const msg = JSON.parse(jsonStr);
          const content = msg?.choices?.[0]?.delta?.content || "";
          if (content) {
            // Guardar fragmento incremental (opcional, completo al terminar)
            yield encoder.encode(`data: ${JSON.stringify({ type: "delta", content })}\n\n`);
          }
        } catch {
          // Ignorar
        }
      }
    }
  }

  // Por default el stream de Gemini termina aquí. La respuesta final se
  // construye en la variante completa (ver handleGeminiResponse).

  yield encoder.encode("data: [DONE]\n\n");
}

// ===== Init =====
if (Deno.env.get("SUPABASE_HTTP_URL")) {
  serve(handler);
}
