import { Routes } from '@angular/router';
import { AuthLayout } from '../layouts/auth-layout/auth-layout'; 
import { LoginComponent } from './login/login';
import { RegistroComponent } from './registro/registro';

export const AUTH_ROUTES: Routes = [
    {
        path: '', 
        component: AuthLayout,
        children: [
            { path: 'login', component: LoginComponent, title: 'Login' },
            { path: 'registro', component: RegistroComponent, title: 'Registro' },
            { path: '', redirectTo: 'login', pathMatch: 'full' }
        ]
    }
];
