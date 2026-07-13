import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { CustomTooltipDirective } from '../../../shared/custom-tooltip.directive';
import { GeolocationService, GeoStatus } from '../../../services/geolocation.service';
import { getCertificationLabel } from '../../../shared/certification-labels';

export type CategoryKey =
  | 'agroalimentario'
  | 'textil'
  | 'barro_alfareria'
  | 'madera_mueble'
  | 'otros';

export type CertificationKey = 'DO' | 'DOP' | 'IGP' | 'IGA' | 'ARTESANIA_GARANTIZADA';

export interface MapSearchFilters {
  query: string;
  categories: CategoryKey[];
  proximityKm: number;
  certifications: CertificationKey[];
  favoritesOnly: boolean;
  /** Null si el usuario no concedió ubicación */
  userLat: number | null;
  userLon: number | null;
}

type ChipDef = { key: CategoryKey; label: string };
type CertificationDef = { key: CertificationKey; label: string };

@Component({
  selector: 'app-map-search-overlay',
  standalone: true,
  imports: [CommonModule, CustomTooltipDirective],
  templateUrl: './map-search-overlay.html',
  styleUrls: ['./map-search-overlay.css'],
  host: {
    '[class.inline]': 'inline'
  }
})
export class MapSearchOverlayComponent {
  /** Si es true, se renderiza dentro del flujo (p.ej. dentro de la navbar). */
  @Input() inline = false;

  @Input()
  set isLoggedIn(value: boolean) {
    const nextValue = !!value;
    if (this._isLoggedIn === nextValue) {
      return;
    }

    this._isLoggedIn = nextValue;

    // Si cierra sesión, desactivamos el filtro para no mantener estado inválido.
    if (!this._isLoggedIn && this.favoritesOnly) {
      this.favoritesOnly = false;
      this.emitFilters();
    }
  }
  get isLoggedIn(): boolean {
    return this._isLoggedIn;
  }

  @Output() filtersChange = new EventEmitter<MapSearchFilters>();

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  isAdvancedOpen = false;

  /** “Activo” cuando el foco está dentro del buscador. */
  isActive = false;
  /** Nombre de la localidad del usuario obtenido por geocodificación inversa. */
  locationName = '';
  /** Control manual para mostrar/ocultar chips sin depender del foco. */
  chipsMode: 'auto' | 'open' | 'closed' = 'auto';

  query = '';
  proximityKm = 50;
  favoritesOnly = false;

  private _isLoggedIn = false;

  // --- GEOLOCALIZACIÓN ---
  geoStatus: GeoStatus = 'idle';
  geoRequesting = false;
  /** Muestra el modal de confirmación personalizado antes de llamar al navegador */
  showGeoModal = false;
  /** El usuario ha activado explícitamente el filtro de proximidad.
   *  Se pone a false con Reset para que el filtro deje de aplicarse
   *  aunque el servicio siga teniendo las coordenadas cacheadas. */
  proximityActive = false;

  private readonly categoryChips: ChipDef[] = [
    { key: 'agroalimentario', label: 'Alimentación' },
    { key: 'textil', label: 'Textil' },
    { key: 'barro_alfareria', label: 'Barro y Alfarería' },
    { key: 'madera_mueble', label: 'Madera y mueble' },
    { key: 'otros', label: 'Otros' }
  ];

  readonly certificationOptions: CertificationDef[] = [
    { key: 'DO', label: getCertificationLabel('DO') },
    { key: 'DOP', label: getCertificationLabel('DOP') },
    { key: 'IGP', label: getCertificationLabel('IGP') },
    { key: 'IGA', label: getCertificationLabel('IGA') },
    { key: 'ARTESANIA_GARANTIZADA', label: 'Artesanía garantizada' }
  ];

  /** Mapa de colores para cada categoría */
  public readonly categoryColors: Record<CategoryKey, string> = {
    agroalimentario: '#5aabee',
    barro_alfareria: '#f83d3a',
    madera_mueble: '#f09cae',
    textil: '#b44194',
    otros: '#2924b4'
  };

  selectedCategories = new Set<CategoryKey>();

