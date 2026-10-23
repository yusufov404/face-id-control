/* Deployment override for the API base URL.
 *
 * Production (Nginx, same origin): leave as '/api/v1'.
 * Local development (frontend on :8080, backend on :8000) set:
 *   window.FACESYS_API_BASE = 'http://localhost:8000/api/v1';
 * The backend's default CORS_ALLOW_ORIGINS already permits localhost:8080.
 */
window.FACESYS_API_BASE = window.FACESYS_API_BASE || '/api/v1';
