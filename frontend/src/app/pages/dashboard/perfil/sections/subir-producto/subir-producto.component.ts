import { DireccionSelectorModalComponent, DireccionOpcion } from '../../../../../shared/direccion-selector-modal.component';

import { Component, Input, Output, EventEmitter, ChangeDetectorRef, AfterViewInit, OnDestroy, OnInit, OnChanges, SimpleChanges, ViewChild, ElementRef, HostListener } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CustomTooltipDirective } from '../../../../../shared/custom-tooltip.directive';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../../../layouts/auth-layout/auth.service';
import { ProductosService } from '../../services/productos.service';
import { PerfilFormService } from '../../services/perfil-form.service';
import { NgSelectModule } from '@ng-select/ng-select';
import { MapProductsCacheService } from '../../../../../services/map-products-cache.service';
import { Subscription } from 'rxjs';
import { AdminManagedUser } from '../../services/admin-users.service';
import { CERTIFICATION_OPTIONS, CertificationOption } from '../../../../../shared/certification-labels';

interface DraftModel3dFile {
  name: string;
  type: string;
  lastModified: number;
  dataUrl: string;
}

interface ProductoBorrador {
  form: any;
  previsualizaciones: string[];
  fecha: string;
  model3dFileRef?: string | null;
}

@Component({
  selector: 'app-subir-producto',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CustomTooltipDirective, NgSelectModule, DireccionSelectorModalComponent],
  templateUrl: './subir-producto.component.html',
  styleUrl: './subir-producto.component.css'
})
export class SubirProductoComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  readonly MAX_FOTOS = 7;
  autoFillLocationLoading: boolean = false;
  mostrarSelectorDireccion = false;
  opcionesDireccion: DireccionOpcion[] = [];
  direccionSeleccionada: DireccionOpcion | null = null;

  onDireccionSeleccionada(opcion: DireccionOpcion) {
    this.mostrarSelectorDireccion = false;
    this.direccionSeleccionada = opcion;
    // Reintentar guardar el producto usando la dirección seleccionada
    this.guardarProducto(true);
  }

  onCancelarDireccion() {
    this.mostrarSelectorDireccion = false;
    this.direccionSeleccionada = null;
    this.loading = false;
    this.submitNotice = null;
  }
  @Input() usuario: any = null;
  @Input() mode: 'artisan' | 'admin' = 'artisan';
  @Input() popupMode: boolean = false;
  @Input() availableArtisans: AdminManagedUser[] = [];
  @Output() mostrarPopup = new EventEmitter<{title: string, message: string}>();
  @Output() cerrar = new EventEmitter<void>();
  @Output() productoCreadoExitosamente = new EventEmitter<void>();

  categorias: string[] = [
    'Alimentación',
    'Textil',
    'Barro y Alfarería',
    'Madera y mueble',
    'Otros'
  ];

  certificaciones: CertificationOption[] = CERTIFICATION_OPTIONS;

  productoForm!: FormGroup;
  previsualizaciones: string[] = [];
  private archivosSeleccionados: File[] = [];
  loading: boolean = false;
  model3dFile: File | null = null;
  model3dProgress: number | null = null;
  model3dError: string | null = null;
  submitNotice: string | null = null;
  @ViewChild('model3dPreview') model3dPreviewRef?: ElementRef<HTMLDivElement>;
  private previewRenderer: THREE.WebGLRenderer | null = null;
  private previewScene: THREE.Scene | null = null;
  private previewCamera: THREE.PerspectiveCamera | null = null;
  private previewModel: THREE.Object3D | null = null;
  private previewControls: OrbitControls | null = null;
  private previewAnimationId: number | null = null;
  previewObjectUrl: string | null = null;
  private previewArrayBuffer: ArrayBuffer | null = null;

  draggedIndex: number | null = null;

  borradores: any[] = [];
  mostrarListaBorradores: boolean = false;
  borradorEditandoIndex: number|null = null;

  readonly MAX_PRODUCTOS = 20;
  private readonly draftModelDbName = 'subir_producto_draft_models';
  private readonly draftModelStoreName = 'model_files';
  limitAlcanzado: boolean = false;
  loadingLimit: boolean = true;
  showExitPrompt: boolean = false;
  private limiteAvisado: boolean = false;
  artisanOptions: Array<AdminManagedUser & { displayLabel: string }> = [];
  private ownerChangesSub: Subscription | null = null;

  get productoTieneImagenes(): boolean {
    return this.archivosSeleccionados.length > 0 || this.previsualizaciones.length > 0;
  }

  get isAdminMode(): boolean {
    return this.mode === 'admin';
  }

  get submitButtonLabel(): string {
    if (this.loading) {
      return this.isAdminMode ? 'Creando...' : 'Publicando...';
    }

    return this.isAdminMode ? 'Crear producto' : 'Subir producto';
  }

  get sectionTitle(): string {
    return this.isAdminMode ? 'Crear producto' : 'Subir producto';
  }

  get limitReachedMessage(): string {
    return this.isAdminMode
      ? `El artesano seleccionado ya tiene ${this.MAX_PRODUCTOS} productos. Elimina uno en Productos para poder crear otro.`
      : `Ya tienes ${this.MAX_PRODUCTOS} productos publicados. Elimina uno en "Mis productos" para poder subir otro.`;
  }

  private get draftStorageKey(): string {
    return this.isAdminMode ? 'borradores_productos_admin' : 'borradores_productos';
  }

  constructor(
    private authService: AuthService,
    private productosService: ProductosService,
    private mapProductsCacheService: MapProductsCacheService,
    private perfilFormService: PerfilFormService,
    private cdr: ChangeDetectorRef
  ) {
    this.productoForm = this.perfilFormService.crearProductoForm();
    this.cargarBorradores(false);
  }

  ngOnInit(): void {
    this.configureModeSpecificControls();
    this.rebuildArtisanOptions();
    this.bindOwnerChanges();
    this.cargarBorradores(false);
    this.verificarLimiteProductos();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['mode']) {
      this.configureModeSpecificControls();
      this.bindOwnerChanges();
      this.cargarBorradores();
    }

    if (changes['availableArtisans']) {
      this.rebuildArtisanOptions();
      this.ensureSelectedOwnerIsValid();
    }

    if (changes['usuario']?.currentValue) {
      this.verificarLimiteProductos();
    }
  }

  verificarLimiteProductos(retryCount: number = 0) {
    if (this.isAdminMode) {
      const ownerId = String(this.productoForm.get('owner')?.value || '').trim();
      if (!ownerId) {
        this.limitAlcanzado = false;
        this.loadingLimit = false;
        this.limiteAvisado = false;
        this.cdr.detectChanges();
        return;
      }
    }

    const token = this.authService.getToken() || '';

    if (!token || token === 'undefined') {
      if (retryCount < 3) {
        setTimeout(() => this.verificarLimiteProductos(retryCount + 1), 300);
        return;
      }
      this.loadingLimit = false;
      this.cdr.detectChanges();
      return;
    }

    this.loadingLimit = true;
    const limitRequest$ = this.isAdminMode
      ? this.productosService.obtenerProductosAdmin(token, {
          owner: String(this.productoForm.get('owner')?.value || '').trim()
        })
      : this.productosService.obtenerMisProductos(token);

    limitRequest$.subscribe({
      next: (resp) => {
        if (resp?.ok) {
          const products = Array.isArray(resp.products) ? resp.products : [];
          this.limitAlcanzado = products.length >= this.MAX_PRODUCTOS;
          if (this.limitAlcanzado && !this.limiteAvisado) {
            this.mostrarPopup.emit({
              title: 'Límite alcanzado',
              message: this.limitReachedMessage
            });
            this.limiteAvisado = true;
          }
          if (!this.limitAlcanzado) {
            this.limiteAvisado = false;
          }
        }
        this.loadingLimit = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loadingLimit = false;
        this.cdr.detectChanges();
      }
    });
  }

  ngAfterViewInit(): void {
    // no-op, preview rendered on selection
  }

  ngOnDestroy(): void {
    this.ownerChangesSub?.unsubscribe();
    this.disposePreview();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.tieneCambiosSinGuardar()) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  }

  async onFileSelected(event: any) {
    const files: FileList = event.target.files;
    if (files) {
      const fotosRestantes = this.MAX_FOTOS - this.previsualizaciones.length;
      if (fotosRestantes <= 0) {
        this.mostrarPopup.emit({
          title: 'Límite de fotos',
          message: `Solo puedes subir hasta ${this.MAX_FOTOS} fotos por producto.`
        });
        return;
      }
      const filesToAdd = Array.from(files).slice(0, fotosRestantes);
      const startIndex = this.archivosSeleccionados.length;
      for (let i = 0; i < filesToAdd.length; i++) {
        this.archivosSeleccionados.push(filesToAdd[i]);
      }
      const previewsToAdd = Array(filesToAdd.length).fill(null);
      this.previsualizaciones.push(...previewsToAdd);
      for (let i = 0; i < filesToAdd.length; i++) {
        const previewIndex = startIndex + i;
        const reader = new FileReader();
        reader.onload = (e: any) => {
          this.previsualizaciones[previewIndex] = e.target.result;
          this.cdr.detectChanges();
        };
        reader.readAsDataURL(filesToAdd[i]);

        this.productosService.comprimirImagen(filesToAdd[i]).then(base64Optimizada => {
          this.previsualizaciones[previewIndex] = base64Optimizada;
          this.cdr.detectChanges();
        });
      }
      if (files.length > filesToAdd.length) {
        this.mostrarPopup.emit({
          title: 'Límite de fotos',
          message: `Solo puedes subir hasta ${this.MAX_FOTOS} fotos por producto.`
        });
      }
    }
  }

  onModel3dSelected(event: any) {
    this.model3dError = null;
    const file: File | null = event?.target?.files?.[0] || null;
    if (!file) {
      this.model3dFile = null;
      return;
    }
    const maxBytes = 100 * 1024 * 1024; // 100MB client-side guard
    const extOk = file.name.toLowerCase().endsWith('.glb');
    if (!extOk) {
      this.model3dError = 'Solo se aceptan archivos .glb';
      this.model3dFile = null;
      return;
    }
    if (file.size > maxBytes) {
      this.model3dError = 'El archivo supera 100MB';
      this.model3dFile = null;
      return;
    }
    this.model3dFile = file;

    // Render preview immediately
    if (this.previewObjectUrl) {
      URL.revokeObjectURL(this.previewObjectUrl);
    }
    this.previewObjectUrl = URL.createObjectURL(file);
    const reader = new FileReader();
    reader.onload = () => {
      this.previewArrayBuffer = reader.result as ArrayBuffer;
      setTimeout(() => this.renderModel3dPreview(undefined, this.previewArrayBuffer!), 0);
    };
    reader.onerror = () => setTimeout(() => this.renderModel3dPreview(this.previewObjectUrl!), 0);
    reader.readAsArrayBuffer(file);
  }

  clearModelSelection(event?: Event) {
    if (event) event.stopPropagation();
    if (this.previewObjectUrl) {
      URL.revokeObjectURL(this.previewObjectUrl);
      this.previewObjectUrl = null;
    }
    this.previewArrayBuffer = null;
    this.model3dFile = null;
    this.model3dProgress = null;
    this.model3dError = null;
    this.disposePreview();
    this.cdr.detectChanges();
  }

  async guardarComoBorrador(): Promise<void> {
    const nombre = this.productoForm.value.name?.trim();
    let draftUpdated = false;
    let previousModelRef: string | null = null;
    const borrador: ProductoBorrador = {
      form: this.productoForm.getRawValue(),
      previsualizaciones: [...this.previsualizaciones],
      fecha: new Date().toISOString(),
      model3dFileRef: null
    };
    if (this.model3dFile) {
      borrador.model3dFileRef = await this.storeDraftModel3dFile(this.model3dFile);
    }

    const borradores = this.readDrafts();
    if (nombre) {
      // Si ya existe un borrador con ese nombre, reemplázalo
      const idx = borradores.findIndex((b: ProductoBorrador) => (b.form?.name || '').trim() === nombre);
      if (idx !== -1) {
        previousModelRef = borradores[idx]?.model3dFileRef || null;
        borradores[idx] = borrador;
        draftUpdated = true;
      } else {
        borradores.push(borrador);
      }
    } else {
      // Si no hay nombre, simplemente añade el borrador
      borradores.push(borrador);
    }

    localStorage.setItem(this.draftStorageKey, JSON.stringify(borradores));
    if (previousModelRef && previousModelRef !== borrador.model3dFileRef) {
      await this.deleteDraftModel3dFile(previousModelRef);
    }
    this.cargarBorradores();
    this.mostrarListaBorradores = false;
    this.resetFormState();
    this.cdr.detectChanges();

    this.mostrarPopup.emit({
      title: '¡Éxito!',
      message: draftUpdated ? 'Borrador actualizado correctamente.' : 'Borrador guardado correctamente.'
    });
  }

  cargarBorradores(triggerChange: boolean = true) {
    this.borradores = this.readDrafts();
    if (triggerChange) {
      this.cdr.detectChanges();
    }
  }

  verBorradores() {
    this.cargarBorradores();
    this.mostrarListaBorradores = true;
    this.cdr.detectChanges();
  }

  cerrarListaBorradores() {
    this.mostrarListaBorradores = false;
    this.cdr.detectChanges();
  }

  toggleBorradores() {
    this.mostrarListaBorradores = !this.mostrarListaBorradores;
  }

  cargarBorrador(borrador: any) {
    if (borrador && borrador.form) {
      this.productoForm.patchValue(borrador.form);
      this.previsualizaciones = borrador.previsualizaciones || [];
      this.archivosSeleccionados = [];
      void this.restoreDraftModel3dFile(borrador.model3dFileRef || borrador.model3dFile || null);
      this.mostrarListaBorradores = false;
      this.verificarLimiteProductos();
      this.cdr.detectChanges();
    }
  }

  eliminarBorrador(borrador: any, event?: Event) {
    if (event) event.stopPropagation();
    const borradores = this.readDrafts();
    const idx = borradores.findIndex((b: any) => JSON.stringify(b.form) === JSON.stringify(borrador.form));
    if (idx > -1) {
      const removed = borradores[idx];
      borradores.splice(idx, 1);
      localStorage.setItem(this.draftStorageKey, JSON.stringify(borradores));
      this.borradores = borradores;
      if (removed?.model3dFileRef) {
        void this.deleteDraftModel3dFile(removed.model3dFileRef);
      }
    }
  }

  removerImagen(index: number) {
    this.previsualizaciones.splice(index, 1);
    this.archivosSeleccionados.splice(index, 1);
  }

  onDragStart(event: DragEvent, index: number) {
    this.draggedIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/html', index.toString());
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onDrop(event: DragEvent, dropIndex: number) {
    event.preventDefault();
    if (this.draggedIndex !== null && this.draggedIndex !== dropIndex) {
      // Reordenar previsualizaciones
      const draggedImage = this.previsualizaciones[this.draggedIndex];
      this.previsualizaciones.splice(this.draggedIndex, 1);
      this.previsualizaciones.splice(dropIndex, 0, draggedImage);

      // Reordenar archivos seleccionados si existen
      if (this.archivosSeleccionados.length > this.draggedIndex) {
        const draggedFile = this.archivosSeleccionados[this.draggedIndex];
        this.archivosSeleccionados.splice(this.draggedIndex, 1);
        if (dropIndex < this.archivosSeleccionados.length) {
          this.archivosSeleccionados.splice(dropIndex, 0, draggedFile);
        }
      }

      this.cdr.detectChanges();
    }
    this.draggedIndex = null;
  }

  onDragEnd() {
    this.draggedIndex = null;
  }

  autorrellenarUbicacionActual(): void {
    if (this.autoFillLocationLoading) {
      return;
    }

    if (!('geolocation' in navigator)) {
      this.mostrarPopup.emit({
        title: 'Ubicación no disponible',
        message: 'Tu navegador no soporta geolocalización.'
      });
      return;
    }

    this.autoFillLocationLoading = true;

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { addressText, province } = await this.obtenerDireccionDesdeCoordenadas(
            position.coords.latitude,
            position.coords.longitude
          );

          const addressControl = this.productoForm.get('address_text');
          const provinceControl = this.productoForm.get('province');

          if (addressText && addressControl) {
            addressControl.setValue(addressText.slice(0, 200));
            addressControl.markAsDirty();
            addressControl.markAsTouched();
            addressControl.updateValueAndValidity();
          }

          if (province && provinceControl) {
            provinceControl.setValue(province.slice(0, 50));
            provinceControl.markAsDirty();
            provinceControl.markAsTouched();
            provinceControl.updateValueAndValidity();
          }

          if (!addressText && !province) {
            this.mostrarPopup.emit({
              title: 'No se pudo completar',
              message: 'No se pudo obtener una dirección válida desde tu ubicación actual.'
            });
          }
        } catch {
          this.mostrarPopup.emit({
            title: 'Error de ubicación',
            message: 'No se pudo convertir tu ubicación en dirección. Inténtalo de nuevo.'
          });
        } finally {
          this.autoFillLocationLoading = false;
          this.cdr.detectChanges();
        }
      },
      (error) => {
        this.autoFillLocationLoading = false;
        this.mostrarPopup.emit({
          title: 'Ubicación denegada',
          message: this.getGeoErrorMessage(error)
        });
        this.cdr.detectChanges();
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000
      }
    );
  }

  private getGeoErrorMessage(error: GeolocationPositionError): string {
    if (error.code === GeolocationPositionError.PERMISSION_DENIED) {
      return 'Has denegado el permiso de ubicación. Permítelo desde el navegador para continuar.';
    }

    if (error.code === GeolocationPositionError.POSITION_UNAVAILABLE) {
      return 'No pudimos obtener tu ubicación actual.';
    }

    if (error.code === GeolocationPositionError.TIMEOUT) {
      return 'Se agotó el tiempo al intentar obtener tu ubicación.';
    }

    return 'Ocurrió un error al solicitar tu ubicación.';
  }

  private async obtenerDireccionDesdeCoordenadas(lat: number, lon: number): Promise<{ addressText: string; province: string }> {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=es`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error('Reverse geocode failed');
    }

    const data = await res.json();
    const addr = (data?.address ?? {}) as Record<string, string>;

    const locality = addr['city'] || addr['town'] || addr['village'] || addr['municipality'] || addr['county'] || '';
    const street = [addr['road'], addr['house_number']].filter(Boolean).join(' ').trim();
    const area = (addr['suburb'] || addr['neighbourhood'] || '').trim();
    const postcode = (addr['postcode'] || '').trim();

    const builtAddress = [street, area, locality, postcode].filter(Boolean).join(', ').trim();
    const fallbackAddress = typeof data?.display_name === 'string'
      ? data.display_name.split(',').slice(0, 4).join(', ').trim()
      : '';

    return {
      addressText: builtAddress || fallbackAddress,
      province: this.extraerProvincia(addr)
    };
  }

  private extraerProvincia(addr: Record<string, string>): string {
    const candidates = [
      addr['state_district'],
      addr['province'],
      addr['county'],
      addr['region'],
      addr['state']
    ];

    for (const rawCandidate of candidates) {
      const normalized = this.normalizarNombreProvincia(rawCandidate);
      if (!normalized) {
        continue;
      }
      if (!this.esComunidadAutonoma(normalized)) {
        return normalized;
      }
    }

    return this.normalizarNombreProvincia(addr['state']) || this.normalizarNombreProvincia(addr['county']) || '';
  }

  private normalizarNombreProvincia(value?: string): string {
    if (!value) {
      return '';
    }

    const firstPart = value.split('/')[0]?.trim() || '';
    return firstPart
      .replace(/^provincia\s+de\s+/i, '')
      .replace(/^prov[ií]ncia\s+de\s+/i, '')
      .trim();
  }

  private esComunidadAutonoma(value: string): boolean {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    return [
      'andalucia',
      'aragon',
      'asturias',
      'cantabria',
      'castilla-la mancha',
      'castilla y leon',
      'cataluna',
      'comunidad valenciana',
      'comunitat valenciana',
      'extremadura',
      'galicia',
      'islas baleares',
      'illes balears',
      'la rioja',
      'comunidad de madrid',
      'madrid',
      'region de murcia',
      'murcia',
      'comunidad foral de navarra',
      'navarra',
      'pais vasco',
      'euskadi',
      'canarias',
      'ceuta',
      'melilla'
    ].includes(normalized);
  }

  guardarProducto(forcedDireccion?: boolean) {
    if (this.loadingLimit) {
      this.mostrarPopup.emit({
        title: 'Espera un momento',
        message: 'Estamos comprobando tu límite de productos. Inténtalo de nuevo en unos segundos.'
      });
      return;
    }

    if (this.limitAlcanzado) {
      this.mostrarPopup.emit({
        title: 'Límite alcanzado',
        message: this.limitReachedMessage
      });
      return;
    }

    if (this.productoForm.invalid) {
      this.productoForm.markAllAsTouched();
      return;
    }

    if (this.archivosSeleccionados.length === 0 && this.previsualizaciones.length === 0) {
      this.mostrarPopup.emit({
        title: 'Faltan imágenes',
        message: 'Debes subir al menos una foto del producto.'
      });
      return;
    }

    this.loading = true;
    this.submitNotice = this.isAdminMode ? 'Creando producto, por favor espera...' : 'Guardando producto, por favor espera...';
    this.model3dProgress = null;
    this.model3dError = null;

    const payload = {
      ...this.productoForm.getRawValue(),
      media: this.previsualizaciones
    };

    const token = this.authService.getToken() || '';

    // Si el usuario ya seleccionó una dirección, forzarla en el payload
    if (forcedDireccion && this.direccionSeleccionada) {
      payload['direccion_forzada'] = this.direccionSeleccionada;
    }

    this.productosService.crearProducto(payload, token).subscribe({
      next: (resp: any) => {
        if (resp?.multiple && Array.isArray(resp.options)) {
          // Mostrar modal de selección de dirección
          this.opcionesDireccion = resp.options;
          this.mostrarSelectorDireccion = true;
          this.loading = false;
          this.submitNotice = null;
          this.cdr.detectChanges();
          return;
        }
        const created = resp?.product || resp?.createdProduct || resp?.data || resp;
        const productId = created?._id || created?.uid || created?.id;
        if (!productId) {
          this.loading = false;
          this.mostrarPopup.emit({ title: 'Error', message: 'Producto creado pero no se obtuvo ID.' });
          return;
        }

        const finalizeSuccess = () => {
          const hadModel3d = !!this.model3dFile;
          this.loading = false;
          this.submitNotice = null;
          this.resetFormState();

          // Eliminar el borrador si existe
          let borradores = JSON.parse(localStorage.getItem(this.draftStorageKey) || '[]');
          const nombre = payload.name?.trim();
          if (nombre) {
            const idx = borradores.findIndex((b: any) => (b.form?.name || '').trim() === nombre);
            if (idx > -1) {
              borradores.splice(idx, 1);
              localStorage.setItem(this.draftStorageKey, JSON.stringify(borradores));
              this.borradores = borradores;
            }
          }

          this.mostrarListaBorradores = false;
          this.cdr.detectChanges();

          this.mostrarPopup.emit({
            title: '¡Éxito!',
            message: hadModel3d
              ? 'Producto y modelo 3D subidos correctamente.'
              : 'Producto creado correctamente.'
          });
          this.productoCreadoExitosamente.emit();
          if (this.popupMode) {
            this.cerrar.emit();
          }
        };

        // Si no hay modelo 3D, terminar
        if (!this.model3dFile) {
          this.syncMapCacheAndRun(finalizeSuccess);
          return;
        }

        // Subir modelo 3D
        this.productosService.uploadModel3d(productId, this.model3dFile, token).subscribe({
          next: (event: any) => {
            if (event?.type === 1 && event.total) {
              this.model3dProgress = Math.round((event.loaded / event.total) * 100);
            }
            if (event?.body?.model3d) {
              this.model3dProgress = 100;
              this.syncMapCacheAndRun(finalizeSuccess);
            }
          },
          error: (err) => {
            this.loading = false;
            this.model3dError = err?.error?.msg || 'Error subiendo modelo 3D';
            this.cdr.detectChanges();
          }
        });
      },
      error: (err) => {
        this.loading = false;
        this.submitNotice = null;
        const detail = err?.error?.detail ? ` (${err.error.detail})` : '';
        this.mostrarPopup.emit({
          title: 'Error',
          message: (err?.error?.msg || 'Error al crear el producto') + detail
        });
        console.error('Error creando producto', err?.error || err);
        this.cdr.detectChanges();
      }
    });
  }

  private syncMapCacheAndRun(callback: () => void): void {
    this.mapProductsCacheService.refreshCacheAfterMutation().subscribe({
      next: () => callback()
    });
  }

  cerrarPopup(): void {
    if (this.loading) {
      return;
    }

    if (!this.popupMode || !this.tieneCambiosSinGuardar()) {
      this.cerrar.emit();
      return;
    }

    this.showExitPrompt = true;
    this.cdr.detectChanges();
  }

  tieneCambiosSinGuardar(): boolean {
    if (this.loading) {
      return true;
    }

    if (this.productoForm.dirty) {
      return true;
    }

    if (this.previsualizaciones.length > 0 || this.archivosSeleccionados.length > 0 || !!this.model3dFile) {
      return true;
    }

    const rawValues = this.productoForm.getRawValue() || {};
    const hasTextValue = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;
    const fieldsToCheck = [
      'name',
      'description',
      'resumen',
      'historia_origen',
      'importancia_cultural',
      'proceso_elaboracion',
      'materias_primas',
      'tiempo_elaboracion',
      'address_text',
      'province',
      ...(this.isAdminMode ? ['owner'] : [])
    ];

    return fieldsToCheck.some((field) => hasTextValue(rawValues[field]));
  }

  mantenermeEnLaPagina(): void {
    this.showExitPrompt = false;
    this.cdr.detectChanges();
  }

  async guardarBorradorYSalir(): Promise<void> {
    await this.guardarComoBorrador();
    this.showExitPrompt = false;
    this.cerrar.emit();
    this.cdr.detectChanges();
  }

  salirSinGuardar(): void {
    this.showExitPrompt = false;
    this.cerrar.emit();
    this.cdr.detectChanges();
  }

  getArtisanLabel(artisan: AdminManagedUser | null | undefined): string {
    if (!artisan) {
      return '';
    }

    const companyName = String(artisan.company_name || '').trim();
    if (companyName) {
      return companyName;
    }

    return [artisan.name, artisan.surname].filter(Boolean).join(' ').trim();
  }

  private configureModeSpecificControls(): void {
    if (!this.productoForm.contains('owner')) {
      this.productoForm.addControl('owner', new FormControl(''));
    }

    const ownerControl = this.productoForm.get('owner');
    if (!ownerControl) {
      return;
    }

    if (this.isAdminMode) {
      ownerControl.setValidators([Validators.required]);
    } else {
      ownerControl.setValue('', { emitEvent: false });
      ownerControl.clearValidators();
    }

    ownerControl.updateValueAndValidity({ emitEvent: false });
  }

  private bindOwnerChanges(): void {
    this.ownerChangesSub?.unsubscribe();

    if (!this.isAdminMode) {
      return;
    }

    this.ownerChangesSub = this.productoForm.get('owner')?.valueChanges.subscribe(() => {
      this.limiteAvisado = false;
      this.verificarLimiteProductos();
    }) || null;
  }

  private rebuildArtisanOptions(): void {
    this.artisanOptions = (this.availableArtisans || []).map((artisan) => ({
      ...artisan,
      displayLabel: this.getArtisanLabel(artisan)
    }));
  }

  private ensureSelectedOwnerIsValid(): void {
    if (!this.isAdminMode) {
      return;
    }

    const ownerControl = this.productoForm.get('owner');
    const selectedOwner = String(ownerControl?.value || '').trim();
    if (!selectedOwner) {
      return;
    }

    const ownerExists = this.artisanOptions.some((artisan) => artisan.uid === selectedOwner);
    if (!ownerExists) {
      ownerControl?.setValue('', { emitEvent: false });
      this.limitAlcanzado = false;
      this.loadingLimit = false;
      this.limiteAvisado = false;
    }
  }

  private resetFormState(): void {
    const ownerValue = this.isAdminMode ? '' : null;
    this.productoForm.reset({
      category: 'Otros',
      certificaciones_protecciones: 'Sin certificación',
      ...(this.productoForm.contains('owner') ? { owner: ownerValue } : {})
    });
    this.previsualizaciones = [];
    this.archivosSeleccionados = [];
    this.model3dFile = null;
    this.model3dProgress = null;
    this.model3dError = null;
    this.previewArrayBuffer = null;
    this.loadingLimit = false;
    this.limitAlcanzado = false;
    this.limiteAvisado = false;
    this.mostrarListaBorradores = false;
    this.disposePreview();
  }

  private readDrafts(): ProductoBorrador[] {
    try {
      const raw = localStorage.getItem(this.draftStorageKey) || '[]';
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async storeDraftModel3dFile(file: File): Promise<string> {
    const modelRef = `draft-model-${crypto.randomUUID()}`;
    const db = await this.openDraftModelDatabase();

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.draftModelStoreName, 'readwrite');
      const store = transaction.objectStore(this.draftModelStoreName);
      const request = store.put({
        id: modelRef,
        name: file.name || 'modelo.glb',
        type: file.type || 'model/gltf-binary',
        lastModified: file.lastModified || Date.now(),
        blob: file
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('No se pudo guardar el modelo 3D del borrador'));
    });

    return modelRef;
  }

  private async restoreDraftModel3dFile(modelRefOrSnapshot?: string | DraftModel3dFile | null): Promise<void> {
    this.model3dFile = null;
    this.model3dProgress = null;
    this.model3dError = null;
    this.previewArrayBuffer = null;

    if (!modelRefOrSnapshot) {
      this.disposePreview();
      return;
    }

    try {
      this.disposePreview();
      let file: File | null = null;

      if (typeof modelRefOrSnapshot === 'string') {
        const record = await this.readDraftModel3dFile(modelRefOrSnapshot);
        if (record) {
          file = new File([record.blob], record.name || 'modelo.glb', {
            type: record.type || 'model/gltf-binary',
            lastModified: record.lastModified || Date.now()
          });
        }
      } else {
        file = this.dataUrlToFile(modelRefOrSnapshot);
      }

      if (!file) {
        return;
      }

      this.model3dFile = file;
      this.cdr.detectChanges();

      const arrayBuffer = await file.arrayBuffer();
      this.previewArrayBuffer = arrayBuffer;
      // Esperar hasta que el contenedor exista antes de renderizar (reintentos cortos)
      await this.waitForPreviewContainer(1000);
      void this.renderModel3dPreview(undefined, arrayBuffer, true);
    } catch (error) {
      console.error('[restoreDraftModel3dFile] Error restaurando modelo 3D', error);
      this.clearModelSelection();
    }
  }

  private async waitForPreviewContainer(timeoutMs: number = 1000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.model3dPreviewRef && this.model3dPreviewRef.nativeElement) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private async readDraftModel3dFile(modelRef: string): Promise<{ name: string; type: string; lastModified: number; blob: Blob } | null> {
    const db = await this.openDraftModelDatabase();

    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(this.draftModelStoreName, 'readonly');
      const store = transaction.objectStore(this.draftModelStoreName);
      const request = store.get(modelRef);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('No se pudo leer el modelo 3D del borrador'));
    });
  }

  private dataUrlToFile(snapshot: DraftModel3dFile): File {
    const commaIndex = snapshot.dataUrl.indexOf(',');
    if (commaIndex === -1) {
      throw new Error('Datos de modelo 3D inválidos');
    }

    const base64 = snapshot.dataUrl.slice(commaIndex + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new File([bytes], snapshot.name || 'modelo.glb', {
      type: snapshot.type || 'model/gltf-binary',
      lastModified: snapshot.lastModified || Date.now()
    });
  }

  private async deleteDraftModel3dFile(modelRef: string): Promise<void> {
    const db = await this.openDraftModelDatabase();

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.draftModelStoreName, 'readwrite');
      const store = transaction.objectStore(this.draftModelStoreName);
      const request = store.delete(modelRef);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('No se pudo eliminar el modelo 3D del borrador'));
    });
  }

  private openDraftModelDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB no está disponible'));
        return;
      }

      const request = indexedDB.open(this.draftModelDbName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.draftModelStoreName)) {
          db.createObjectStore(this.draftModelStoreName, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB'));
    });
  }

  // Preview helpers
  private async renderModel3dPreview(url?: string, arrayBuffer?: ArrayBuffer, skipScroll?: boolean) {
    if ((!url && !arrayBuffer) || !this.model3dPreviewRef) return;
    this.disposePreview();

    const container = this.model3dPreviewRef.nativeElement;
    const width = container.clientWidth || 220;
    const height = container.clientHeight || 160;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(2, 3, 4);
    scene.add(dir);

    const loader = new GLTFLoader();
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.screenSpacePanning = false;
    controls.rotateSpeed = 0.7;
    controls.zoomSpeed = 0.9;
    try {
      let gltf;
      if (arrayBuffer) {
        gltf = await loader.parseAsync(arrayBuffer, '');
      } else if (url) {
        gltf = await loader.loadAsync(url);
      }
      if (!gltf) throw new Error('No gltf data');
      const model = gltf.scene || gltf.scenes[0];
      if (model) {
        scene.add(model);
        this.centerModel(model);
        this.fitCameraToObject(model, camera, controls);
        this.previewModel = model;
        if (!skipScroll) this.scrollToModel3dPreview();
      }
    } catch (e) {
      console.error('[Model3D preview] load failed', e);
      container.innerHTML = '<div class="preview-error">Vista previa no disponible</div>';
    }

    const animate = () => {
      this.previewAnimationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    this.previewRenderer = renderer;
    this.previewScene = scene;
    this.previewCamera = camera;
    this.previewControls = controls;
  }

  private centerModel(object: THREE.Object3D): void {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);
    object.updateMatrixWorld(true);
  }

  private fitCameraToObject(
    object: THREE.Object3D,
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    padding: number = 1.08
  ) {
    const box = new THREE.Box3().setFromObject(object);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!sphere) return;

    const radius = Math.max(sphere.radius, 0.001);
    const center = sphere.center.clone();
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const minHalfFov = Math.max(Math.min(vFov, hFov) * 0.5, 0.001);
    const distance = (radius / Math.sin(minHalfFov)) * padding;

    const dir = new THREE.Vector3(0, 0.2, 1).normalize();
    camera.position.copy(center).addScaledVector(dir, distance);
    camera.near = Math.max(distance / 100, 0.01);
    camera.far = Math.max(distance + radius * 10, 50);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.minDistance = Math.max(distance * 0.4, 0.01);
    controls.maxDistance = Math.max(distance * 3, controls.minDistance + 0.5);
    controls.update();
  }

  private disposePreview() {
    if (this.previewAnimationId !== null) {
      cancelAnimationFrame(this.previewAnimationId);
      this.previewAnimationId = null;
    }
    if (this.previewControls) {
      this.previewControls.dispose();
      this.previewControls = null;
    }
    if (this.previewObjectUrl) {
      URL.revokeObjectURL(this.previewObjectUrl);
      this.previewObjectUrl = null;
    }
    this.previewArrayBuffer = null;
    if (this.previewRenderer) {
      this.previewRenderer.dispose();
      const el = this.previewRenderer.domElement;
      if (el && el.parentElement) el.parentElement.removeChild(el);
    }
    if (this.previewScene && this.previewModel) {
      this.previewScene.remove(this.previewModel);
    }
    this.previewRenderer = null;
    this.previewScene = null;
    this.previewCamera = null;
    this.previewModel = null;
    if (this.model3dPreviewRef) {
      this.model3dPreviewRef.nativeElement.innerHTML = '';
    }
  }

  private scrollToModel3dPreview() {
    // Desplaza suavemente la vista para que el usuario vea el modelo recién cargado
    setTimeout(() => {
      const el = this.model3dPreviewRef?.nativeElement;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }
}
