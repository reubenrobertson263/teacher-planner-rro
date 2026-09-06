// Legacy compatibility wrapper. Authentication is session-cookie based; user IDs are never bearer tokens.
window.api = {
  processLogin: () => window.app.handleLogin(),
  processRegister: () => window.app.handleRegister(),
  logout: () => window.app.logout()
};
