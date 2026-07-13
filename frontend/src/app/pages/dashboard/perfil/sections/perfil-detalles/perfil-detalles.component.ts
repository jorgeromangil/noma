import { Component, OnInit, Input, Output, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../../../../layouts/auth-layout/auth.service';
import { buildApiUrl } from '../../../../../shared/api-base';
import { PerfilFormService } from '../../services/perfil-form.service';
import { ProductosService } from '../../services/productos.service';

@Component({
  selector: 'app-perfil-detalles',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './perfil-detalles.component.html',
  styleUrl: './perfil-detalles.component.css'
})
export class PerfilDetallesComponent implements OnInit {
    public backendError: string = '';
  @Input() usuario: any = null;
  @Output() usuarioActualizado = new EventEmitter<any>();
  @Output() mostrarPopup = new EventEmitter<{title: string, message: string}>();

  perfilForm!: FormGroup;
  perfilFormDirty: boolean = false;
  loading: boolean = false;
  perfilSubmitted: boolean = false;
  previewImagenPerfil: string = '';
  private imagenPerfilBase64: string = '';

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private perfilFormService: PerfilFormService,
    private productosService: ProductosService
  ) {
    this.perfilForm = this.perfilFormService.crearPerfilForm();
  }

  ngOnInit(): void {
    if (this.usuario) {
      this.perfilFormService.rellenarPerfilForm(this.perfilForm, this.usuario);
      this.detectarCambios();
    }
  }

  ngOnChanges(): void {
    if (this.usuario && this.perfilForm) {
      this.perfilFormService.rellenarPerfilForm(this.perfilForm, this.usuario);
    }
  }

  detectarCambios() {
    this.perfilForm.valueChanges.subscribe(() => {
      this.perfilFormDirty = this.perfilForm.dirty;
    });
  }

  async onProfileImageSelected(event: any) {
    const file: File = event.target.files[0];
    if (file) {
      const base64Optimizada = await this.productosService.comprimirImagen(file);
      this.previewImagenPerfil = base64Optimizada;
      this.imagenPerfilBase64 = base64Optimizada;
      this.perfilFormDirty = true; // Marcar como dirty si cambia la imagen
      this.cdr.detectChanges();
    }
  }

  actualizarUsuario() {
    this.perfilSubmitted = true;
    this.backendError = '';
    if (this.perfilForm.invalid) {
      this.perfilForm.markAllAsTouched();
      return;
    }

    const uid = this.authService.uid;
    if (!uid) return;

    this.loading = true;
    const url = buildApiUrl(`users/${uid}`);
    const token = this.authService.getToken() || '';
    const headers = new HttpHeaders().set('x-token', token);

    const data = this.perfilFormService.construirPayloadActualizacion(
      this.perfilForm.value,
      this.imagenPerfilBase64
    );

    this.http.put(url, data, { headers }).subscribe({
      next: (resp: any) => {
        this.usuario = resp.user || resp.usuario;
        localStorage.setItem('usuario_cache', JSON.stringify({ uid, user: this.usuario }));
        this.imagenPerfilBase64 = '';
        this.previewImagenPerfil = '';
        this.loading = false;
        this.mostrarPopup.emit({
          title: '¡Actualizado!',
          message: 'Los campos se han actualizado correctamente.'
        });
        this.backendError = '';
        this.usuarioActualizado.emit(this.usuario);
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error(err);
        this.loading = false;
        // Mostrar error de provincia inválida
        if (err.error && err.error.errors && err.error.errors.province) {
          this.backendError = err.error.errors.province.msg || 'Provincia inválida';
        } else {
          this.backendError = err.error?.msg || 'No se han podido actualizar los campos.';
        }
        this.mostrarPopup.emit({
          title: 'Error',
          message: this.backendError
        });
        this.cdr.detectChanges();
      }
    });
  }
}
