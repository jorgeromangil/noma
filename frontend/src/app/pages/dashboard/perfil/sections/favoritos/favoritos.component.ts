import { Component, Input, Output, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { CustomTooltipDirective } from '../../../../../shared/custom-tooltip.directive';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../../../layouts/auth-layout/auth.service';
import { ProductosService } from '../../services/productos.service';
import { FavoritesService } from '../../../../../services/favorites.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-favoritos',
  standalone: true,
  imports: [CommonModule, RouterModule, CustomTooltipDirective],
  templateUrl: './favoritos.component.html',
  styleUrl: './favoritos.component.css'
})
export class FavoritosComponent {
  @Output() mostrarPopup = new EventEmitter<{title: string, message: string}>();

  favoritos: any[] = [];
  favoritosFiltrados: any[] = [];
  favoritosLoading: boolean = false;
  favoritosError: string = '';
  private favoritosCargados: boolean = false;
  private favoritesSubscription: Subscription | null = null;

  constructor(
    private authService: AuthService,
    private productosService: ProductosService,
    private favoritesService: FavoritesService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.obtenerFavoritos();
    
    if (this.favoritesService) {
      this.favoritesSubscription = this.favoritesService.favoritesChanged$.subscribe(() => {
        this.favoritosCargados = false;
        this.obtenerFavoritos();
      });
    }
  }

  obtenerFavoritos() {
    if (this.favoritosCargados && !this.favoritosError) {
      return;
    }

    this.favoritosLoading = true;
    this.favoritosError = '';
    const token = this.authService.getToken() || '';

    this.productosService.obtenerFavoritos(token).subscribe({
      next: (resp) => {
        if (resp.ok) {
          this.favoritos = resp.favorites || [];
          this.favoritosFiltrados = [...this.favoritos];
          this.favoritosCargados = true;
        } else {
          this.favoritosError = resp.msg || 'No se pudieron cargar los favoritos.';
          this.favoritosCargados = false;
        }
        this.favoritosLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al cargar favoritos:', err);
        this.favoritosError = err.error?.msg || 'Error de conexión con el servidor';
        this.favoritosCargados = false;
        this.favoritosLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  buscarFavoritos(event: any) {
    const texto = event.target.value.toLowerCase().trim();
    if (texto.length === 0) {
      this.favoritosFiltrados = [...this.favoritos];
    } else {
      this.favoritosFiltrados = this.favoritos.filter(prod =>
        (prod.name || '').toLowerCase().includes(texto)
      );
    }
    this.cdr.detectChanges();
  }

  eliminarFavorito(productId: string, event?: Event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    if (!productId) return;

    const token = this.authService.getToken() || '';

    this.productosService.eliminarFavorito(productId, token).subscribe({
      next: (resp) => {
        if (resp.ok) {
          this.favoritos = resp.favorites || [];
          this.favoritosFiltrados = [...this.favoritos];
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al eliminar favorito:', err);
        this.cdr.detectChanges();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.favoritesSubscription) {
      this.favoritesSubscription.unsubscribe();
    }
  }
}