  certifications: Record<CertificationKey, boolean> = {
    DO: false,
    DOP: false,
    IGP: false,
    IGA: false,
    ARTESANIA_GARANTIZADA: false
  };

  constructor(
    private elRef: ElementRef<HTMLElement>,
    private geoService: GeolocationService,
    private cdr: ChangeDetectorRef
  ) {}

  get chips(): ChipDef[] {
    return this.categoryChips;
  }

  get isLocationAvailable(): boolean {
    return this.proximityActive && this.geoStatus === 'granted' && this.geoService.currentCoords !== null;
  }

  get locationStatusMessage(): string {
    switch (this.geoStatus) {
      case 'idle':        return 'Activa tu ubicación para filtrar por proximidad.';
      case 'requesting':  return 'Solicitando acceso a tu ubicación…';
      case 'granted': {
        if (this.locationName) return this.locationName;
        const acc = Math.round(this.geoService.currentCoords?.accuracy ?? 0);
        return `Ubicación activa (±${acc}m)`;
      }
      case 'denied':      return 'Permiso de ubicación denegado. Revisa los permisos del navegador.';
      case 'unavailable': return 'Tu navegador no soporta geolocalización.';
      case 'error':       return 'No se pudo obtener tu ubicación. Inténtalo de nuevo.';
      default:            return '';
    }
  }

  get activeCount(): number {
    const cats = this.selectedCategories.size;
    const certs = Object.values(this.certifications).filter(Boolean).length;
    const prox = (this.isLocationAvailable && this.proximityKm !== 50) ? 1 : 0;
    const q = this.query.trim() ? 1 : 0;
    const favs = this.favoritesOnly ? 1 : 0;
    return cats + certs + prox + q + favs;
  }

  get showChipsRow(): boolean {
    if (this.chipsMode === 'open') return true;
    if (this.chipsMode === 'closed') return false;
    return this.isActive;
  }

  getChipsButtonTooltip(): string {
    if (this.selectedCategories.size === 0) {
      return 'Categorías';
    }
    const selected = Array.from(this.selectedCategories).join(', ');
    return `Categorías: ${selected}`;
  }

  getFiltersButtonTooltip(): string {
    if (this.activeCount === 0) {
      return 'Filtros';
    }
    return `Filtros activos: ${this.activeCount}`;
  }

  onFocusIn(): void {
    this.isActive = true;
  }

  onFocusOut(ev: FocusEvent): void {
    const next = (ev.relatedTarget as Node | null) ?? null;
    if (next && this.elRef.nativeElement.contains(next)) return;
    // No cerrar mientras el modal geo está abierto o se está procesando la solicitud
    if (this.showGeoModal || this.geoRequesting) return;

    queueMicrotask(() => {
      if (this.showGeoModal || this.geoRequesting) return;
      const activeElement = document.activeElement;
      if (activeElement && this.elRef.nativeElement.contains(activeElement)) return;

      this.isActive = false;
      this.isAdvancedOpen = false;
      // Volvemos al comportamiento por defecto (auto) al salir del overlay.
      this.chipsMode = 'auto';
    });
  }

  toggleChips(): void {
    // Cuando estamos en modo 'auto' (estado inicial) queremos abrir explícitamente
    // la fila de chips al primer click, sin depender del foco recién ganado que
    // puede marcarla como visible y provocar un “abre y cierra” inmediato.
    if (this.chipsMode === 'auto') {
      this.chipsMode = 'open';
    } else {
      this.chipsMode = this.chipsMode === 'open' ? 'closed' : 'open';
    }
    this.isActive = true;
  }

  toggleAdvanced(): void {
    this.isAdvancedOpen = !this.isAdvancedOpen;
    this.isActive = true;
  }

  onQueryInput(value: string): void {
    this.query = value;
    this.emitFilters();
  }

  clearQuery(): void {
    this.query = '';
    this.emitFilters();
    queueMicrotask(() => this.searchInput?.nativeElement?.focus());
  }

