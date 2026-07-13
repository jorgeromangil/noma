import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { SubirProductoComponent } from './subir-producto.component';
import { ProductosService } from '../../services/productos.service';
import { AuthService } from '../../../../../layouts/auth-layout/auth.service';
import { MapProductsCacheService } from '../../../../../services/map-products-cache.service';

describe('SubirProductoComponent', () => {
  let component: SubirProductoComponent;
  let fixture: ComponentFixture<SubirProductoComponent>;
  let productosServiceSpy: jasmine.SpyObj<ProductosService>;

  beforeEach(async () => {
    localStorage.removeItem('borradores_productos');
    localStorage.removeItem('borradores_productos_admin');

    productosServiceSpy = jasmine.createSpyObj<ProductosService>(
      'ProductosService',
      ['obtenerMisProductos', 'obtenerProductosAdmin', 'crearProducto', 'uploadModel3d', 'comprimirImagen']
    );

    productosServiceSpy.obtenerMisProductos.and.returnValue(of({ ok: true, products: [] }));
    productosServiceSpy.obtenerProductosAdmin.and.returnValue(of({ ok: true, products: [] }));
    productosServiceSpy.crearProducto.and.returnValue(of({ product: { _id: 'prod-1' } }));

    await TestBed.configureTestingModule({
      imports: [SubirProductoComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ProductosService, useValue: productosServiceSpy },
        { provide: AuthService, useValue: { getToken: () => 'token-admin' } },
        { provide: MapProductsCacheService, useValue: jasmine.createSpyObj<MapProductsCacheService>('MapProductsCacheService', ['refreshCacheAfterMutation']) }
      ]
    }).compileComponents();

    const mapProductsCacheService = TestBed.inject(MapProductsCacheService) as jasmine.SpyObj<MapProductsCacheService>;
    mapProductsCacheService.refreshCacheAfterMutation.and.returnValue(of(null));

    fixture = TestBed.createComponent(SubirProductoComponent);
    fixture.componentRef.setInput('mode', 'admin');
    fixture.componentRef.setInput('availableArtisans', [
      {
        uid: 'artisan-1',
        name: 'Mario',
        surname: 'Moya',
        email: 'mario@noma.test',
        role: 'artisan',
        active: true,
        company_name: 'Taller Moya'
      }
    ]);

    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('requires selecting an artisan in admin mode', () => {
    const ownerControl = component.productoForm.get('owner');

    ownerControl?.setValue('');
    ownerControl?.markAsTouched();
    ownerControl?.updateValueAndValidity();

    expect(ownerControl?.hasError('required')).toBeTrue();
  });

  it('submits the selected owner in admin mode', () => {
    component.productoForm.patchValue({
      owner: 'artisan-1',
      name: 'Jarron azul',
      description: 'Pieza de ceramica artesanal',
      resumen: 'Resumen suficientemente largo para pasar las validaciones del formulario admin.',
      category: 'Otros',
      historia_origen: 'Historia amplia del producto con mas de veinte caracteres.',
      importancia_cultural: 'Importancia cultural descrita con suficiente detalle.',
      materias_primas: 'Arcilla local y esmaltes tradicionales de la zona.',
      proceso_elaboracion: 'Proceso manual explicado paso a paso con detalle suficiente.',
      tiempo_elaboracion: 'Entre dos y tres jornadas de trabajo.',
      certificaciones_protecciones: 'Sin certificación',
      address_text: 'Calle Mayor 23, Valencia, 28001',
      province: 'Valencia'
    });
    component.previsualizaciones = ['data:image/png;base64,abc123'];

    component.guardarProducto();

    expect(productosServiceSpy.crearProducto).toHaveBeenCalledWith(jasmine.objectContaining({
      owner: 'artisan-1',
      name: 'Jarron azul'
    }), 'token-admin');
  });

  it('shows success popup when saving draft and persists the 3D model file', async () => {
    spyOn(component.mostrarPopup, 'emit');

    component.productoForm.patchValue({
      owner: 'artisan-1',
      name: 'Borrador test'
    });
    component.model3dFile = new File(['glb-demo'], 'pieza.glb', { type: 'model/gltf-binary' });

    await component.guardarComoBorrador();

    const storedDrafts = JSON.parse(localStorage.getItem('borradores_productos_admin') || '[]');
    const savedDraft = storedDrafts[0];

    expect(component.mostrarPopup.emit).toHaveBeenCalledWith({
      title: '¡Éxito!',
      message: 'Borrador guardado correctamente.'
    });
    expect(savedDraft?.model3dFileRef).toContain('draft-model-');
  });

  it('opens unsaved-changes prompt before closing popup mode', () => {
    fixture.componentRef.setInput('popupMode', true);
    fixture.detectChanges();

    spyOn(component.cerrar, 'emit');
    component.productoForm.patchValue({
      owner: 'artisan-1',
      name: 'Producto sin guardar'
    });
    component.productoForm.markAsDirty();

    component.cerrarPopup();

    expect(component.showExitPrompt).toBeTrue();
    expect(component.cerrar.emit).not.toHaveBeenCalled();
  });
});
