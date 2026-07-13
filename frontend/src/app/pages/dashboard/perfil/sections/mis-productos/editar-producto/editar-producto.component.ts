import { DireccionSelectorModalComponent, DireccionOpcion } from '../../../../../../shared/direccion-selector-modal.component';
import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CustomTooltipDirective } from '../../../../../../shared/custom-tooltip.directive';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../../../../../layouts/auth-layout/auth.service';
import { ProductosService } from '../../../services/productos.service';
import { AdminManagedUser, AdminUsersService } from '../../../services/admin-users.service';
import { PerfilFormService } from '../../../services/perfil-form.service';
import { NgSelectModule } from '@ng-select/ng-select';
import { Subscription } from 'rxjs';
import { MapProductsCacheService } from '../../../../../../services/map-products-cache.service';
import { CERTIFICATION_OPTIONS, CertificationOption } from '../../../../../../shared/certification-labels';

interface EditArtisanOption extends AdminManagedUser {
  displayLabel: string;
  searchText: string;
}

@Component({
  selector: 'app-editar-producto',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CustomTooltipDirective, NgSelectModule, DireccionSelectorModalComponent],
  templateUrl: './editar-producto.component.html',
  styleUrl: './editar-producto.component.css'
})
export class EditarProductoComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly MAX_FOTOS = 7;
  autoFillLocationLoading: boolean = false;
  mostrarSelectorDireccion = false;
  opcionesDireccion: DireccionOpcion[] = [];
  direccionSeleccionada: DireccionOpcion | null = null;

  certificaciones: CertificationOption[] = CERTIFICATION_OPTIONS;
    onDireccionSeleccionada(opcion: DireccionOpcion) {
      this.mostrarSelectorDireccion = false;
      this.direccionSeleccionada = opcion;
      this.guardarEdicionProducto(true);
    }

    onCancelarDireccion() {
      this.mostrarSelectorDireccion = false;
      this.direccionSeleccionada = null;
      this.editarLoading = false;
    }
  @Input() productoId: string | null = null;
  @Input() productoIndex: number | null = null;
  @Input() misProductos: any[] = [];
  @Input() modoAdmin: boolean = false;
  @Output() cerrar = new EventEmitter<void>();
  @Output() productoActualizado = new EventEmitter<any>();
  @Output() mostrarPopup = new EventEmitter<{title: string, message: string}>();

  categorias: string[] = [
    'Alimentación',
    'Textil',
    'Barro y Alfarería',
    'Madera y mueble',
    'Otros'
  ];

  editarProductoForm!: FormGroup;
  editarPrevisualizaciones: string[] = [];
  editarArchivosSeleccionados: File[] = [];
  editarLoading: boolean = false;
  editarImagenesDirty: boolean = false;
  draggedIndex: number | null = null;
  model3dFile: File | null = null;
  model3dProgress: number | null = null;
  model3dError: string | null = null;
  editarModel3dDirty: boolean = false;
  artisanOptions: EditArtisanOption[] = [];
  artisanSearchQuery = '';
  showArtisanResults = false;
  loadingArtisans = false;
  artisanLoadError = '';
  @ViewChild('model3dPreview') model3dPreviewRef?: ElementRef<HTMLDivElement>;
  private previewRenderer: THREE.WebGLRenderer | null = null;
  private previewScene: THREE.Scene | null = null;
  private previewCamera: THREE.PerspectiveCamera | null = null;
  private previewModel: THREE.Object3D | null = null;
  private previewControls: OrbitControls | null = null;
  private previewAnimationId: number | null = null;
  private previewObjectUrl: string | null = null;
  private previewArrayBuffer: ArrayBuffer | null = null;
  private viewInitialized: boolean = false;
  private existingModel3dRequest: Subscription | null = null;
  private artisanRequest: Subscription | null = null;
  private loadedArtisans: AdminManagedUser[] = [];
  private existingModelLoadKey: string | null = null;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private productosService: ProductosService,
    private adminUsersService: AdminUsersService,
    private mapProductsCacheService: MapProductsCacheService,
    private perfilFormService: PerfilFormService,
    private cdr: ChangeDetectorRef
  ) {
    this.editarProductoForm = this.perfilFormService.crearProductoForm();
  }

  ngOnInit(): void {
    this.configureAdminOwnerControl();
    this.cargarDatosProducto();
    this.cargarArtesanosAdmin();
  }

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    this.loadExistingModel3dPreview();
  }

  ngOnDestroy(): void {
    this.artisanRequest?.unsubscribe();
    this.cancelExistingModel3dRequest();
    this.clearLocalPreviewState();
    this.disposePreviewScene();
  }

  get currentProd() {
    return this.misProductos.find((p: any) => (p._id || p.uid || p.id) === this.productoId);
  }

  get ownerDisplayName(): string {
    const owner = this.currentProd?.owner;
    if (!owner) {
      return '';
    }

    const companyName = String(owner.company_name || '').trim();
    if (companyName) {
      return companyName;
    }

    return [owner.name, owner.surname].filter(Boolean).join(' ').trim();
  }

  get filteredArtisanOptions(): EditArtisanOption[] {
    const normalizedTerm = this.normalizeSearchText(this.artisanSearchQuery);
    if (!normalizedTerm) {
      return this.artisanOptions;
    }

    return this.artisanOptions.filter((artisan) => artisan.searchText.includes(normalizedTerm));
  }

  onArtisanSearchFocus(): void {
    if (!this.modoAdmin) {
      return;
    }

    this.showArtisanResults = true;
  }

  onArtisanSearchInput(event: Event): void {
    this.artisanSearchQuery = String((event.target as HTMLInputElement | null)?.value || '');
    this.showArtisanResults = true;
  }

  onArtisanSearchBlur(): void {
    setTimeout(() => {
      this.showArtisanResults = false;
      this.syncArtisanSearchWithSelection();
      this.cdr.detectChanges();
    }, 120);
  }

  selectArtisan(artisan: EditArtisanOption): void {
    const selectedOwnerId = this.getOwnerId(artisan);
    const ownerControl = this.editarProductoForm.get('owner');
    if (!selectedOwnerId || !ownerControl) {
      return;
    }

    if (ownerControl.value !== selectedOwnerId) {
      ownerControl.setValue(selectedOwnerId, { emitEvent: false });
    }

    ownerControl.markAsDirty();
    ownerControl.markAsTouched();
    ownerControl.updateValueAndValidity({ emitEvent: false });
    this.artisanSearchQuery = artisan.displayLabel;
    this.showArtisanResults = false;
    this.cdr.detectChanges();
  }

  private configureAdminOwnerControl(): void {
    if (!this.modoAdmin) {
      return;
    }

    if (!this.editarProductoForm.contains('owner')) {
      this.editarProductoForm.addControl('owner', new FormControl('', Validators.required));
      return;
    }

    const ownerControl = this.editarProductoForm.get('owner');
    ownerControl?.setValidators([Validators.required]);
    ownerControl?.updateValueAndValidity({ emitEvent: false });
  }

  private cargarArtesanosAdmin(): void {
    if (!this.modoAdmin) {
      return;
    }

    this.loadingArtisans = true;
    this.artisanLoadError = '';
    this.artisanRequest?.unsubscribe();
    this.artisanRequest = this.adminUsersService.getUsers().subscribe({
      next: (users) => {
        this.loadedArtisans = (Array.isArray(users) ? users : []).filter((user) => (
          user.role === 'artisan' && user.active !== false
        ));
        this.loadingArtisans = false;
        this.rebuildArtisanOptions();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.loadedArtisans = [];
        this.loadingArtisans = false;
        this.artisanLoadError = err?.error?.msg || 'No se pudieron cargar los artesanos disponibles.';
        this.rebuildArtisanOptions();
        this.cdr.detectChanges();
      }
    });
  }

  private rebuildArtisanOptions(): void {
    if (!this.modoAdmin) {
      return;
    }

    const optionsById = new Map<string, EditArtisanOption>();
    const addOption = (artisan: AdminManagedUser | any) => {
      const uid = this.getOwnerId(artisan);
      if (!uid) {
        return;
      }

      const displayLabel = this.getArtisanLabel(artisan);
      if (!displayLabel) {
        return;
      }

      optionsById.set(uid, {
        ...artisan,
        uid,
        displayLabel,
        searchText: this.normalizeSearchText([
          displayLabel,
          artisan?.company_name || '',
          artisan?.name || '',
          artisan?.surname || '',
          artisan?.email || ''
        ].join(' '))
      });
    };

    this.loadedArtisans.forEach(addOption);
    addOption(this.currentProd?.owner);

    this.artisanOptions = [...optionsById.values()]
      .sort((a, b) => a.displayLabel.localeCompare(b.displayLabel, 'es'));
    this.syncArtisanSearchWithSelection();
  }

  private syncArtisanSearchWithSelection(): void {
    if (!this.modoAdmin) {
      return;
    }

    const ownerControlValue = this.getOwnerId(this.editarProductoForm.get('owner')?.value);
    const selected = this.artisanOptions.find((artisan) => this.getOwnerId(artisan) === ownerControlValue);
    this.artisanSearchQuery = selected?.displayLabel || this.ownerDisplayName || this.artisanSearchQuery;
  }

  private getOwnerId(owner: any): string {
    if (!owner) {
      return '';
    }

    if (typeof owner === 'string') {
      return owner.trim();
    }

    return String(owner.uid || owner._id || owner.id || '').trim();
  }

  private getArtisanLabel(artisan: AdminManagedUser | any): string {
    if (!artisan || typeof artisan === 'string') {
      return '';
    }

    const companyName = String(artisan.company_name || '').trim();
    if (companyName) {
      return companyName;
    }

    return [artisan.name, artisan.surname]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  private normalizeSearchText(value: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  onCloseButton(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.cerrar.emit();
  }

  cargarDatosProducto() {
    const producto = this.misProductos.find((p: any) => (p._id || p.uid || p.id) === this.productoId);
    
    if (producto) {
      const patchValue: any = {
        name: producto.name || '',
        description: producto.description || '',
        resumen: producto.resumen || '',
        category: producto.category || '',
        historia_origen: producto.historia_origen || '',
        importancia_cultural: producto.importancia_cultural || '',
        proceso_elaboracion: producto.proceso_elaboracion || '',
        materias_primas: producto.materias_primas || '',
        tiempo_elaboracion: producto.tiempo_elaboracion || '',
        certificaciones_protecciones: producto.certificaciones_protecciones || '',
        address_text: producto.address_text || '',
        province: producto.province || ''
      };

      if (this.modoAdmin) {
        patchValue.owner = this.getOwnerId(producto.owner);
      }

      this.editarProductoForm.patchValue(patchValue);
      this.syncArtisanSearchWithSelection();

      this.editarPrevisualizaciones = Array.isArray(producto.media) ? [...producto.media] : [];
      this.editarImagenesDirty = false;
      this.editarArchivosSeleccionados = [];
      this.editarProductoForm.markAsPristine();
      this.editarProductoForm.markAsUntouched();
      this.rebuildArtisanOptions();
      this.loadExistingModel3dPreview();
    }
  }

  async onEditarFileSelected(event: any) {
    const files: FileList = event.target.files;
    if (files) {
      const fotosRestantes = this.MAX_FOTOS - this.editarPrevisualizaciones.length;
      if (fotosRestantes <= 0) {
        this.mostrarPopup.emit({
          title: 'Límite de fotos',
          message: `Solo puedes subir hasta ${this.MAX_FOTOS} fotos por producto.`
        });
        return;
      }
      const filesToAdd = Array.from(files).slice(0, fotosRestantes);
      // Añadir archivos y previews al final de los arrays existentes
      for (let i = 0; i < filesToAdd.length; i++) {
        this.editarArchivosSeleccionados.push(filesToAdd[i]);
      }
      const previewsToAdd = Array(filesToAdd.length).fill(null);
      const previewStartIndex = this.editarPrevisualizaciones.length;
      this.editarPrevisualizaciones.push(...previewsToAdd);
      for (let i = 0; i < filesToAdd.length; i++) {
        const previewIndex = previewStartIndex + i;
        const reader = new FileReader();
        reader.onload = (e: any) => {
          this.editarPrevisualizaciones[previewIndex] = e.target.result;
          this.cdr.detectChanges();
        };
        reader.readAsDataURL(filesToAdd[i]);

        this.productosService.comprimirImagen(filesToAdd[i]).then(base64Optimizada => {
          this.editarPrevisualizaciones[previewIndex] = base64Optimizada;
          this.cdr.detectChanges();
        });
      }
      this.editarImagenesDirty = true;
      if (files.length > filesToAdd.length) {
        this.mostrarPopup.emit({
          title: 'Límite de fotos',
          message: `Solo puedes subir hasta ${this.MAX_FOTOS} fotos por producto.`
        });
      }
      // No hace falta cdr.detectChanges() aquí, ya se llama en los callbacks
    }
  }

  onModel3dSelected(event: any) {
    this.model3dError = null;
    const file: File | null = event?.target?.files?.[0] || null;
    if (!file) {
      this.model3dFile = null;
      return;
    }
    const maxBytes = 100 * 1024 * 1024;
    const extOk = file.name.toLowerCase().endsWith('.glb');
    if (!extOk) {
      this.model3dError = 'Solo .glb';
      this.model3dFile = null;
      return;
    }
    if (file.size > maxBytes) {
      this.model3dError = 'Archivo supera 100MB';
      this.model3dFile = null;
      return;
    }
    this.cancelExistingModel3dRequest();
    this.existingModelLoadKey = null;
    this.clearLocalPreviewState();
    this.model3dFile = file;
    this.model3dProgress = null;
    this.editarModel3dDirty = true;
    this.cdr.detectChanges();

    // Render preview immediately using object URL
    this.previewObjectUrl = URL.createObjectURL(file);

    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      this.previewArrayBuffer = arrayBuffer;
      setTimeout(() => this.renderModel3dPreview(undefined, arrayBuffer), 0);
    };
    reader.onerror = () => {
      const objectUrl = this.previewObjectUrl;
      if (objectUrl) {
        setTimeout(() => this.renderModel3dPreview(objectUrl), 0);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  removerEditarImagen(index: number) {
    this.editarPrevisualizaciones.splice(index, 1);
    this.editarArchivosSeleccionados.splice(index, 1);
    this.editarImagenesDirty = true;
    this.cdr.detectChanges();
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
      const draggedImage = this.editarPrevisualizaciones[this.draggedIndex];
      this.editarPrevisualizaciones.splice(this.draggedIndex, 1);
      this.editarPrevisualizaciones.splice(dropIndex, 0, draggedImage);

      // Reordenar archivos seleccionados si existen
      if (this.editarArchivosSeleccionados.length > this.draggedIndex) {
        const draggedFile = this.editarArchivosSeleccionados[this.draggedIndex];
        this.editarArchivosSeleccionados.splice(this.draggedIndex, 1);
        if (dropIndex < this.editarArchivosSeleccionados.length) {
          this.editarArchivosSeleccionados.splice(dropIndex, 0, draggedFile);
        }
      }

      this.editarImagenesDirty = true;
      this.cdr.detectChanges();
    }
    this.draggedIndex = null;
  }

  onDragEnd() {
    this.draggedIndex = null;
  }

  onDeleteModel3d(event?: Event) {
    if (event) event.stopPropagation();
    if (!this.productoId) return;
    const token = this.authService.getToken() || '';
    this.editarLoading = true;
    this.productosService.deleteModel3d(this.productoId, token).subscribe({
      next: () => {
        this.syncMapCacheAndRun(() => {
          const prod = this.misProductos.find((p: any) => (p._id || p.uid || p.id) === this.productoId);
          if (prod) prod.model3d = null;
          this.editarLoading = false;
          this.model3dFile = null;
          this.model3dProgress = null;
          this.model3dError = null;
          this.editarModel3dDirty = true;
          this.cancelExistingModel3dRequest(true);
          this.clearLocalPreviewState();
          this.disposePreviewScene();
          this.mostrarPopup.emit({ title: 'Modelo eliminado', message: 'El modelo 3D se ha eliminado.' });
          this.cdr.detectChanges();
        });
      },
      error: (err) => {
        this.editarLoading = false;
        this.mostrarPopup.emit({ title: 'Error', message: err?.error?.msg || 'No se pudo eliminar el modelo 3D' });
        this.cdr.detectChanges();
      }
    });
  }

  clearModelSelection(event?: Event) {
    if (event) event.stopPropagation();
    if (this.model3dFile) {
      this.model3dFile = null;
      this.model3dProgress = null;
      this.model3dError = null;
      this.editarModel3dDirty = false;
      this.cancelExistingModel3dRequest(true);
      this.clearLocalPreviewState();
      this.disposePreviewScene();
      setTimeout(() => this.loadExistingModel3dPreview(), 0);
      this.cdr.detectChanges();
      return;
    }
    if (this.currentProd?.model3d) {
      this.onDeleteModel3d();
      return;
    }
    this.editarModel3dDirty = false;
    this.cancelExistingModel3dRequest(true);
    this.clearLocalPreviewState();
    this.disposePreviewScene();
    this.cdr.detectChanges();
  }

  // --- Preview helpers ---
  private loadExistingModel3dPreview() {
    if (!this.viewInitialized || !this.model3dPreviewRef) return;
    if (this.model3dFile || this.previewArrayBuffer || this.previewObjectUrl) return;

    const product = this.currentProd;
    const productId = this.productoId || product?._id || product?.uid || product?.id || null;
    const model = product?.model3d;

    if (!productId || !model) {
      this.cancelExistingModel3dRequest(true);
      this.disposePreviewScene();
      return;
    }

    const loadKey = [
      productId,
      model.driveFileId || '',
      model.sha256 || '',
      model.uploadedAt || '',
      model.filename || '',
      model.url || ''
    ].join(':');

    if (this.existingModelLoadKey === loadKey) return;

    this.cancelExistingModel3dRequest();
    this.existingModelLoadKey = loadKey;

    const token = this.authService.getToken() || '';
    this.existingModel3dRequest = this.productosService.downloadModel3dFile(productId, token).subscribe({
      next: (arrayBuffer) => {
        this.existingModel3dRequest = null;
        if (this.model3dFile) return;
        void this.renderModel3dPreview(undefined, arrayBuffer);
      },
      error: (err) => {
        this.existingModel3dRequest = null;
        this.existingModelLoadKey = null;
        console.error('[Model3D preview] download failed', err);
        this.disposePreviewScene();
        if (this.model3dPreviewRef) {
          this.model3dPreviewRef.nativeElement.innerHTML = '<div class="preview-error">Vista previa no disponible</div>';
        }
      }
    });
  }

  private async renderModel3dPreview(url?: string, arrayBuffer?: ArrayBuffer) {
    if ((!url && !arrayBuffer) || !this.model3dPreviewRef) return;
    this.disposePreviewScene();

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
      } else {
        return;
      }
      if (!gltf) {
        throw new Error('No gltf data');
      }
      const model = gltf.scene || gltf.scenes[0];
      if (model) {
        scene.add(model);
        this.centerModel(model);
        this.fitCameraToObject(model, camera, controls);
        this.previewModel = model;
        this.scrollToModel3dPreview();
      }
    } catch (e) {
      console.error('[Model3D preview] load failed', e);
      controls.dispose();
      renderer.dispose();
      container.innerHTML = '<div class=\"preview-error\">Vista previa no disponible</div>';
      return;
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

  private cancelExistingModel3dRequest(resetLoadKey: boolean = false) {
    if (this.existingModel3dRequest) {
      this.existingModel3dRequest.unsubscribe();
      this.existingModel3dRequest = null;
    }
    if (resetLoadKey) {
      this.existingModelLoadKey = null;
    }
  }

  private clearLocalPreviewState() {
    if (this.previewObjectUrl) {
      URL.revokeObjectURL(this.previewObjectUrl);
      this.previewObjectUrl = null;
    }
    this.previewArrayBuffer = null;
  }

  private disposePreviewScene() {
    if (this.previewAnimationId !== null) {
      cancelAnimationFrame(this.previewAnimationId);
      this.previewAnimationId = null;
    }
    if (this.previewControls) {
      this.previewControls.dispose();
      this.previewControls = null;
    }
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
    // Desplaza suavemente la vista hacia la vista previa del modelo 3D
    setTimeout(() => {
      const el = this.model3dPreviewRef?.nativeElement;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
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

          const addressControl = this.editarProductoForm.get('address_text');
          const provinceControl = this.editarProductoForm.get('province');

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

  guardarEdicionProducto(forcedDireccion?: boolean) {
    if (this.editarProductoForm.invalid) {
      this.editarProductoForm.markAllAsTouched();
      return;
    }
    if (this.editarPrevisualizaciones.length === 0) {
      this.mostrarPopup.emit({
        title: 'Faltan imágenes',
        message: 'Debes subir al menos una foto del producto.'
      });
      return;
    }

    this.editarLoading = true;
    // Solo enviar campos modificados (dirty)
    const dirtyValues: any = {};
    const controls = this.editarProductoForm.controls;
    const addressDirty = controls['address_text']?.dirty;
    const provinceDirty = controls['province']?.dirty;
    // Si uno de los dos está dirty, incluir ambos
    if (addressDirty || provinceDirty) {
      dirtyValues['address_text'] = controls['address_text']?.value;
      dirtyValues['province'] = controls['province']?.value;
    }
    Object.keys(controls).forEach(key => {
      if ((key === 'address_text' || key === 'province') && (addressDirty || provinceDirty)) {
        // Ya incluidos arriba
        return;
      }
      const control = controls[key];
      if (control && control.dirty) {
        dirtyValues[key] = control.value;
      }
    });
    if (this.modoAdmin) {
      const selectedOwnerId = String(controls['owner']?.value || '').trim();
      const currentOwnerId = this.getOwnerId(this.currentProd?.owner);
      if (selectedOwnerId && selectedOwnerId !== currentOwnerId) {
        dirtyValues.owner = selectedOwnerId;
      }
    }
    // Siempre enviar media si hay cambios en imágenes
    if (this.editarImagenesDirty) {
      dirtyValues.media = this.editarPrevisualizaciones;
    }
    // Si hay modelo 3D nuevo, el flujo ya lo maneja aparte
    if (forcedDireccion && this.direccionSeleccionada) {
      dirtyValues['direccion_forzada'] = this.direccionSeleccionada;
    }
    const hasModel3dUpload = !!this.model3dFile;
    const hasModel3dDeletion = this.editarModel3dDirty && !this.model3dFile && !this.currentProd?.model3d;

    // Si no hay ningún cambio en formulario/imagenes ni modelo 3D nuevo, no hacer nada
    if (Object.keys(dirtyValues).length === 0 && !hasModel3dUpload && !hasModel3dDeletion) {
      this.editarLoading = false;
      this.mostrarPopup.emit({
        title: 'Sin cambios',
        message: 'No se han realizado cambios para guardar.'
      });
      return;
    }
    const payload = dirtyValues;

    const id = this.productoId;
    if (!id) {
      this.editarLoading = false;
      this.mostrarPopup.emit({
        title: 'Error',
        message: 'No se encontró el ID del producto a editar.'
      });
      return;
    }

    const token = this.authService.getToken() || '';

    // Caso: solo se eliminó el modelo 3D (ya se eliminó al pulsar borrar)
    if (Object.keys(payload).length === 0 && hasModel3dDeletion) {
      this.syncMapCacheAndRun(() => {
        this.editarLoading = false;
        this.mostrarPopup.emit({
          title: '¡Éxito!',
          message: 'Cambios guardados correctamente.'
        });
        this.productoActualizado.emit({ ...(this.currentProd || {}), model3d: null });
        this.cdr.detectChanges();
      });
      return;
    }

    // Caso: solo se cambió el modelo 3D
    if (Object.keys(payload).length === 0 && hasModel3dUpload) {
      this.productosService.uploadModel3d(id, this.model3dFile!, token).subscribe({
        next: (event: any) => {
          if (event?.type === 1 && event.total) {
            this.model3dProgress = Math.round((event.loaded / event.total) * 100);
          }
          if (event?.body?.model3d) {
            this.model3dProgress = 100;
            const updated = { ...(this.currentProd || {}), model3d: event.body.model3d };
            this.syncMapCacheAndRun(() => {
              this.editarLoading = false;
              this.mostrarPopup.emit({
                title: '¡Éxito!',
                message: 'Modelo 3D actualizado correctamente.'
              });
              this.productoActualizado.emit(updated);
              this.cdr.detectChanges();
            });
          }
        },
        error: (err) => {
          this.editarLoading = false;
          this.model3dError = err?.error?.msg || 'Error subiendo modelo 3D';
          this.cdr.detectChanges();
        }
      });
      return;
    }

    this.productosService.actualizarProducto(id, payload, token).subscribe({
      next: (resp: any) => {
        if (resp?.multiple && Array.isArray(resp.options)) {
          this.opcionesDireccion = resp.options;
          this.mostrarSelectorDireccion = true;
          this.editarLoading = false;
          this.cdr.detectChanges();
          return;
        }
        const updated = resp.product || resp.updatedProduct || payload;

        const finalizeSuccess = () => {
          this.editarLoading = false;
          this.mostrarPopup.emit({
            title: '¡Éxito!',
            message: this.model3dFile ? 'Producto y modelo 3D actualizados.' : 'Producto editado correctamente.'
          });
          this.productoActualizado.emit(updated);
          this.cdr.detectChanges();
        };

        if (!this.model3dFile) {
          this.syncMapCacheAndRun(finalizeSuccess);
          return;
        }

        // Subir/reemplazar modelo 3D
        this.productosService.uploadModel3d(id, this.model3dFile, token).subscribe({
          next: (event: any) => {
            if (event?.type === 1 && event.total) {
              this.model3dProgress = Math.round((event.loaded / event.total) * 100);
            }
            if (event?.body?.model3d) {
              this.model3dProgress = 100;
              updated.model3d = event.body.model3d;
              this.syncMapCacheAndRun(finalizeSuccess);
            }
          },
          error: (err) => {
            this.editarLoading = false;
            this.model3dError = err?.error?.msg || 'Error subiendo modelo 3D';
            this.cdr.detectChanges();
          }
        });
      },
      error: (err) => {
        this.editarLoading = false;
        this.mostrarPopup.emit({
          title: 'Error',
          message: err.error?.msg || 'Error al editar el producto'
        });
        this.cdr.detectChanges();
      }
    });
  }

  private syncMapCacheAndRun(callback: () => void): void {
    this.mapProductsCacheService.refreshCacheAfterMutation().subscribe({
      next: () => callback()
    });
  }

  cerrarPopup() {
    this.cerrar.emit();
  }
}