  toggleCategory(key: CategoryKey): void {
    if (this.selectedCategories.has(key)) this.selectedCategories.delete(key);
    else this.selectedCategories.add(key);
    this.emitFilters();
  }

  /** Abre el modal de confirmación personalizado */
  openGeoModal(): void {
    this.showGeoModal = true;
    this.isAdvancedOpen = true;
    this.isActive = true;
  }

  /** El usuario cancela el modal personalizado */
  cancelGeoModal(): void {
    this.showGeoModal = false;
    this.isAdvancedOpen = true;
    this.isActive = true;
  }

  /** El usuario confirma: llamamos a la API del navegador */
  async confirmGeoRequest(): Promise<void> {
    this.showGeoModal = false;
    this.geoRequesting = true;
    this.geoStatus = 'requesting';
    // Mantenemos el panel abierto durante y después del proceso
    this.isAdvancedOpen = true;
    this.isActive = true;

    const coords = await this.geoService.requestLocation();
    this.geoStatus = this.geoService.currentStatus;
    this.geoRequesting = false;
    // Restauramos el panel por si el blur lo cerró mientras esperábamos
    this.isAdvancedOpen = true;
    this.isActive = true;

    if (coords) {
      this.proximityActive = true;
      this.reverseGeocode(coords.lat, coords.lon);
      this.emitFilters();
    }
  }

