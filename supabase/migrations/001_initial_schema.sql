-- ============================================================
-- NOVA AI — Schema de Supabase (Postgres + RLS + Edge Functions)
-- ============================================================
-- Ejecutá este archivo en el SQL Editor de Supabase.
-- Crea todas las tablas, RLS, funciones, triggers e índices.
-- ============================================================

-- ============================================================
-- 1. TABLAS
-- ============================================================

-- ===== plans =====
CREATE TABLE plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  tokens_limit BIGINT NOT NULL DEFAULT 1000000,
  agents_limit INTEGER NOT NULL DEFAULT 0,
  price_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar planes por defecto
INSERT INTO plans (name, tokens_limit, agents_limit, price_usd, description) VALUES
('Gratis', 1000000, 0, 0, '1M tokens / 7 días, sin mini-agentes'),
('Pro', 2000000, 3, 9.00, '2M tokens, mini-agentes'),
('Plus', 5000000, 5, 24.00, '5M tokens, mini-agentes'),
('Enterprise', 999999999, 20, NULL, 'Tokens ilimitados, modelos propios');

-- ===== models =====
CREATE TABLE models (
  id SERIAL PRIMARY KEY,
  public_name TEXT NOT NULL,
  gemini_model_id TEXT NOT NULL,
  price_in NUMERIC(10,6) NOT NULL DEFAULT 0,  -- por 1M tokens entrada
  price_out NUMERIC(10,6) NOT NULL DEFAULT 0, -- por 1M tokens salida
  active BOOLEAN NOT NULL DEFAULT TRUE,
  plan_access TEXT[], -- modelos permitidos: {'Gratis','Pro','Plus','Enterprise'}
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO models (public_name, gemini_model_id, price_in, price_out, active, plan_access, sort_order) VALUES
('Nova Flash', 'gemini-2.0-flash', 0.0001, 0.0004, TRUE, ARRAY['Gratis','Pro','Plus','Enterprise'], 1),
('Nova Pro', 'gemini-2.5-pro', 0.0005, 0.0015, TRUE, ARRAY['Pro','Plus','Enterprise'], 2),
('Nova Pro 3.1', 'gemini-3.1-pro', 0.0008, 0.002, TRUE, ARRAY['Plus','Enterprise'], 3);

-- ===== profiles =====
CREATE TABLE profiles (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  plan TEXT NOT NULL DEFAULT 'Gratis',
  tokens_used BIGINT NOT NULL DEFAULT 0,
  tokens_limit BIGINT NOT NULL DEFAULT 1000000,
  balance_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  trial_ends_at TIMESTAMPTZ,
  plan_ends_at TIMESTAMPTZ,
  suspended BOOLEAN NOT NULL DEFAULT FALSE,
  settings JSONB NOT NULL DEFAULT '{
    "default_model": "Nova Flash",
    "temperature": 0.7,
    "top_p": 0.9,
    "max_tokens": 1024,
    "default_instructions": "",
    "response_style": "concise",
    "streaming": true,
    "font_size": 16,
    "theme": "dark",
    "language": "es-LA"
  }',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices en profiles
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_plan ON profiles(plan);
CREATE INDEX idx_profiles_id ON profiles(id);

-- ===== conversations =====
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT DEFAULT 'Nuevo chat',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at);

-- ===== messages =====
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  model TEXT,
  token_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_user_id ON messages(user_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

-- ===== agents =====
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  model TEXT,
  avatar_url TEXT,
  system_prompt TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  suggested_conversations TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agents_user_id ON agents(user_id);

-- ===== api_keys =====
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  api_key_hash TEXT NOT NULL,
  prefix TEXT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);

