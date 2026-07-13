import { Routes } from '@angular/router';

export const routes: Routes = [
    
    // 1. HOME Y PÁGINAS PRINCIPALES (CON NAVBAR)
    {
        path: '', 
        loadChildren: () => import('./pages/pages.routes').then(m => m.PAGES_ROUTES)
    },
    
    // 2. AUTENTICACIÓN (SIN NAVBAR)
    {
        path: '', 
        loadChildren: () => import('./auth/auth.routes').then(m => m.AUTH_ROUTES)
    },
    

    // 3. Ruta comodín , redirige cualquier ruta desconocida a la ruta principal (Home)
    {
        path: '**',
        redirectTo: '', 
        pathMatch: 'full'
    }
];