  /** Geocodificación inversa con Nominatim para mostrar el nombre de la localidad. */
  private async reverseGeocode(lat: number, lon: number): Promise<void> {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=es`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const addr = (data.address ?? {}) as Record<string, string>;
      this.locationName =
        addr['city'] ??
        addr['town'] ??
        addr['village'] ??
        addr['municipality'] ??
        addr['county'] ??
        addr['state'] ??
        '';
      this.cdr.detectChanges();
    } catch {
      // fallo silencioso — se muestra el texto de fallback
    }
  }

  /** Reactiva el filtro de proximidad sin pedir permisos (ubicación ya concedida) */
  reactivateProximity(): void {
    this.proximityActive = true;
    this.emitFilters();
  }

  /** Desactiva el filtro de proximidad (llamable desde el padre vía @ViewChild) */
  deactivateProximity(): void {
    this.proximityActive = false;
    this.emitFilters();
  }

  setProximityKm(value: number): void {
    this.proximityKm = value;
    this.emitFilters();
  }

  toggleCertification(key: CertificationKey, checked?: boolean): void {
    this.certifications[key] = typeof checked === 'boolean' ? checked : !this.certifications[key];
    this.emitFilters();
  }

  toggleFavoritesOnly(checked?: boolean): void {
    this.favoritesOnly = typeof checked === 'boolean' ? checked : !this.favoritesOnly;
    this.emitFilters();
  }

  deactivateFavoritesOnly(): void {
    if (!this.favoritesOnly) {
      return;
    }
    this.favoritesOnly = false;
    this.emitFilters();
  }

  reset(): void {
    this.query = '';
    this.proximityKm = 50;
    this.proximityActive = false;  // deja de filtrar por proximidad
    this.selectedCategories.clear();
    this.certifications = { DO: false, DOP: false, IGP: false, IGA: false, ARTESANIA_GARANTIZADA: false };
    this.favoritesOnly = false;
    this.isAdvancedOpen = false;
    this.chipsMode = 'auto';
    this.isActive = false;
    this.emitFilters();
  }

  /**
   * Abre el panel de búsqueda directamente en la sección de proximidad.
   * Se usa desde Home cuando el usuario pulsa el chip de proximidad activa.
   */
  openProximityPanel(): void {
    this.isActive = true;
    this.isAdvancedOpen = true;
    this.chipsMode = 'open';
    this.showGeoModal = false;
    queueMicrotask(() => this.searchInput?.nativeElement?.focus());
  }

  /**
   * Cierra dropdown/chips para despejar el mapa.
   * Se usa desde Home cuando se abre la ficha lateral.
   */
  closePanels(): void {
    this.isAdvancedOpen = false;
    this.chipsMode = 'auto';
    this.isActive = false;
    queueMicrotask(() => this.searchInput?.nativeElement?.blur());
  }

  /**
   * Preselecciona una categoría por su label (p.ej. "Textil", "Barro y Alfarería").
   * Usado cuando el usuario llega desde la ficha de producto.
   */
  preselectCategory(categoryLabel: string): void {
    const chip = this.categoryChips.find(c => c.label === categoryLabel);
    if (!chip) return;
    this.selectedCategories.clear();
    this.selectedCategories.add(chip.key);
    this.chipsMode = 'open';
    this.isActive = true;
    this.emitFilters();
    this.cdr.detectChanges();
  }

  /**
   * Aplica filtros de categoría y/o certificación provenientes del chatbot.
   * Reemplaza cualquier filtro activo del mismo tipo (no acumula).
   * Llamado desde HomeComponent cuando el bot emite mapFilterChange.
   *
   * @param categoryLabel  Nombre de categoría tal como devuelve el backend
   *                       ("Alimentación", "Textil", "Barro y Alfarería",
   *                        "Madera y mueble", "Otros"). Vacío = sin cambio.
   * @param certName       Nombre de certificación ("DO", "DOP", "IGP", "IGA",
   *                       "Artesanía garantizada"). Vacío = sin cambio.
   */
  applyChatbotFilters(categoryLabel: string, certName: string): void {
    // --- Mapeo categoría label → CategoryKey ---
    const categoryLabelMap: Record<string, CategoryKey> = {
      'Alimentación':    'agroalimentario',
      'Textil':          'textil',
      'Barro y Alfarería': 'barro_alfareria',
      'Madera y mueble': 'madera_mueble',
      'Otros':           'otros'
    };

    // --- Mapeo certificación nombre → CertificationKey ---
    const certNameMap: Record<string, CertificationKey> = {
      'DO':                      'DO',
      'DOP':                     'DOP',
      'IGP':                     'IGP',
      'IGA':                     'IGA',
      'Denominación de Origen': 'DO',
      'Denominacion de Origen': 'DO',
      'Denominación de Origen Protegida': 'DOP',
      'Denominacion de Origen Protegida': 'DOP',
      'Indicación Geográfica Protegida': 'IGP',
      'Indicacion Geografica Protegida': 'IGP',
      'Indicación Geográfica Artesanal': 'IGA',
      'Indicacion Geografica Artesanal': 'IGA',
      'Artesanía garantizada':   'ARTESANIA_GARANTIZADA',
      'artesania garantizada':   'ARTESANIA_GARANTIZADA'
    };

    // Aplicar categoría (reemplaza la selección actual)
    if (categoryLabel) {
      const catKey = categoryLabelMap[categoryLabel];
      if (catKey) {
        this.selectedCategories.clear();
        this.selectedCategories.add(catKey);
        this.chipsMode = 'open';
        this.isActive = true;
      }
    }

    // Aplicar certificación (reemplaza cualquier certificación activa)
    if (certName) {
      // Normalizar: a veces el backend devuelve "oficial", "DO", "Artesanía garantizada"
      const normalizedCert = certName.trim();
      const certKey = certNameMap[normalizedCert] ?? certNameMap[normalizedCert.toUpperCase()];
      if (certKey) {
        // Limpiar todas las certificaciones primero (reemplazar, no acumular)
        this.certifications = { DO: false, DOP: false, IGP: false, IGA: false, ARTESANIA_GARANTIZADA: false };
        this.certifications[certKey] = true;
        this.isAdvancedOpen = true;
        this.isActive = true;
      }
    }

    this.emitFilters();
    this.cdr.detectChanges();
  }

  private emitFilters(): void {
    const certs = (Object.keys(this.certifications) as CertificationKey[]).filter(
      (k) => this.certifications[k]
    );

    const userCoords = this.proximityActive ? this.geoService.currentCoords : null;

    this.filtersChange.emit({
      query: this.query,
      categories: Array.from(this.selectedCategories),
      proximityKm: this.proximityKm,
      certifications: certs,
      favoritesOnly: this.favoritesOnly,
      userLat: userCoords?.lat ?? null,
      userLon: userCoords?.lon ?? null
    });
  }
}
