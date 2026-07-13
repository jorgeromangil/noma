import * as THREE from 'three';
import { UtilsGeo } from '../utils-geo';
import { CityLabel, CITY_LABELS } from '../../data/city-labels';

/**
 * Configuración de visibilidad por tier.
 * showDistance: distancia máxima (cámara → target) para que el tier aparezca.
 * hideDistance: distancia mínima (opcional) - se oculta cuando está más cerca que este valor.
 * Calibrado para PLANET_RADIUS = 80 (comunidades ≈ 92, provincias ≈ 86).
 */
interface TierConfig {
  showDistance: number;
  hideDistance?: number; // Si existe, define un rango de visibilidad
  fadeInSpeed: number;
  fadeOutSpeed: number;
  scale: number;
  color: string;
  maxOpacity: number;
}

const TIER_CONFIG: Record<number, TierConfig> = {
  0: { showDistance: 96,   hideDistance: 84,  fadeInSpeed: 0.05, fadeOutSpeed: 0.09, scale: 0.26, color: '#F0F0F0', maxOpacity: 0.68 }, // Comunidades
  1: { showDistance: 999,  hideDistance: 96,  fadeInSpeed: 0.06, fadeOutSpeed: 0.10, scale: 0.55, color: '#FFFFFF', maxOpacity: 1.0  }, // Madrid/Barcelona
  2: { showDistance: 84,   fadeInSpeed: 0.05, fadeOutSpeed: 0.08, scale: 0.23, color: '#E0E0E0', maxOpacity: 0.65 }, // Ciudades
  3: { showDistance: 86,   fadeInSpeed: 0.04, fadeOutSpeed: 0.08, scale: 0.18, color: '#C0C0C0', maxOpacity: 0.60 }, // Provincias (sincronizado con capa)
  4: { showDistance: 82,   fadeInSpeed: 0.04, fadeOutSpeed: 0.07, scale: 0.12, color: '#A0A0A0', maxOpacity: 0.55 }, // Municipios: visibles al acercarse a los pines
};

/** Escala del planeta (planet.scale.x). Coincide con PLANET_RADIUS = 80. */
const PLANET_SCALE = 80;

interface LabelEntry {
  sprite: THREE.Sprite;
  data: CityLabel;
  /** Posición en espacio LOCAL del planeta (radio ≈ 1) */
  localPos: THREE.Vector3;
  currentOpacity: number;
  targetOpacity: number;
  /** Escala animada para efecto de zoom al aparecer */
  currentScale: number;
  targetScale: number;
  /** Escala base del sprite (width, height) */
  baseScaleX: number;
  baseScaleY: number;
}

export class CityLabelManager {
  private labels: LabelEntry[] = [];
  private scene: THREE.Scene;
  private _tempVec = new THREE.Vector3(); // reutilizable, evita GC
  private _time = 0; // Para animación de "respiración"
  private readonly provinciasLabelFadeRange = 5.0;

  constructor(scene: THREE.Scene, cities?: CityLabel[]) {
    this.scene = scene;
    const list = cities ?? CITY_LABELS;
    this.createLabels(list);
  }

  // ────────────────────────────────────────────────────
  //  Sprite de texto con fondo semitransparente
  // ────────────────────────────────────────────────────
  private createTextSprite(text: string, color: string, scale: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    const fontSize = 64;
    const padding = 24; // Más padding para efectos

    // Fuente más elegante con letter-spacing
    ctx.font = `600 ${fontSize}px 'Plus Jakarta Sans', 'Inter', 'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif`;
    ctx.letterSpacing = '0.5px'; // Espaciado entre letras para elegancia
    const textWidth = ctx.measureText(text).width;

    canvas.width  = Math.ceil(textWidth + padding * 2);
    canvas.height = Math.ceil(fontSize * 1.4 + padding * 2);

    const w = canvas.width;
    const h = canvas.height;
    const centerX = w / 2;
    const centerY = h / 2;

    // Configurar fuente nuevamente tras cambiar tamaño del canvas
    ctx.font = `600 ${fontSize}px 'Plus Jakarta Sans', 'Inter', 'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif`;
    ctx.letterSpacing = '0.5px';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // ═══ CAPA 1: Sombra proyectada suave (debajo) ═══
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillText(text, centerX, centerY + 1);
    
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // ═══ CAPA 2: Halo oscuro multicapa (contorno) ═══
    // Exterior → Interior con degradado de intensidad
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = `rgba(0, 0, 0, ${0.7 - i * 0.15})`;
      ctx.lineWidth = 7 - i * 1.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeText(text, centerX, centerY);
    }

