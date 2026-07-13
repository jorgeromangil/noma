import { Routes } from '@angular/router';
import { HomeComponent } from './home/home';
import { LandingComponent } from './dashboard/landing/landing';
import { AuthGuard } from '../guards/auth.guard';
import { NoAuthGuard } from '../guards/noauth.guard';
import { Perfil } from './dashboard/perfil/perfil';
import { ArtesanoPublicoComponent } from './artesano/artesano-publico';
import { PrivacyPolicy } from './legal/privacy-policy/privacy-policy';
import { CookiesPolicy } from './legal/cookies-policy/cookies-policy';
import { LegalNotice } from './legal/legal-notice/legal-notice';
import { DatosAbiertos } from './dashboard/landing/datos-abiertos/datos-abiertos';
import { ProductDetailComponent } from './product-detail/product-detail';

const externalRedirect = (url: string) => () => {
    if (typeof window !== 'undefined') window.location.href = url;
    return false;
};

export const PAGES_ROUTES: Routes = [
    {
        path: '',
        component: LandingComponent,
        title: 'Artesanía Española en el Mapa'
    },
    {
        path: 'landing',
        redirectTo: '',
        pathMatch: 'full'
    },
    {
        path: 'datos-abiertos',
        component: DatosAbiertos,
        title: 'Datos Abiertos sobre Artesanía'
    },
    {
        path: 'home',
        component: HomeComponent,
        title: 'Mapa Interactivo de Artesanía'
    },
    {
        path: 'artesano/:slug',
        component: ArtesanoPublicoComponent,
        title: 'Perfil de Artesano'
    },
    {
        path: 'perfil', 
        component: Perfil,
        canActivate: [AuthGuard], 
        title: 'Mi Perfil'
    },
    {
        path: 'mapa',
        redirectTo: 'home',
        pathMatch: 'full'
    },
    {
        path: 'privacy-policy',
        component: PrivacyPolicy,
        title: 'Política de Privacidad'
    },
    {
        path: 'cookies-policy',
        component: CookiesPolicy,
        title: 'Política de Cookies'
    },
    {
        path: 'legal-notice',
        component: LegalNotice,
        title: 'Aviso Legal'
    },
    {
        path: 'producto/:slug',
        component: ProductDetailComponent,
        title: 'Ficha de Producto Artesanal'
    },
    {
        path: 'syncro',
        canActivate: [externalRedirect('https://noma.ovh/syncro')],
        component: LandingComponent // nunca se renderiza, el guard redirige antes
    }
];
