import { Component, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { Router, RouterLink } from '@angular/router'; 
import { FormsModule } from '@angular/forms'; 
import { CommonModule, Location } from '@angular/common'; 
import { AuthService, AuthResponse, RegisterData } from '../../layouts/auth-layout/auth.service';
import { environment } from '../../../environments/environment';

declare var google: any; 

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [
    RouterLink,
    FormsModule, 
    CommonModule 
  ],
  templateUrl: './registro.html'
})
export class RegistroComponent implements OnInit, OnDestroy {
    
    public registerData: RegisterData = {
        name: '',
        surname: '', 
        email: '',
        password: '',
        company_name: '',
        description: '',
        address_text: '',
        contact: '',
        province: '',
        role: 'regular'
    };
    
    public isArtisan: boolean = false; 
    public errorMessage: string = ''; 
    public successMessage: string = ''; 
    public isSubmitting: boolean = false;
    public googleInitLoading: boolean = true;
    private googleRenderedButton: HTMLElement | null = null;

    constructor(
        private authService: AuthService,
        private router: Router,
        private location: Location,
        private cdr: ChangeDetectorRef
    ) { }

    register() {
        this.errorMessage = '';
        this.successMessage = '';
        if (this.isSubmitting) {
            return;
        }
        this.isSubmitting = true;
        this.registerData.role = this.isArtisan ? 'artisan' : 'regular';
        const dataToSend = { ...this.registerData };
        if (!this.isArtisan) {
            delete dataToSend.province;
        }
        this.authService.register(dataToSend)
            .subscribe({
                next: (resp: any) => {
                    this.isSubmitting = false;
                    if (resp.ok) {
                        this.successMessage = 'Usuario registrado con éxito. Accediendo...';
                        this.router.navigateByUrl('/home');
                    } else {
                        if (resp.errors && resp.errors.province) {
                            this.errorMessage = resp.errors.province.msg || 'Provincia inválida';
                        } else {
                            this.errorMessage = resp.msg || 'Error desconocido';
                        }
                        this.cdr.markForCheck();
                    }
                },
                error: (err: any) => {
                    this.isSubmitting = false;
                    if (err.error && err.error.errors && err.error.errors.province) {
                        this.errorMessage = err.error.errors.province.msg || 'Provincia inválida';
                    } else {
                        this.errorMessage = 'Ocurrió un error al intentar conectarse con el servidor.';
                    }
                    this.cdr.markForCheck();
                }
            });
    }

    goBack() {
        if (window.history.length > 1) {
            this.location.back();
        } else {
            this.router.navigateByUrl('/');
        }
    }



    ngOnInit() {
        this.initializeGoogleSignIn();
    }

    private initializeGoogleSignIn() {
        if (typeof google !== 'undefined' && google.accounts) {
            this.renderGoogleButton();
        } else {
            setTimeout(() => this.initializeGoogleSignIn(), 100);
        }
    }

    private renderGoogleButton() {
        google.accounts.id.initialize({
            client_id: environment.googleClientId,
            callback: (response: any) => this.handleGoogleSignIn(response)
        });

        const googleButtonDiv = document.getElementById('google-signin-btn-registro');
        if (googleButtonDiv) {
            google.accounts.id.renderButton(googleButtonDiv, {
                theme: 'outline',
                size: 'large',
                width: 320
            });
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
            setTimeout(() => this.captureGoogleButton(container), 80);
        }
    }

    triggerGoogleSignIn() {
        if (this.isArtisan) {
            return;
        }
        if (this.googleRenderedButton) {
            this.googleRenderedButton.click();
        } else {
            this.googleInitLoading = true;
            this.initializeGoogleSignIn();
        }
    }

    handleGoogleSignIn(response: any) {
        if (response.credential) {
            this.isSubmitting = true;
            this.authService.googleSignIn(response.credential)
                .subscribe({
                    next: (resp) => {
                        this.isSubmitting = false;
                        if (resp.ok) {
                            this.errorMessage = '';
                            this.successMessage = 'Acceso con Google exitoso';
                            this.cdr.markForCheck();
                            this.router.navigateByUrl('/home');
                        } else {
                            this.errorMessage = resp.msg || 'Error en Google Sign-In';
                            this.cdr.markForCheck();
                        }
                    },
                    error: (err) => {
                        this.isSubmitting = false;
                        this.errorMessage = err?.error?.msg || 'Error en Google Sign-In';
                        this.cdr.markForCheck();
                        console.error('Error Google Sign-In:', err);
                    }
                });
        }
    }

    ngOnDestroy(): void {
        // Popup eliminado, no hay timeout que limpiar
    }
}
