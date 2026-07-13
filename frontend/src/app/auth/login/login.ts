// src/app/auth/login/login.ts
import { Component, ChangeDetectorRef, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router'; // Importar Router
import { FormsModule } from '@angular/forms'; // Importar FormsModule
import { CommonModule, Location } from '@angular/common'; // <-- ¡IMPORTAR ESTO!
import { AuthService } from '../../layouts/auth-layout/auth.service'; // Importar el servicio
import { environment } from '../../../environments/environment';

declare var google: any;

@Component({
  selector: 'app-login',
  standalone: true, // Asumo que es standalone
  imports: [
    RouterLink,
    FormsModule, // Añadir FormsModule para usar ngModel
    CommonModule // <--- ¡AÑADIR ESTO!
  ],
  templateUrl: './login.html'
})
export class LoginComponent implements OnInit {

    // 1. Variables para enlazar con los campos del formulario
    public loginData = {
        email: '',
        password: ''
    };
    public errorMessage: string = '';
    public showError: boolean = false;
    public isLoading: boolean = false;
    public googleInitLoading: boolean = true;
    public showDisabledPopup: boolean = false;
    public disabledPopupMessage: string = '';
    private googleRenderedButton: HTMLElement | null = null;

    // Inyectamos el servicio y el Router
    constructor(
        private authService: AuthService,
        private router: Router,
        private location: Location,
        private cdr: ChangeDetectorRef
    ) { }

    ngOnInit() {
        // Esperar a que el SDK de Google esté completamente cargado
        const disabledNotice = this.authService.consumeDisabledAccountNotice();
        if (disabledNotice) {
            this.openDisabledPopup(disabledNotice);
        }
        this.initializeGoogleSignIn();
    }

    private initializeGoogleSignIn() {
        // Verificar si el SDK de Google está disponible
        if (typeof google !== 'undefined' && google.accounts) {
            this.renderGoogleButton();
        } else {
            // Si no está disponible, esperar un poco y volver a intentar
            setTimeout(() => this.initializeGoogleSignIn(), 100);
        }
    }

    private renderGoogleButton() {
        google.accounts.id.initialize({
            client_id: environment.googleClientId,
            callback: (response: any) => this.handleGoogleSignIn(response)
        });

        // Renderizar el botón de Google
        const googleButtonDiv = document.getElementById('google-signin-btn');
        if (googleButtonDiv) {
            google.accounts.id.renderButton(googleButtonDiv, {
                theme: 'outline',
                size: 'large',
                width: 320
            });

            // Guardar referencia al botón renderizado para dispararlo desde el botón custom
            this.captureGoogleButton(googleButtonDiv);
        }
    }

    private captureGoogleButton(container: HTMLElement) {
        const candidate = container.querySelector('[role="button"]') as HTMLElement | null;
        if (candidate) {
            this.googleRenderedButton = candidate;
            this.googleInitLoading = false;
            this.cdr.markForCheck();
        } else {
            // Reintenta brevemente por si el iframe tardó en renderizar
            setTimeout(() => this.captureGoogleButton(container), 80);
        }
    }

    triggerGoogleSignIn() {
        if (this.googleRenderedButton) {
            this.googleRenderedButton.click();
        } else {
            // Intentar inicializar nuevamente por si aún no cargó el SDK
            this.googleInitLoading = true;
            this.initializeGoogleSignIn();
        }
    }

    handleGoogleSignIn(response: any) {
        if (response.credential) {
            this.isLoading = true;
            this.authService.googleSignIn(response.credential)
                .subscribe({
                    next: (resp) => {
                        this.isLoading = false;
                        if (resp.ok) {
                            this.errorMessage = '';
                            this.showError = false;
                            this.cdr.markForCheck();
                            this.router.navigateByUrl('/home');
                        } else {
                            if (resp.code === 'USER_DISABLED') {
                                this.openDisabledPopup(resp.msg);
                            } else {
                                this.errorMessage = resp.msg || 'Error en Google Sign-In';
                                this.showError = true;
                            }
                            this.cdr.markForCheck();
                        }
                    },
                    error: (err) => {
                        this.isLoading = false;
                        this.errorMessage = err?.error?.msg || 'Error en Google Sign-In';
                        this.showError = true;
                        this.cdr.markForCheck();
                        console.error('Error Google Sign-In:', err);
                    }
                });
        }
    }

    // 2. Función que se ejecuta al enviar el formulario
    login() {
        this.errorMessage = '';
        this.showError = false;
        if (this.loginData.password.length < 6) {
            this.errorMessage = 'La contraseña debe tener al menos 6 caracteres';
            this.showError = true;
            this.cdr.markForCheck();
            return;
        }
        this.isLoading = true;
        this.authService.login(this.loginData.email, this.loginData.password)
            .subscribe({
                    next: (resp) => {
                        this.isLoading = false;
                        if (resp.ok) {
                            this.errorMessage = '';
                            this.showError = false;
                            this.cdr.markForCheck();
                            this.router.navigateByUrl('/home');
                        } else {
                            if (resp.code === 'USER_DISABLED') {
                                this.openDisabledPopup(resp.msg);
                            } else {
                                this.errorMessage = resp.msg || 'Credenciales incorrectas';
                                this.showError = true;
                            }
                            this.cdr.markForCheck();
                        }
                },
                error: (err) => {
                    this.isLoading = false;
                    this.errorMessage = err?.error?.msg || 'Ocurrió un error al intentar iniciar sesión.';
                    this.showError = true;
                    this.cdr.markForCheck();
                }
            });
    }

    openDisabledPopup(message?: string) {
        this.disabledPopupMessage = message || 'Tu cuenta está desactivada. Contacta con administración.';
        this.showDisabledPopup = true;
        this.showError = false;
        this.errorMessage = '';
    }

    closeDisabledPopup() {
        this.showDisabledPopup = false;
    }





    goBack() {
        if (window.history.length > 1) {
            this.location.back();
        } else {
            this.router.navigateByUrl('/');
        }
    }
}
