/* ============================================================
   NOVA AI — API client
   Ubicaciones: /api/*.html (edge functions)
   Autenticación: Bearer <api_key> (solo para /api/*)
   Mensajes: /functions/v1/chat
   ============================================================ */

const Nova = window.Nova || {};

Nova.api = {
  /**
   * Llamar a una Edge Function.
   * @param {string} fn - Nombre de la función (sin /functions/v1/)
   * @param {object} body - Cuerpo JSON
   * @param {boolean} needsAuth - Si requiere Authorization header
   * @returns {Promise<object>} { data, error }
   */
  async call(fn, body = {}, needsAuth = false) {
    const url = Nova.config.supabaseUrl + Nova.config.apiBasePath + '/' + fn;
    const headers = {
      'Content-Type': 'application/json',
    };
    if (needsAuth) {
      const key = await this.getUserApiKey();
      if (!key) {
        return { data: null, error: { message: 'Sin API key. Configurala en /api o admin.' } };
      }
      headers['Authorization'] = 'Bearer ' + key;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const text = await res.text();
        return { data: null, error: { status: res.status, message: text || 'Error en la función.' } };
      }
      return { data: await res.json(), error: null };
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        return { data: null, error: { message: 'Tiempo de espera agotado (30s). Intenta de nuevo.' } };
      }
      return { data: null, error: { message: 'Error de red: ' + err.message } };
    }
  },

  /**
   * Llamar a la función de chat (SSE o completo).
   */
  async chat(body) {
    return this.call('chat', body, false);
  },

  /**
   * Llamar a la API pública con API key del usuario.
   */
  async novaApi(body) {
    return this.call('nova-api', body, true);
  },

  /**
   * Obtener API key del usuario (si la tiene).
   */
  async getUserApiKey() {
    if (Nova.config.userApiKeyLoaded && Nova.config.userApiKey) {
      return Nova.config.userApiKey;
    }
    const { data, error } = await supabase
      .from('api_keys')
      .select('api_key_hash')
      .eq('user_id', supabase.auth.user().id)
      .single();
    if (error || !data?.api_key_hash) return null;
    // En producción no se devuelve la key. Aquí retornamos null (la clave
    // se guarda hasheada; el backend compara con constant_time_compare).
    return null;
  },

  /**
   * Verificar estado del plan del usuario.
   */
  async getUserState() {
    const { data, error } = await supabase
      .from('profiles')
      .select('plan, tokens_used, tokens_limit, trial_ends_at, plan_ends_at, role, suspended')
      .eq('id', supabase.auth.user().id)
      .single();
    if (error) {
      if (error.code === 'PGRST116') {
        return { data: null, error: null };
      }
      return { data: null, error };
    }
    return { data, error: null };
  },

  /**
   * Listar conversaciones del usuario.
   */
  async listConversations() {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', supabase.auth.user().id)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) return { data: [], error };
    return { data: data || [], error: null };
  },

  /**
   * Crear conversación.
   */
  async createConversation() {
    const { data, error } = await supabase
      .from('conversations')
      .insert([{ user_id: supabase.auth.user().id }])
      .select()
      .single();
    if (error) return { data: null, error };
    return { data, error: null };
  },

  /**
   * Renombrar conversación.
   */
  async renameConversation(id, name) {
    const { data, error } = await supabase
      .from('conversations')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) return { data: null, error };
    return { data, error: null };
  },

  /**
   * Borrar conversación y sus mensajes.
   */
  async deleteConversation(id) {
    const { data, error } = await supabase
      .from('messages')
      .delete()
      .eq('conversation_id', id);
    if (error) return { data: false, error };
    const { data: d, error: e } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id)
      .select()
      .single();
    return { data: d, error: e };
  },

  /**
   * Guardar mensaje (assistant).
   */
  async saveMessage(content, role, conversationId, model) {
    const { data, error } = await supabase
      .from('messages')
      .insert([{ content, role, conversation_id: conversationId, model }])
      .select()
      .single();
    if (error) return { data: null, error };
    return { data, error: null };
  },
};