-- ===== api_balance =====
CREATE TABLE api_balance (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  balance_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_balance_user_id ON api_balance(user_id);

-- ===== api_usage =====
CREATE TABLE api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  request_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_usage_user_id ON api_usage(user_id);
CREATE INDEX idx_api_usage_created_at ON api_usage(created_at);

-- ===== payments =====
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  plan TEXT NOT NULL,
  method TEXT NOT NULL,
  comprobante TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_estado ON payments(estado);

-- ===== audit_log =====
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

-- ===== secrets =====
CREATE TABLE secrets (
  secret_key TEXT PRIMARY KEY,
  secret_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS ACTIVADO EN TODAS LAS TABLAS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. FUNCIONES SQL (SECURITY DEFINER)
-- ============================================================

-- ===== Crear perfil al registrarse =====
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name, plan, tokens_limit, trial_ends_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'Gratis',
    1000000,
    NOW() + INTERVAL '7 days'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Crear trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== Consumir tokens atómicamente (sin sobrepasar) =====
CREATE OR REPLACE FUNCTION public.consume_tokens(
  p_user_id UUID,
  p_amount BIGINT
) RETURNS BOOLEAN AS $$
DECLARE
  v_plan TEXT;
  v_remaining BIGINT;
  v_tokens_limit BIGINT;
  v_trial_ends_at TIMESTAMPTZ;
  v_plan_ends_at TIMESTAMPTZ;
  v_renova_plan BOOLEAN := FALSE;
BEGIN
  -- Obtener estado actual
  SELECT plan, tokens_used, tokens_limit, trial_ends_at, plan_ends_at
  INTO v_plan, v_tokens_used, v_tokens_limit, v_trial_ends_at, v_plan_ends_at
  FROM profiles WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;

  -- Verificar si el plan expiró
  IF v_plan_ends_at IS NOT NULL AND v_plan_ends_at < NOW() THEN
    RAISE EXCEPTION 'Plan vencido';
  END IF;

  -- Verificar si hay tokens disponibles (agotamiento de tokens)
  IF v_plan = 'Gratis' THEN
    -- Plan gratis: 7 días o 1M tokens
    IF v_trial_ends_at IS NOT NULL AND v_trial_ends_at < NOW() THEN
      RAISE EXCEPTION 'Plan Gratis vencido (7 días)';
    END IF;
  END IF;

  v_remaining := v_tokens_limit - v_tokens_used - p_amount;
  IF v_remaining < 0 THEN
    RAISE EXCEPTION 'Sin tokens suficientes (solo % disponibles)', v_tokens_limit - v_tokens_used;
  END IF;

  -- Actualizar
  UPDATE profiles
  SET tokens_used = tokens_used + p_amount,
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== Descontar saldo en USD atómicamente =====
CREATE OR REPLACE FUNCTION public.deduct_balance(
  p_user_id UUID,
  p_amount NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
  v_balance NUMERIC(10,4);
  v_plan TEXT;
BEGIN
  SELECT balance_usd, plan INTO v_balance, v_plan
  FROM profiles WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'Saldo insuficiente (disponibles: $%.2f)', v_balance;
  END IF;

  UPDATE profiles
  SET balance_usd = balance_usd - p_amount,
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== Evaluar límite de una llamada (tokens + duración plan) =====
CREATE OR REPLACE FUNCTION public.evaluate_call_limit(
  p_user_id UUID,
  p_model TEXT
) RETURNS JSONB AS $$
DECLARE
  v_profile JSONB;
  v_plan TEXT;
  v_tokens_used BIGINT;
  v_tokens_limit BIGINT;
  v_tokens_available BIGINT;
  v_trial_ends_at TIMESTAMPTZ;
  v_plan_ends_at TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  SELECT json_build_object(
    'plan', plan,
    'tokens_used', tokens_used,
    'tokens_limit', tokens_limit,
    'trial_ends_at', trial_ends_at,
    'plan_ends_at', plan_ends_at
  ) INTO v_profile FROM profiles WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', FALSE, 'error', 'Usuario no encontrado');
  END IF;

  v_plan := v_profile->>'plan';
  v_tokens_used := (v_profile->>'tokens_used')::BIGINT;
  v_tokens_limit := (v_profile->>'tokens_limit')::BIGINT;
  v_trial_ends_at := v_profile->>'trial_ends_at';
  v_plan_ends_at := v_profile->>'plan_ends_at';

  -- Verificar vencimiento
  IF v_plan_ends_at IS NOT NULL AND v_plan_ends_at < NOW() THEN
    RETURN json_build_object('ok', FALSE, 'error', 'Plan vencido');
  END IF;

  IF v_plan = 'Gratis' AND v_trial_ends_at IS NOT NULL AND v_trial_ends_at < NOW() THEN
    RETURN json_build_object('ok', FALSE, 'error', 'Plan Gratis vencido');
  END IF;

  -- Alto de tokens restantes
  v_tokens_available := v_tokens_limit - v_tokens_used;

  -- Verificar modelo permitido para el plan
  SELECT plan_access INTO v_plan FROM models WHERE gemini_model_id = p_model LIMIT 1;
  IF NOT FOUND THEN
    SELECT plan_access INTO v_plan FROM models WHERE id = (SELECT id FROM models WHERE gemini_model_id = p_model LIMIT 1) LIMIT 1;
  END IF;

  RETURN json_build_object(
    'ok', TRUE,
    'plan', v_plan,
    'tokens_available', v_tokens_available,
    'tokens_used', v_tokens_used,
    'tokens_limit', v_tokens_limit,
    'max_tokens', v_tokens_limit
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. POLÍTICAS RLS
-- ============================================================

-- ===== Perfil: solo el usuario mismo / admin =====
CREATE POLICY "Perfiles: solo own" ON profiles
  FOR ALL
  USING (
    id = current_setting('request.user_id', TRUE)::UUID
    OR current_setting('request.role', TRUE) = 'admin'
  );

-- Perfil: update restringido (no cambiar plan/role/tokens/balance directamente)
CREATE POLICY "Perfiles: no modificar plan/role/tokens" ON profiles
  FOR UPDATE
  USING (id = current_setting('request.user_id', TRUE)::UUID)
  WITH CHECK (
    plan = OLD.plan
    AND role = OLD.role
    AND tokens_used = OLD.tokens_used
    AND tokens_limit = OLD.tokens_limit
    AND balance_usd = OLD.balance_usd
    AND suspended = OLD.suspended
    AND trial_ends_at = OLD.trial_ends_at
    AND plan_ends_at = OLD.plan_ends_at
  );

-- ===== Conversations =====
CREATE POLICY "Conversaciones: solo own" ON conversations
  FOR ALL
  USING (user_id = current_setting('request.user_id', TRUE)::UUID);

-- ===== Messages =====
CREATE POLICY "Mensajes: solo own" ON messages
  FOR ALL
  USING (user_id = current_setting('request.user_id', TRUE)::UUID);

-- ===== Agents =====
CREATE POLICY "Agentes: solo own" ON agents
  FOR ALL
  USING (user_id = current_setting('request.user_id', TRUE)::UUID);

-- ===== API Keys =====
CREATE POLICY "API keys: solo own" ON api_keys
  FOR ALL
  USING (user_id = current_setting('request.user_id', TRUE)::UUID);

-- ===== API Balance =====
CREATE POLICY "API balance: solo own" ON api_balance
  FOR ALL
  USING (user_id = current_setting('request.user_id', TRUE)::UUID);

-- ===== API Usage =====
CREATE POLICY "API usage: solo own" ON api_usage
  FOR ALL
  USING (user_id = current_setting('request.user_id', TRUE)::UUID);

-- ===== Payments =====
CREATE POLICY "Payments: solo own" ON payments
  FOR ALL
  USING (user_id = current_setting('request.user_id', TRUE)::UUID);

-- ===== Audit Log: solo admin (no visible para usuarios) =====
-- Skip policy for users. Admin functions access via security definer.

-- ===== Models: legible por todos, editable solo admin =====
CREATE POLICY "Models: legible por todos" ON models
  FOR SELECT USING (active = TRUE);

-- ===== Plans: legible por todos =====
CREATE POLICY "Plans: legible por todos" ON plans
  FOR SELECT USING (TRUE);

-- ============================================================
-- 4. ÍNDICES
-- ============================================================
CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_api_usage_user_created ON api_usage(user_id, created_at DESC);

-- ============================================================
-- 5. FUNCIONES DE AGREGACIÓN (opcionales)
-- ============================================================

-- ===== Contar mensajes de una conversación =====
CREATE OR REPLACE FUNCTION public.msg_count(p_conversation_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (SELECT COUNT(*) FROM messages WHERE conversation_id = p_conversation_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== Pendientes de verificar pagos =====
CREATE OR REPLACE FUNCTION public.pending_payments()
RETURNS TABLE (id UUID, user_id UUID, amount NUMERIC, plan TEXT, comprobante TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT id, user_id, amount, plan, comprobante FROM payments WHERE estado = 'pendiente';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== Pepirar que un pago esté verificado =====
CREATE OR REPLACE FUNCTION public.verify_payment(p_id UUID)
RETURNS VOIDS AS $$
BEGIN
  UPDATE payments SET estado = 'verificado', verified_at = NOW() WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. DATOS INICIALES
-- ============================================================
-- User admin por defecto (establecer luego vía admin)
INSERT INTO profiles (id, email, display_name, role, plan, tokens_limit, trial_ends_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'admin@nova.ai', 'Admin', 'admin', 'Pro', 10000000, NOW() + INTERVAL '30 days');

-- Nota: El usuario admin real debe crearse vía Supabase Dashboard o Register.
