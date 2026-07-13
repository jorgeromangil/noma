import { Injectable, Inject, PLATFORM_ID, NgZone } from '@angular/core'; 
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router'; 
import { Observable, tap, catchError, of, BehaviorSubject, map } from 'rxjs'; 
import { buildApiUrl } from '../../shared/api-base';

export interface AuthUser {
    uid?: string;
    role: string;
    active?: boolean;
}

export interface AuthResponse {
    ok: boolean;
    msg: string;
    token?: string;
    code?: string;
    user?: AuthUser;
    errors?: any;
}

export interface RegisterData {
    name: string;
    surname: string;
    email: string;
    password: string;
    role: string;
    company_name?: string;
    description?: string;
    address_text?: string;
    contact?: string;
    city?: string;
    province?: string;
}

@Injectable({
    providedIn: 'root'
})

export class AuthService {
    private readonly disabledNoticeKey = 'auth_disabled_notice';
    private _isLoggedIn: BehaviorSubject<boolean>;
    private _role: string = '';
    public get rol(): string { return this._role; }

    public get isLoggedIn$(): Observable<boolean> {
        return this._isLoggedIn.asObservable();
    }

    get uid(): string {
        const token = this.getToken();
        if (!token || !this.isBrowser) return '';

        try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));

        const payload = JSON.parse(jsonPayload);
        return payload.uid || payload._id || ''; 
        } catch (error) {
        console.error('Error desencriptando el UID del token');
        return '';
        }
    }
    
    constructor(
        private http: HttpClient, 
        private router: Router,
        @Inject(PLATFORM_ID) private platformId: Object,
        private ngZone: NgZone
    ) { 
        const token = this.getToken();
        this._isLoggedIn = new BehaviorSubject<boolean>(!!token);

        // Listener de cambios en localStorage (token)
        if (isPlatformBrowser(this.platformId)) {
            window.addEventListener('storage', (event) => {
                if (event.key === 'token') {
                    const newToken = event.newValue;
                    if (!newToken) {
                        // Token eliminado en otra pestaña o manualmente
                        this.logOut();
                    }
                }
            });
        }
    }

    private get isBrowser(): boolean {
        return isPlatformBrowser(this.platformId);
    }

    getToken(): string | null {
        // Siempre intentar leer de localStorage si existe
        try {
            if (this.isBrowser) {
                return localStorage.getItem('token');
            }
        } catch (e) {
            // Silenciar error
        }
        return null;
    }

    private guardarToken(token: string) {
        if (this.isBrowser) {
            localStorage.setItem('token', token);
        }
    }

    private clearUserCache() {
        if (this.isBrowser) {
            localStorage.removeItem('usuario_cache');
        }
    }
    
    private eliminarToken() {
        if (this.isBrowser) {
            localStorage.removeItem('token');
        }
    }

    private clearAuthState() {
        this.eliminarToken();
        this.clearUserCache();
        if (this.isBrowser) {
            localStorage.removeItem('perfil_seccion_activa');
        }
        this._role = '';
        this._isLoggedIn.next(false);
    }

    private buildAuthHeaders(token?: string | null): HttpHeaders {
        return new HttpHeaders().set('x-token', token || this.getToken() || '');
    }

    private applyAuthSuccess(resp: AuthResponse) {
        if (resp.ok && resp.token) {
            this.clearUserCache();
            this.guardarToken(resp.token);
            this._role = resp.user?.role || '';
            this._isLoggedIn.next(true);
        }
    }

    private storeDisabledAccountNotice(message?: string) {
        if (!this.isBrowser) {
            return;
        }
        sessionStorage.setItem(
            this.disabledNoticeKey,
            message || 'Tu cuenta está desactivada. Contacta con administración.'
        );
    }

    consumeDisabledAccountNotice(): string {
        if (!this.isBrowser) {
            return '';
        }
        const message = sessionStorage.getItem(this.disabledNoticeKey) || '';
        if (message) {
            sessionStorage.removeItem(this.disabledNoticeKey);
        }
        return message;
    }

    handleDisabledAccount(message?: string, redirectToLogin: boolean = true) {
        this.storeDisabledAccountNotice(message);
        this.logOut(redirectToLogin);
    }

    login(email: string, password: string): Observable<AuthResponse> {
        const url = buildApiUrl('auth/login'); 
        
        return this.http.post<AuthResponse>(url, { email, password })
            .pipe(
                tap((resp: AuthResponse) => this.applyAuthSuccess(resp)),
                catchError(err => of({
                    ok: false,
                    code: err?.error?.code,
                    msg: err?.error?.msg || 'Error en el login'
                }))
            );
    }

    register(registerData: RegisterData): Observable<AuthResponse> {
        const url = buildApiUrl('auth/register'); 
        
        return this.http.post<AuthResponse>(url, registerData)
            .pipe(
                tap((resp: AuthResponse) => this.applyAuthSuccess(resp)),
                catchError(err => {
                    console.error('Error en registro', err);
                    // Devuelve todos los errores del backend
                    return of({
                        ok: false,
                        code: err?.error?.code,
                        msg: err.error?.msg || 'Error de conexión',
                        errors: err.error?.errors
                    });
                })
            );
    }

    googleSignIn(idToken: string): Observable<AuthResponse> {
        const url = buildApiUrl('auth/google');
        
        return this.http.post<AuthResponse>(url, { id_token: idToken })
            .pipe(
                tap((resp: AuthResponse) => this.applyAuthSuccess(resp)),
                catchError(err => {
                    console.error('Error en Google Sign-In', err);
                    return of({
                        ok: false,
                        code: err?.error?.code,
                        msg: err.error?.msg || 'Error en Google Sign-In'
                    });
                })
            );
    }
    
    validarToken(): Observable<boolean> {
        const token = this.getToken();
        if (!token || token === 'undefined') {
            this.clearAuthState();
            return of(false);
        }

        return this.http.get<AuthResponse>(buildApiUrl('auth/validate'), {
            headers: this.buildAuthHeaders(token)
        }).pipe(
            tap((resp) => {
                this._role = resp.user?.role || '';
                this._isLoggedIn.next(true);
            }),
            map((resp) => !!resp.ok),
            catchError((err) => {
                if (err?.error?.code === 'USER_DISABLED') {
                    this.storeDisabledAccountNotice(err?.error?.msg);
                }
                this.clearAuthState();
                return of(false);
            })
        );
    }

    validarNoToken(): Observable<boolean> {
        return this.validarToken().pipe(
            map(estaAutenticado => !estaAutenticado)
        );
    }

    logOut(redirectToLogin: boolean = true) {
        // Ejecutar siempre dentro de la zona de Angular para refrescar la UI
        this.ngZone.run(() => {
            this.clearAuthState();
            if (redirectToLogin) {
                this.router.navigateByUrl('/login');
            }
        });
    }
}
