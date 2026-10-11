/* ============================================================
   NOVA AI — Config
   BASE_PATH para GitHub Pages. No hardcodear URL base.
   ============================================================ */

// Si el sitio se sirve desde /nombre-repo/, BASE_PATH lo detecta.
const BASE_PATH = (() => {
  const path = window.location.pathname.split('/').filter(Boolean).slice(0, 2).join('/') || '/';
  return path || '/';
})();

// Configuración Supabase — SOLO valores públicos para el frontend.
// LA API KEY (anon) y la URL se usan en Edge Functions para API privada.
// Secrets del servidor viven en Supabase Dashboard → Settings → API.
window.Nova = window.Nova || {};
window.Nova.config = {
  // ⚠️ SUBCAMBIA ESTO CON TU URL REAL de Supabase (pública, no secreta)
  supabaseUrl: 'https://TU-NOMBRE-PROYECTO.supabase.co',
  supabaseAnonKey: 'TU_ANON_KEY_AQUI',  // TODO: reemplazar con la anon key real de tu proyecto
  basePath: BASE_PATH,
  apiBasePath: '/functions/v1',
  geminiModelBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  // Si el usuario tiene clave propia (Enterprise), se carga dynamicamente
  userApiKey: null,
  userApiKeyLoaded: false,
};

// Exponer supabase si está disponible
if (window.Supabase) {
  window.supabase = window.Supabase.createClient(
    window.Nova.config.supabaseUrl,
    window.Nova.config.supabaseAnonKey
  );
}

// Detectar BASE_PATH para enlaces absolutos
document.addEventListener('DOMContentLoaded', () => {
  const base = window.Nova.config.basePath;
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href && !href.startsWith('#') && !href.startsWith('http') && !href.startsWith('data:') && !href.startsWith('mailto:')) {
      const absolute = href.startsWith('/') ? href : '/' + href;
      a.setAttribute('href', base + absolute.replace(/^\//, ''));
    }
  });
});
