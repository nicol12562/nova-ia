# NOVA AI — Checklist de Pruebas

> Verificá cada punto antes de responder. Marcá con [x] los completados.

## 1. Seguridad y secretos
- [ ] Ninguna API key, token o secret aparece en el frontend (config.js, api.js, HTML).
- [ ] La clave de Gemini vive SOLO en la tabla `secrets` (accesible por `service_role`).
- [ ] La API key del usuario se guarda hasheada (SHA-256 + prefijo en `api_keys`).
- [ ] El frontend solo conoce `SUPABASE_URL` y la `anon key` (públicas por diseño).
- [ ] Ningún usuario puede subirse su propio plan, tokens, saldo o rol (políticas RLS + funciones security definer).

## 2. Conexiones y red
- [ ] `config.js` tiene `BASE_PATH` detectado correctamente (GitHub Pages).
- [ ] Todas las rutas son relativas (`/inicio`, `/login`, etc.).
- [ ] La aplicación funciona con el sitio en `https://usuario.github.io/repo/`.
- [ ] Si falla Gemini/Supabase/red, la UI muestra error y sigue usable.
- [ ] Cada llamada de red: try/catch, timeout 30s, reintento con backoff al 429/503.

## 3. Funcionalidades del frontend
- [ ] **Inicio:** hero con badge "Inferencia Multimodal Cloud", CTA que redirige según sesión.
- [ ] **Login:** email+password y "Continuar con Google". Error amigable. "¿Olvidaste tu contraseña?".
- [ ] **Registro:** crea perfil con plan Gratis, `trial_ends_at = now() + 7 días`.
- [ ] **Workspace:** sidebar con "Nuevo chat" (Ctrl+N), historial, mini-agentes, plan card.
- [ ] **Chat:** mensajes con markdown renderizado (DOMPurify). Bloques de código con botón copiar.
- [ ] **Streaming:** SSE si la función lo soporta; fallback a respuesta completa con "escribiendo…".
- [ ] **Planes:** 4 tarjetas con CTA WhatsApp prellenado.
- [ ] **Ajustes:** slider temperatura (+0.0-1.0), top_p, max tokens, instrucciones maestras.
- [ ] **Perfil:** secciones General/Personalización/Suscripción/Control de datos/Seguridad.
- [ ] **Nova API:** clave mostrada (máscara + toggle), consola de prueba, ejemplos cURL/JS/Python.
- [ ] **Admin:** dashboard ligero, tabla de usuarios, bóveda de credenciales, ping test.

## 4. Reglas de negocio
- [ ] Plan Gratis se bloquea al llegar a 1M tokens O a los 7 días.
- [ ] Tokens se descuentan atómicamente (SQL security definer).
- [ ] Si falla Gemini, NO se cobra.
- [ ] Rate limit por key (30 req/min en Nova API).
- [ ] No hay dependencias sin versión fija (librerías CDN con SRI).

## 5. Pruebas de integración
- [ ] Registrar un usuario, verificar perfil creado en `profiles`.
- [ ] Iniciar chat, enviar mensaje, verificar que se guarda en `messages`.
- [ ] Verificar que el historial se sincroniza entre dispositivos (misma cuenta).
- [ ] Cambiar plan vía admin, verificar acceso al nuevo modelo.
- [ ] Verificar que la consola de API descuenta saldo correctamente.

## 6. Checklist visual (comparar con capturas)
- [ ] Inicio: degradé en título, badge "Inferencia Multimodal Cloud".
- [ ] Chat: sidebar con "Nova General" activo, tarjeta plan, 4 sugerencias.
- [ ] Login: tarjeta centrada, fondo oscuro, botón Google.
- [ ] Ajustes: tres cards (motor, temperatura, instrucciones).
- [ ] Perfil: sidebar con 5 secciones.
- [ ] API: tarjeta de clave, código (cURL/JS/Python), consola.
- [ ] Admin: light theme, 4 stats, tabla de usuarios, vault.

---

**Nota de la entrega:** Este es un prototipo de arquitectura. Los placeholder `YOUR_SUPABASE_ANON_KEY`, `<TU-PROYECTO>`, etc. deben ser reemplazados antes de desplegar.
