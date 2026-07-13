import { Component, OnInit, ChangeDetectorRef, ViewChild, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../../layouts/auth-layout/auth.service';
import { RouterModule } from '@angular/router';
import { buildApiUrl } from '../../../shared/api-base';
import { PerfilDetallesComponent } from './sections/perfil-detalles/perfil-detalles.component';
import { MisProductosComponent } from './sections/mis-productos/mis-productos.component';
import { FavoritosComponent } from './sections/favoritos/favoritos.component';
import { SubirProductoComponent } from './sections/subir-producto/subir-producto.component';
import { EstadisticasComponent } from './sections/estadisticas/estadisticas.component';
import { EstadisticasAdminComponent } from './sections/estadisticas/estadisticas-admin.component';
import { ReportesComponent } from './sections/reportes/reportes.component';
import { AdminUsersComponent } from './sections/admin-users/admin-users.component';
import { AdminProductsComponent } from './sections/admin-products/admin-products.component';
import { Navbar } from '../../../commons/navbar/navbar';

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [
    CommonModule, 
    RouterModule, 
    PerfilDetallesComponent, 
    MisProductosComponent, 
    FavoritosComponent, 
    SubirProductoComponent, 
    EstadisticasComponent,
    EstadisticasAdminComponent,
    ReportesComponent,
    AdminUsersComponent,
    AdminProductsComponent,
    Navbar
  ],
  templateUrl: './perfil.html',
  styleUrl: './perfil.css',
  encapsulation: ViewEncapsulation.None
})
export class Perfil implements OnInit {
  public usuario: any = null;
  public loading: boolean = true;
  public errorMsg: string = '';
  
  public showPopup: boolean = false;
  public popupTitle: string = '';
  public popupMessage: string = '';
  public showProductExitPrompt: boolean = false;
  private pendingSectionAfterExitPrompt: string | null = null;
  
  public seccionActiva: string = 'perfil';
  @ViewChild(SubirProductoComponent) subirProductoComponent?: SubirProductoComponent;
  
  public isLoggedIn$: any;
  private isLoggedInSub: any;
  private autenticado: boolean = false;

  public roleNames: { [key: string]: string } = {
    'admin': 'Admin',
    'regular': 'Nómada',
    'artisan': 'Artesano'
  };

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {
    this.isLoggedIn$ = this.authService.isLoggedIn$;
  }

