// este archivo lo usa para producción (despliegue)

export const environment = {
  production: true,
  // En producción el backend expone todas las rutas bajo /api
  base_url: 'https://noma-ex30.onrender.com/api',
  // Ruta pública para modelos 3D (mismo dominio donde sirva la app)
  model3d_base_url: 'https://noma-ex30.onrender.com/assets3d/models',
  // Google OAuth Client ID
  googleClientId: '87293189860-5b4bm58nsrig8rj7ge722oa0svh4jsls.apps.googleusercontent.com'
};
