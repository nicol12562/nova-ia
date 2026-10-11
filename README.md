# Nova AI
Plataforma de chat con IA (Gemini) con planes, tokens, mini-agentes, API propia con saldo real y panel admin.

> **Nota de seguridad (importante):** Este proyecto es un *prototipo de arquitectura*. Las Edge Functions y la base de datos están diseñadas para producción, pero **debes** ajustar las claves de Gemini/OpenRouter, los credenciales de Supabase, y las políticas de la base de datos antes de exponer la app a producción.

---

## Estructura de carpetas

```
nova-ia/
├── index.html              # Inicio
├── login.html              # Inicio de sesión
├── register.html           # Registro
├── workspace.html          # Chat (Workspace)
├── planes.html             # Planes
├── ajustes.html            # Ajustes
├── perfil.html             # Perfil
├── api.html                # Nova API (clave, consola de prueba)
├── admin.html              # Consola de administración (light theme)
├── 404.html                # Página 404
├── .nojekyll               # Deshabilitar Jekyll en GitHub Pages
├── css/
│   ├── base/
│   │   ├── variables.css   # Variables CSS globales
│   │   └── base.css        # Reset y estilos base
│   ├── components/         # Componentes UI compartidos
│   ├── layout.css          # Sidebar, header, chatbot
│   └── pages/
│       ├── inicio.css
│       ├── login.css
│       ├── workspace.css
│       ├── planes.css
│       ├── ajustes.css
│       ├── perfil.css
│       ├── api.css
│       └── admin.css
├── js/
│   ├── config.js           # Configuración (BASE_PATH, Supabase URL, etc.)
│   ├── api.js              # Cliente API + Edge Functions
│   ├── auth.js             # Auth, guard de rutas, toasts, markdown
│   └── (cada página tiene su lógica inline)
└── supabase/
    ├── migrations/
    │   └── 001_initial_schema.sql   # Schema completo + RLS + funciones
    └── functions/
        ├── chat.ts                      # Chat con SSE + streaming
        ├── nova-api.ts                  # API pública con key hasheada
        ├── admin-save-credentials.ts    # Guardar secrets (admin)
        ├── admin-ping-gemini.ts         # Ping test a Gemini
        ├── admin-change-plan.ts         # Cambiar plan (admin)
        ├── admin-add-tokens.ts          # Añadir tokens (admin)
        ├── admin-credit-balance.ts      # Creditar saldo (admin)
        └── admin-regenerate-api-key.ts  # Regenerar API key (admin)
```

---

## Requisitos

- **Frontend:** HTML + CSS + JS vanilla con ES Modules. Sin build, sin npm, sin frameworks.
- **Backend:** Supabase (plan gratis) con Edge Functions en Deno.
- **Diseño:** Tema oscuro (`#0a0a12` / `#12121c`), acento índigo→violeta (`#4f46e5` → `#9333ea`), ámbar para tokens, verde para saldo.
- **Tipografías:** "Plus Jakarta Sans" (UI) y "JetBrains Mono" (datos/code).
- **Librerías:** `@supabase/supabase-js` (CDN, fija), `marked` (CDN, fija), `DOMPurify` (CDN, fija).

---

## Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/nicol12562/nova-ia.git
cd nova-ia
```

### 2. Crear un proyecto Supabase

1. Ve a [supabase.com](https://supabase.com) y creá un proyecto gratis.
2. Copá el **Project URL** (ej: `https://xyzabc.supabase.co`) y la **anon public key**.
3. Configura las variables de entorno en `.env.example` (o en el archivo `js/config.js`).

### 3. Aplicar el esquema de la base de datos

En [Supabase Dashboard → SQL Editor](https://app.supabase.com/project/<proj>/sql), pegá el contenido de `supabase/migrations/001_initial_schema.sql` y ejecutalo.

### 4. Desplegar las Edge Functions

1. Ve a [Supabase Dashboard → Edge Functions](https://app.supabase.com/project/<proj>/functions).
2. Para cada función (`chat`, `nova-api`, `admin-*`), creá una nueva función con el códigocorrespondiente en `supabase/functions/`.
3. En cada función, configurales variables de entorno si es necesario:
   - `GEMINI_API_KEY` (solo server-side, NO exponer al frontend)
   - `OPENROUTER_API_KEY` (opcional)
4. Habilitá **JWT** en el settings de Supabase.

### 5. Configurar GitHub Pages

1. ve a **Settings → Pages** en el repo GitHub.
2. Publica la carpeta `/docs` o la raíz del repo (dependiendo de cómo esté estructurado).
3. Página con las rutas relativas (el spec asume `/repo/` o raíz).

### 6. Configurar el admin

1. Crea un usuario con `role = 'admin'` en la base de datos.
2. Entra a `/admin.html` y verifica que aparezcan los stats.
3. Guarda las credenciales de Gemini/OpenRouter vía `/admin.html` → Bóveda de credenciales.

---

## Uso

### Chat (Workspace)

- Entra a `/workspace.html`.
- El chat sincroniza con la base de datos (historial entre dispositivos).
- El contexto se recorta a un máximo de mensajes para no gastar de más.
- Si se acaban los tokens o vence el plan, el envío se bloquea.

### Nova API

- Entra a `/api.html`.
- Ve a **Consola de prueba** para ejecutar una consulta.
- Cada prueba descuenta saldo del balance de tu cuenta.

### Admin

- Entra a `/admin.html` con un usuario `role = 'admin'`.
- Gestioná usuarios, planes, tokens, saldo.
- Configurale la bóveda de credenciales (Gemini key).

---

## Seguridad

### Reglas clave

1. **Ningún secreto en el frontend.** La API key de Gemini y cualquier key de terceros viven SOLO en secretos de Edge Functions o tablas inaccesibles para el cliente.
2. Toda lógica de dinero/tokens/permisos se valida y ejecuta en el servidor. El cliente solo muestra.
3. RLS activado en TODAS las tablas. Políticas: cada usuario solo lee/escribe lo suyo.
4. El usuario NO puede modificar su propio `plan`, `role`, `tokens_*` ni balance (solo funciones del servidor/admin).
5. La API key se guarda hasheada (SHA-256 + prefijo). La UI muestra la clave completa SOLO LA PRIMERA VEZ.

### Edge Functions

- `chat`: valida JWT, plan, modelo permitido, tokens restantes, vencimiento. Descuenta atómicamente. Usa `usageMetadata` para el conteo REEL de tokens.
- `nova-api`: autenticación por API key hasheada, descuento en USD, CORS, rate limit (30 req/min).
- `admin-*`: acciones de admin con verificación de rol y registro en `audit_log`.

---

## Licencia

Propietario. © 2026 Nova AI.