  ngOnInit(): void {
    // Restaurar sección activa si existe en localStorage (solo si está definido)
    if (typeof localStorage !== 'undefined') {
      const lastSection = localStorage.getItem('perfil_seccion_activa');
      const normalizedLastSection = lastSection === 'crear-usuario' ? 'usuarios' : lastSection;
      if (normalizedLastSection) {
        this.seccionActiva = normalizedLastSection;
      }
    }
    // Suscribirse a cambios de autenticación
    this.isLoggedInSub = this.isLoggedIn$.subscribe((logged: boolean) => {
      this.autenticado = logged;
      if (logged) {
        // Limpiar caché si el usuario cambió
        let usuarioCacheRaw = null;
        if (typeof localStorage !== 'undefined') {
          usuarioCacheRaw = localStorage.getItem('usuario_cache');
        }
        const currentUid = this.authService.uid;
        let cacheParsed = null;
        let cachedUser = null;
        let cachedUid = null;
        if (usuarioCacheRaw && currentUid) {
          try {
            cacheParsed = JSON.parse(usuarioCacheRaw);
            cachedUser = cacheParsed?.user || cacheParsed;
            cachedUid = cacheParsed?.uid || cachedUser?._id || cachedUser?.uid;
          } catch (e) {
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem('usuario_cache');
            }
          }
        }
        if (!cachedUid || cachedUid !== currentUid) {
          // Si el usuario cambió, limpiar caché y estado
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('usuario_cache');
          }
          this.usuario = null;
        } else {
          this.usuario = cachedUser;
        }
        this.loading = false;
        this.cargarPerfil();
        this.cdr.detectChanges();
      } else {
        // Al cerrar sesión, limpiar caché y estado
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('usuario_cache');
        }
        this.usuario = null;
        this.loading = false;
        this.errorMsg = 'No autenticado.';
        this.cdr.detectChanges();
      }
    });
  }
  setSeccionActiva(seccion: string) {
    if (seccion === this.seccionActiva) {
      return;
    }

    if (this.shouldPromptProductExit(seccion)) {
      this.openProductExitPrompt(seccion);
      return;
    }

    this.activateSection(seccion);
  }

  private shouldPromptProductExit(destinationSection: string): boolean {
    if (this.seccionActiva !== 'producto' || destinationSection === 'producto') {
      return false;
    }

    return !!this.subirProductoComponent?.tieneCambiosSinGuardar();
  }

  private openProductExitPrompt(destinationSection: string): void {
    this.pendingSectionAfterExitPrompt = destinationSection;
    this.showProductExitPrompt = true;
    this.cdr.detectChanges();
  }

  closeProductExitPrompt(): void {
    this.showProductExitPrompt = false;
    this.pendingSectionAfterExitPrompt = null;
    this.cdr.detectChanges();
  }

  keepEditingProduct(): void {
    this.closeProductExitPrompt();
  }

  async saveDraftAndLeaveProduct(): Promise<void> {
    await this.subirProductoComponent?.guardarComoBorrador();
    this.leaveProductAndContinueNavigation();
  }

  leaveProductWithoutSaving(): void {
    this.leaveProductAndContinueNavigation();
  }

  private leaveProductAndContinueNavigation(): void {
    const destinationSection = this.pendingSectionAfterExitPrompt;
    this.showProductExitPrompt = false;
    this.pendingSectionAfterExitPrompt = null;

    if (destinationSection) {
      this.activateSection(destinationSection);
    }

    this.cdr.detectChanges();
  }

  private activateSection(seccion: string): void {
    this.seccionActiva = seccion;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('perfil_seccion_activa', seccion);
    }
  }

  cargarPerfil() {
    if (!this.autenticado) {
      this.loading = true;
      return;
    }
    if (!this.usuario) {
      this.loading = true;
    }
    this.errorMsg = '';
    const uid = this.authService.uid;
    if (!uid) {
      this.errorMsg = 'No se pudo identificar al usuario.';
      this.loading = false;
      return;
    }
    const url = buildApiUrl(`users/${uid}`);
    const token = this.authService.getToken() || '';
    const headers = new HttpHeaders().set('x-token', token);
    this.http.get<any>(url, { headers }).subscribe({
      next: (resp) => {
        if (resp.ok && resp.users && resp.users.length > 0) {
          this.usuario = resp.users[0];
          localStorage.setItem('usuario_cache', JSON.stringify({ uid, user: this.usuario }));
        } else {
          if (!this.usuario) this.errorMsg = 'No se encontraron datos.';
        }
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error("Error HTTP:", err);
        if (!this.usuario) {
          this.errorMsg = 'Error de conexión con el servidor';
        }
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }
  ngOnDestroy(): void {
    if (this.isLoggedInSub) {
      this.isLoggedInSub.unsubscribe();
    }
  }

  closePopup() {
    this.showPopup = false;
    this.cdr.detectChanges();
  }

  // Helpers de sección activa
  get tituloSeccion(): string {
    const mapa: any = {
      'perfil': 'Detalles del perfil',
      'mis-productos': 'Mis productos',
      'estadisticas': 'Estadísticas',
      'favoritos': 'Favoritos',
      'producto': 'Subir producto',
      'productos-admin': 'Productos',
      'usuarios': 'Usuarios',
      'estadisticas-admin': 'Estadísticas globales',
      'reportes': 'Productos reportados',
      'reportes-aceptados': 'Reportes aceptados'
    };
    return mapa[this.seccionActiva] || '';
  }

  onMostrarPopup(event: {title: string, message: string}) {
    this.popupTitle = event.title;
    this.popupMessage = event.message;
    this.showPopup = true;
    this.cdr.detectChanges();
  }

  onProductoCreadoExitosamente() {
    this.activateSection('mis-productos');
    this.cdr.detectChanges();
  }
  onUsuarioActualizado(usuario: any) {
    this.usuario = usuario;
    this.cdr.detectChanges();
  }

  logOut() {
    this.authService.logOut();
  }
}
