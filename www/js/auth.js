/* ============================================================
   NOVA AI — Auth + Guard de rutas
   ============================================================ */

const Nova = window.Nova || {};

// ===== Verificar sesión =====
Nova.auth = {
  async init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await this.guards();
      this.setupRealtime();
    } else {
      this.redirectIfAuthenticated();
    }
  },

  async guards() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return this.redirectToLogin();

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('plan, role, suspended, tokens_used, tokens_limit, trial_ends_at, plan_ends_at')
      .eq('id', user.id)
      .single();

    // Perfil no existe -> crearlo
    if (error && error.code === 'PGRST116') {
      await this.ensureProfileCreated(user);
      return this.guards();
    }
    if (error) throw error;

    // Estado global
    this.user = user;
    this.profile = profile;
    this.isAdmin = profile?.role === 'admin';
    this.isSuspended = profile?.suspended === true;
    this.isLoggedIn = true;

    // Guard de rutas
    if (this.isSuspended) {
      window.location.href = 'login.html';
      return;
    }

    // Redirigir según la ruta actual
    const path = window.location.pathname;
    if (path === '/login.html' || path === '/register.html') {
      window.location.href = this.profile?.plan && this.profile.plan !== 'Gratis' ? 'workspace.html' : 'index.html';
      return;
    }

    // Si no hay sesión y se intenta entrar a una página protegida
    if (!this.isLoggedIn) {
      this.redirectToLogin();
      return;
    }

    this.updateNavbar();
  },

  async ensureProfileCreated(user) {
    const { data: settings } = await supabase
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .single();

    const { data, error } = await supabase
      .from('profiles')
      .insert([{
        id: user.id,
        email: user.email,
        display_name: user.user_metadata?.full_name || user.email.split('@')[0],
        plan: 'Gratis',
        tokens_used: 0,
        tokens_limit: 1000000,
        trial_ends_at: this.getDateInDays(7),
        plan_ends_at: null,
        suspended: false,
        settings: settings?.settings || {
          default_model: 'Nova Flash',
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 1024,
          default_instructions: '',
          response_style: 'concise',
          streaming: true,
          font_size: 16,
          theme: 'dark',
          language: 'es-LA',
        }
      }])
      .select()
      .single();

    if (error) throw error;
    this.profile = data;
    this.isAdmin = false;
    this.isSuspended = false;
  },

  getDateInDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
  },

  isPlan(payload, planName) {
    return payload?.plan === planName;
  },

  hasPlan(payload, ...plans) {
    return plans.includes(payload?.plan);
  },

  isPaid(plan) {
    return ['Pro', 'Plus', 'Enterprise'].includes(plan || this.profile?.plan);
  },

  canUseAgents(plan) {
    return ['Pro', 'Plus', 'Enterprise'].includes(plan || this.profile?.plan);
  },

  redirectToLogin() {
    const path = window.location.pathname;
    if (path !== '/login.html' && path !== '/register.html') {
      window.location.href = '/login.html';
    }
  },

  redirectIfAuthenticated() {
    const path = window.location.pathname;
    if (path === '/login.html' || path === '/register.html') {
      window.location.href = '/index.html';
    }
  },

  setupRealtime() {
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        this.user = session.user;
        this.guards();
      } else {
        this.redirectIfAuthenticated();
      }
    });
  },

  updateNavbar() {
    // Agregar clase .logged-in al navbar
    const navbar = document.querySelector('.navbar');
    if (navbar) {
      navbar.classList.add('logged-in');
    }
    // Actualizar perfil
    const profileEl = document.querySelector('.user-profile');
    if (profileEl && this.user) {
      const initials = this.user.user_metadata?.full_name
        ? this.user.user_metadata.full_name.charAt(0).toUpperCase() + this.user.user_metadata.full_name.split(' ').pop().charAt(0).toUpperCase()
        : this.user.email?.charAt(0).toUpperCase() || 'U';
      profileEl.innerHTML = `
        <div class="user-profile">
          <div class="avatar" style="cursor:pointer;" title="${this.user.email}">${initials}</div>
        </div>
      `;
    }
  },
};

// ===== Toasts globales =====
Nova.toast = {
  container: null,
  init() {
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    this.container.style.position = 'fixed';
    this.container.style.top = '1rem';
    this.container.style.right = '1rem';
    this.container.style.zIndex = '9999';
    document.body.appendChild(this.container);
  },
  show(msg, type = 'info', duration = 4000) {
    const div = document.createElement('div');
    div.className = 'toast toast-' + type;
    div.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>${msg}`;
    this.container.appendChild(div);
    setTimeout(() => {
      if (div.parentNode) div.parentNode.removeChild(div);
    }, duration);
  }
};

// ===== Markdown render seguro =====
Nova.markdown = {
  render(text) {
    if (!text) return '<em>Sin mensaje</em>';
    const raw = marked.parse(text);
    const clean = DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img'],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style', 'target', 'width', 'height', 'align'],
      ALLOWED_URI_SCHEMES: ['https', 'http', 'mailto', 'tel'],
    });
    return clean;
  }
};

// ===== Inicializar =====
document.addEventListener('DOMContentLoaded', () => {
  Nova.auth.init();
  Nova.toast.init();
});
