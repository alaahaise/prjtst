import { login } from '../auth.js';

export default {
  name: 'LoginView',
  data() {
    return {
      username: '',
      password: '',
      error: '',
      loading: false
    };
  },
  methods: {
    async submit() {
      this.error = '';
      this.loading = true;
      try {
        await login(this.username, this.password);
        const redirect = this.$route.query.redirect || '/dashboard';
        this.$router.push(redirect);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    }
  },
  template: `
    <div class="login-shell">
      <div class="login-card">
        <div class="login-brand">
          <svg width="40" height="40" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <ellipse cx="33" cy="47" rx="15" ry="12" fill="#c31f1f"/>
            <path d="M20 20 C16 15 17 9 21 6 C21 11 23 13 25 14 C25 9 28 5 33 4 C31 9 32 13 35 15 C38 11 43 10 47 12 C43 15 41 18 41 22 C46 21 51 24 52 29 C47 27 43 28 40 31 C42 34 41 38 38 40 L26 40 C21 40 17 36 17 31 C17 26 19 22 20 20 Z" fill="#181310"/>
            <circle cx="24" cy="21" r="1.6" fill="#f6f0e2"/>
            <path d="M13 26 L6 24 L13 22 Z" fill="#181310"/>
          </svg>
          <h1>CASPM</h1>
          <div class="tagline">Complexe Avicole · Connexion</div>
        </div>
        <form @submit.prevent="submit">
          <label>Nom d'utilisateur
            <input v-model="username" name="username" required autocomplete="username" autofocus>
          </label>
          <label>Mot de passe
            <input v-model="password" name="password" type="password" required autocomplete="current-password">
          </label>
          <button class="primary" type="submit" :disabled="loading">
            {{ loading ? 'Connexion…' : 'Se connecter' }}
          </button>
        </form>
        <div v-if="error" class="msg err show" style="margin-top:14px;">{{ error }}</div>
      </div>
    </div>
  `
};