    // ═══ CAPA 3: Gradiente principal del texto ═══
    const gradient = ctx.createLinearGradient(0, centerY - fontSize / 2, 0, centerY + fontSize / 2);
    gradient.addColorStop(0, this.lightenColor(color, 1.08));    // Más claro arriba
    gradient.addColorStop(0.4, color);                           // Color base
    gradient.addColorStop(0.7, color);                           // Color base
    gradient.addColorStop(1, this.darkenColor(color, 0.82));    // Más oscuro abajo
    
    ctx.fillStyle = gradient;
    ctx.fillText(text, centerX, centerY);

    // ═══ CAPA 4: Brillo superior (highlight) ═══
    const highlightGradient = ctx.createLinearGradient(0, centerY - fontSize / 2, 0, centerY);
    highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.30)');
    highlightGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.12)');
    highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    
    ctx.fillStyle = highlightGradient;
    ctx.fillText(text, centerX, centerY - 0.5);

    // ═══ CAPA 5: Borde brillante fino (edge light) ═══
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 0.8;
    ctx.strokeText(text, centerX, centerY);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthTest: false,
      sizeAttenuation: true,
    });

    const sprite = new THREE.Sprite(material);
    const aspect = w / h;
    sprite.scale.set(scale * aspect, scale, 1);
    sprite.renderOrder = -10; // Por debajo de los pines

    return sprite;
  }

  // ────────────────────────────────────────────────────
  //  Oscurecer un color para gradiente
  // ────────────────────────────────────────────────────
  private darkenColor(hex: string, factor: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.floor(r * factor)}, ${Math.floor(g * factor)}, ${Math.floor(b * factor)})`;
  }

  // ────────────────────────────────────────────────────
  //  Aclarar un color para gradiente
  // ────────────────────────────────────────────────────
  private lightenColor(hex: string, factor: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const newR = Math.min(255, Math.floor(r * factor));
    const newG = Math.min(255, Math.floor(g * factor));
    const newB = Math.min(255, Math.floor(b * factor));
    return `rgb(${newR}, ${newG}, ${newB})`;
  }

  // ────────────────────────────────────────────────────
  //  Genera todos los sprites y los añade a la ESCENA.
  //  Las posiciones se guardan en espacio LOCAL del planeta
  //  (radio ≈ 1) y se transforman cada frame con matrixWorld.
  // ────────────────────────────────────────────────────
  private createLabels(cities: CityLabel[]): void {
    for (const city of cities) {
      const config = TIER_CONFIG[city.tier] ?? TIER_CONFIG[4];
      const sprite = this.createTextSprite(city.name, config.color, config.scale);

      // Radio en espacio local del planeta (surface ≈ 1, apenas elevado)
      const localElevation = (UtilsGeo.PLANET_RADIUS + 0.15) / PLANET_SCALE;
      const localPos = UtilsGeo.latLonToVector3(city.lat, city.lon, localElevation);

      this.scene.add(sprite);
      this.labels.push({
        sprite,
        data: city,
        localPos,
        currentOpacity: 0,
        targetOpacity: 0,
        currentScale: 0.7, // Comienza pequeño
        targetScale: 1.0,
        baseScaleX: sprite.scale.x,
        baseScaleY: sprite.scale.y,
      });
    }
  }

  // ────────────────────────────────────────────────────
  //  update() — llamar cada frame.
  //  Transforma las posiciones locales a mundo usando
  //  la matrixWorld del planeta (rotación + escala).
  // ────────────────────────────────────────────────────
  public update(zoomDistance: number, planet: THREE.Object3D): void {
    this._time += 0.016; // ~60fps

    for (const entry of this.labels) {
      const config = TIER_CONFIG[entry.data.tier] ?? TIER_CONFIG[4];

      if (entry.data.tier === 3) {
        // Provincias: sincronizamos la curva con la capa de provincias (86 -> 81).
        const provinciasBlend = this.computeDistanceBlend(
          zoomDistance,
          config.showDistance,
          config.showDistance - this.provinciasLabelFadeRange
        );
        entry.targetOpacity = provinciasBlend * config.maxOpacity;
        entry.targetScale = 0.7 + 0.3 * provinciasBlend;
      } else {
        // Determinar si debe mostrarse según el rango de distancia
        let shouldShow = false;
        if (config.hideDistance !== undefined) {
          // Tier con rango: visible solo entre hideDistance y showDistance
          shouldShow = zoomDistance >= config.hideDistance && zoomDistance < config.showDistance;
        } else {
          // Tier normal: visible cuando distance < showDistance
          shouldShow = zoomDistance < config.showDistance;
        }

        entry.targetOpacity = shouldShow ? config.maxOpacity : 0;
        entry.targetScale = shouldShow ? 1.0 : 0.7; // Escala pequeña al desaparecer
      }

      const speed = entry.targetOpacity > entry.currentOpacity
        ? config.fadeInSpeed
        : config.fadeOutSpeed;

      // Animar opacidad
      entry.currentOpacity += (entry.targetOpacity - entry.currentOpacity) * speed;
      entry.currentOpacity = Math.max(0, Math.min(entry.currentOpacity, config.maxOpacity));

      // Animar escala (más rápido que opacidad para efecto "pop")
      const scaleSpeed = speed * 1.5;
      entry.currentScale += (entry.targetScale - entry.currentScale) * scaleSpeed;
      entry.currentScale = Math.max(0.7, Math.min(entry.currentScale, 1.0));

      const mat = entry.sprite.material as THREE.SpriteMaterial;
      mat.opacity = entry.currentOpacity;
      entry.sprite.visible = entry.currentOpacity > 0.01;

      if (entry.sprite.visible) {
        // Transformar posición local → mundo con la matrix del planeta
        this._tempVec.copy(entry.localPos).applyMatrix4(planet.matrixWorld);
        entry.sprite.position.copy(this._tempVec);

        // Aplicar escala animada + efecto "respiración" para tier 1
        let finalScale = entry.currentScale;
        
        if (entry.data.tier === 1) {
          // Pulso sutil (±3%) para capitales principales cuando están visibles
          if (entry.currentOpacity > 0.8) {
            const pulse = 1.0 + Math.sin(this._time * 2.0) * 0.03;
            finalScale *= pulse;
          }
        }
        
        entry.sprite.scale.set(
          entry.baseScaleX * finalScale,
          entry.baseScaleY * finalScale,
          1
        );
      }
    }
  }

  private computeDistanceBlend(currentDistance: number, fadeStartDistance: number, fadeEndDistance: number): number {
    if (!Number.isFinite(currentDistance)) return 0;
    if (fadeStartDistance <= fadeEndDistance) return currentDistance <= fadeEndDistance ? 1 : 0;
    const t = THREE.MathUtils.clamp(
      (fadeStartDistance - currentDistance) / Math.max(fadeStartDistance - fadeEndDistance, 1e-6),
      0,
      1
    );
    return t * t * (3 - 2 * t);
  }

  // ────────────────────────────────────────────────────
  //  Limpieza
  // ────────────────────────────────────────────────────
  public dispose(): void {
    for (const entry of this.labels) {
      this.scene.remove(entry.sprite);
      (entry.sprite.material as THREE.SpriteMaterial).map?.dispose();
      (entry.sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.labels = [];
  }
}
