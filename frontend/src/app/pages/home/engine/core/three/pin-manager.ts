import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { UtilsGeo } from '../utils-geo';

export interface PinHoverEvent {
    product: any;
    screenX: number;
    screenY: number;
}

export interface ClusterHoverEvent {
    products: any[];
    count: number;
    screenX: number;
    screenY: number;
}

interface LocationData {
    id?: string | number;
    name: string;
    lat: number;
    lon: number;
    product?: any;
}

export class PinManager {
    public readonly scene: THREE.Scene;
    private locations: LocationData[];
    private planetModel: THREE.Object3D | null = null;
    /** Mapa de modelos de pin por categoría normalizada */
    private readonly categoryPinModels: Record<string, string> = {
        'alimentacion': '/assets/models/pin-alimentacion.glb',
        'textil': '/assets/models/pin-textil.glb',
        'barro y alfareria': '/assets/models/pin-barro.glb',
        'madera y mueble': '/assets/models/pin-madera.glb',
        'otros': '/assets/models/pin-otros.glb',
    };
    /** Pin por defecto si no hay categoría */
    private readonly defaultPinModel: string = '/assets/models/marcador_noma.glb';
    /** Caché de modelos GLTF por ruta */
    private pinModelCache: Map<string, THREE.Object3D> = new Map();
    private pinTemplate: THREE.Object3D | null = null; // Mantén para clusters
    private pinsList: THREE.Object3D[] = [];
    private clusterPins: THREE.Object3D[] = [];
    private interactables: THREE.Object3D[] = [];
    private activePin: THREE.Object3D | null = null;
    private hoveredPin: THREE.Object3D | null = null;

    private raycasterHover: THREE.Raycaster = new THREE.Raycaster();
    private raycasterClick: THREE.Raycaster = new THREE.Raycaster();

    private currentOpacity: number = 0.0;
    private targetOpacity: number = 0.0;
    private readonly fadeSpeed: number = 0.08;

    private targetStraight: boolean = false;
    private readonly breathScaleAmp: number = 0.06;
    private readonly breathLiftAmp: number = 0.00025;
    private readonly breathSpeed: number = 0.15;

    private clusterFactor: number | null = null;
    private clusterLockUntil: number = 0;
    private clusterDirty: boolean = false;
    /** Última cámara usada en update — permite ajustar escala instantánea al reconstruir clusters */
    private lastCamera: THREE.Camera | null = null;
    /** Vector reutilizable para evitar allocations por frame en update() */
    private _tmpVec: THREE.Vector3 = new THREE.Vector3();
    /** Posición temporal en mundo para cálculos de escala dinámica */
    private _tmpWorldPos: THREE.Vector3 = new THREE.Vector3();
    /** Caché de texturas de sprites por conteo — evita recrear canvas en cada rebuild */
    private _spriteTexCache = new Map<number, THREE.CanvasTexture>();

    // --- Escalado dependiente del zoom ---
    /** Distancia (al centro) en la que consideramos que el pin tiene su tamaño base */
    private readonly pinScaleReferenceDistance: number = 90;
    /** FOV de referencia para mantener el tamaño aparente (en grados) */
    private readonly pinScaleReferenceFov: number = 75;
    /** Altura de viewport de referencia usada para normalizar el tamaño en píxeles */
    private readonly pinScaleReferenceHeight: number = 1080;
    /** Límites para evitar que la compensación de zoom desborde */
    private readonly pinScaleMinMultiplier: number = 0.05;
    private readonly pinScaleMaxMultiplier: number = 4.0;
    /** Tamaño absoluto máximo permitido (unidades de mundo) */
    private readonly pinScaleAbsoluteMax: number = 0.0025;
    /** Suavizado para que el cambio de tamaño no parpadee al hacer zoom */
    private readonly pinScaleLerp: number = 0.18;

    /** Distancia de zoom reportada por los controles (rueda del ratón) */
    private zoomDistanceOverride: number | null = null;

    // --- HOVER PREVIEW ---
    private onHoverCallback: ((event: PinHoverEvent | null) => void) | null = null;
    private onClusterHoverCallback: ((event: ClusterHoverEvent | null) => void) | null = null;
    private lastHoveredPinRef: THREE.Object3D | null = null;
    private rendererRef: THREE.WebGLRenderer | null = null;
    /** Frames consecutivos sin detectar el pin antes de emitir null — evita parpadeo con animaciones */
    private hoverMissFrames: number = 0;
    private readonly HOVER_MISS_TOLERANCE = 5;
    /** Bloquea la emisión de eventos hover desde el loop (p.ej. mientras hay modal abierto) */
    private suppressHover: boolean = false;
    private suppressHoverTimer: ReturnType<typeof setTimeout> | null = null;

    private clusterLevels = [
        { minDistance: 88.0, factor: 1  },   // grilla de  1°  (~111km) — ve toda España
        { minDistance: 82.0, factor: 2  },   // grilla de 0.5° (~55km)  — zoom regional
        { minDistance: 0.0,  factor: 3  }   // zoom máximo — grilla fina (~27km), nunca se deshace
    ];

    /** Marca que debemos recalcular interactables/visibilidad en el próximo update */
    private _requestClusterRebuild(): void {
        this.clusterDirty = true;
    }

    constructor(scene: THREE.Scene, locations: LocationData[]) {
        this.scene = scene;
        this.locations = locations;
    }

    /** Registra el renderer para poder proyectar coordenadas 3D → 2D */
    public setRenderer(renderer: THREE.WebGLRenderer): void {
        this.rendererRef = renderer;
    }

    /** Registra un callback que se invocará cuando cambie el pin hovereado */
    public onHoverChange(callback: (event: PinHoverEvent | null) => void): void {
        this.onHoverCallback = callback;
    }

    /** Registra un callback que se invocará cuando cambie el cluster hovereado */
    public onClusterHoverChange(callback: (event: ClusterHoverEvent | null) => void): void {
        this.onClusterHoverCallback = callback;
    }

    /** Inyecta la distancia de zoom (rueda) para desacoplar la escala del pin respecto a su distancia real */
    public setZoomDistance(distance: number | null): void {
        this.zoomDistanceOverride = distance ?? null;
    }

    public setLocations(locations: LocationData[]): void {
        this.locations = Array.isArray(locations) ? locations : [];

        // Si aún no se han cargado los modelos, basta con actualizar `this.locations`.
        // El callback del loader usará el valor actual cuando termine.
        if (!this.planetModel || !this.pinTemplate) return;

        this._clearAllPins();
        this._placePinsFromTemplate();
        this._rebuildClusters(this.clusterFactor);
        this.clusterDirty = false;
        this._applyInstantScale(this.lastCamera);
    }

    public setPinsTargetVisibility(isVisible: boolean): void {
        this.targetOpacity = isVisible ? 1.0 : 0.0;
    }

    public setPinsTargetRotation(straight: boolean): void {
        this.targetStraight = straight;
    }

    public loadModels(planetModel: THREE.Object3D): void {
        this.planetModel = planetModel; 
        this._loadAndPlacePins();
    }

    private _clearAllPins(): void {
        if (!this.planetModel) return;
        this.clusterPins.forEach((c) => this.planetModel?.remove(c));
        this.pinsList.forEach((p) => this.planetModel?.remove(p));
        this.clusterPins = [];
        this.pinsList = [];
        this.interactables = [];
        this.activePin = null;
        this.hoveredPin = null;
        this.lastHoveredPinRef = null;
        this.hoverMissFrames = 0;
    }

    private _placePinsFromTemplate(): void {
        if (!this.planetModel) return;

        const currentRotX = this.planetModel.rotation.x;
        const currentRotY = this.planetModel.rotation.y;
        this.planetModel.rotation.set(0, 0, 0);
        this.planetModel.updateMatrixWorld(true);

        this.locations.forEach((loc) => {
            // --- Selección de modelo según categoría ---
            let category = '';
            if (loc.product && (loc.product.category || loc.product.categoria)) {
                category = String(loc.product.category || loc.product.categoria).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
            }
            const modelPath = this.categoryPinModels[category] || this.defaultPinModel;

            let pinModel = this.pinModelCache.get(modelPath);
            if (!pinModel) {
                // Si no está en caché, usar el pin por defecto (ya cargado) hasta que se cargue el real
                pinModel = this.pinTemplate || undefined;
            }
            if (!pinModel) return; // Nada que clonar

            const pin = pinModel.clone(true);
            const pinScale = pinModel.scale.x || 0.001;

            const idealLocalPos = UtilsGeo.latLonToVector3(loc.lat, loc.lon);
            const direction = idealLocalPos.clone().normalize();

            const raycaster = new THREE.Raycaster();
            const rayOrigin = direction.clone().multiplyScalar(100);
            const rayDirection = direction.clone().negate();
            raycaster.set(rayOrigin, rayDirection);
            const intersects = raycaster.intersectObject(this.planetModel!, true);

            const finalPos = intersects.length > 0
                ? this.planetModel!.worldToLocal(intersects[0].point.clone())
                : idealLocalPos;

            pin.position.copy(finalPos);
            const up = new THREE.Vector3(0, 1, 0);
            pin.quaternion.setFromUnitVectors(up, direction);
            pin.rotateY(Math.PI / 2);

            pin.userData = {
                name: loc.name,
                product: loc.product ?? null,
                lat: Number(loc.lat),
                lon: Number(loc.lon),
                originalScale: pinScale,
                originalPosition: finalPos.clone(),
                straightQuat: pin.quaternion.clone(),
                // Quaternion inclinado calculado sin clonar el GLTF completo
                tiltedQuat: pin.quaternion.clone().multiply(
                    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
                ),
                spinAngle: 0,
                isCluster: false,
                clusterHidden: false,
                breathPhase: 0
            };

            this.pinsList.push(pin);
            this.planetModel!.add(pin);
        });

        this.planetModel.rotation.set(currentRotX, currentRotY, 0);
    }

    private _loadAndPlacePins(): void {
        if (!this.planetModel) return;
        const pinLoader = new GLTFLoader();

        // Cargar todos los modelos de pines por categoría y el por defecto
        const allModels = Object.values(this.categoryPinModels);
        if (!allModels.includes(this.defaultPinModel)) allModels.push(this.defaultPinModel);

        let loadedCount = 0;
        const totalToLoad = allModels.length;

        allModels.forEach((modelPath) => {
            pinLoader.load(modelPath, (gltfPin) => {
                const pinModelOriginal = gltfPin.scene;
                const pinScale = 0.012;
                pinModelOriginal.scale.set(pinScale, pinScale, pinScale);
                // Material transparente
                pinModelOriginal.traverse(obj => {
                    const material = (obj as any).material;
                    if (material) {
                        const materials = Array.isArray(material) ? material : [material];
                        materials.forEach((m: any) => { m.transparent = true; m.opacity = 0; });
                    }
                });
                this.pinModelCache.set(modelPath, pinModelOriginal);
                // El primero cargado será el template por defecto (para clusters y fallback)
                if (!this.pinTemplate || modelPath === this.defaultPinModel) {
                    this.pinTemplate = pinModelOriginal;
                }
                loadedCount++;
                // Cuando todos los modelos estén cargados, coloca los pines
                if (loadedCount === totalToLoad) {
                    this._placePinsFromTemplate();
                    this._rebuildClusters(this.clusterFactor);
                }
            });
        });
    }

    private _quantKey(lat: number, lon: number, factor: number): string {
        const qLat = Math.round(lat * factor) / factor;
        const qLon = Math.round(lon * factor) / factor;
        return `${qLat.toFixed(5)}|${qLon.toFixed(5)}`;
    }

    private _createCountSprite(count: number): THREE.Sprite {
        let tex = this._spriteTexCache.get(count);
        if (!tex) {
            const size = 256;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d')!;

            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2 - 20, 0, Math.PI * 2);
            ctx.fillStyle = 'white';
            ctx.fill();
            ctx.lineWidth = 15;
            ctx.strokeStyle = 'black';
            ctx.stroke();

            ctx.fillStyle = 'black';
            ctx.font = 'bold 160px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(count), size / 2, size / 2);

            tex = new THREE.CanvasTexture(canvas);
            this._spriteTexCache.set(count, tex);
        }
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(1.0, 1.0, 1);
        sprite.position.set(0, 2.2, 0);
        return sprite;
    }

    private _makeClusterPin(members: THREE.Object3D[], count: number): THREE.Object3D {
        const cluster = this.pinTemplate!.clone(true);
        const clusterScale = (this.pinTemplate!.scale.x) * 1.8; // Pin visualmente más grande
        cluster.scale.set(clusterScale, clusterScale, clusterScale);

        const avg = new THREE.Vector3();
        members.forEach(m => avg.add(m.userData['originalPosition']));
        avg.multiplyScalar(1 / count);
        
        const distOriginal = (members[0].userData['originalPosition'] as THREE.Vector3).length();
        avg.setLength(distOriginal);

        cluster.position.copy(avg);
        const direction = avg.clone().normalize();
        cluster.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        cluster.rotateY(Math.PI / 2);

        cluster.add(this._createCountSprite(count));
        
        // Guardar productos y referencias a pines miembros para el panel de desglose
        const memberProducts = members
            .map(m => m.userData?.['product'])
            .filter((p: any) => !!p);

        cluster.userData = {
            isCluster: true,
            clusterHidden: false,
            count,
            memberProducts,
            memberPins: members,
            originalScale: clusterScale,
            originalPosition: avg.clone(),
            straightQuat: cluster.quaternion.clone(),
            tiltedQuat: cluster.quaternion.clone().multiply(
                new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
            ),
            spinAngle: 0,
            breathPhase: 0
        };
        return cluster;
    }

    private _rebuildClusters(factor: number | null): void {
        if (!this.planetModel || !this.pinTemplate) return;

        this.clusterPins.forEach(c => this.planetModel?.remove(c));
        this.clusterPins = [];
        this.pinsList.forEach(p => p.userData['clusterHidden'] = false);

        if (factor === null) {
            this.interactables = [...this.pinsList];
            return;
        }

        // ── PASO 1: clustering geográfico por celda ──────────────────────────
        const groups = new Map<string, THREE.Object3D[]>();
        this.pinsList.forEach(p => {
            const key = this._quantKey(p.userData['lat'], p.userData['lon'], factor);
            const arr = groups.get(key) ?? [];
            arr.push(p);
            groups.set(key, arr);
        });

        const nextInteractables: THREE.Object3D[] = [];
        const soloCandiates: THREE.Object3D[] = [];

        for (const [, members] of groups) {
            if (members.length <= 1) {
                soloCandiates.push(members[0]);
            } else {
                members.forEach(m => m.userData['clusterHidden'] = true);
                const clusterPin = this._makeClusterPin(members, members.length);
                this.clusterPins.push(clusterPin);
                this.planetModel.add(clusterPin);
                nextInteractables.push(clusterPin);
            }
        }

        // ── PASO 2: clustering por proximidad en pantalla ────────────────────
        // Agrupa pines solitarios que se solaparían visualmente (independiente del zoom)
        const PIXEL_THRESHOLD = 28;
        if (this.lastCamera && soloCandiates.length >= 2) {
            const screenPos = soloCandiates.map(p => this._projectToScreen(p, this.lastCamera!));
            const assigned = new Set<number>();

            for (let i = 0; i < soloCandiates.length; i++) {
                if (assigned.has(i)) continue;

                const group: THREE.Object3D[] = [soloCandiates[i]];
                assigned.add(i);

                for (let j = i + 1; j < soloCandiates.length; j++) {
                    if (assigned.has(j)) continue;
                    const dx = screenPos[i].x - screenPos[j].x;
                    const dy = screenPos[i].y - screenPos[j].y;
                    if (Math.sqrt(dx * dx + dy * dy) < PIXEL_THRESHOLD) {
                        group.push(soloCandiates[j]);
                        assigned.add(j);
                    }
                }

                if (group.length > 1) {
                    group.forEach(m => m.userData['clusterHidden'] = true);
                    const clusterPin = this._makeClusterPin(group, group.length);
                    this.clusterPins.push(clusterPin);
                    this.planetModel!.add(clusterPin);
                    nextInteractables.push(clusterPin);
                } else {
                    nextInteractables.push(soloCandiates[i]);
                }
            }
        } else {
            soloCandiates.forEach(p => nextInteractables.push(p));
        }

        this.interactables = nextInteractables;
    }

    /** Ajusta la escala inmediatamente tras reconstruir clusters para evitar saltos visuales */
    private _applyInstantScale(camera: THREE.Camera | null): void {
        if (!camera) return;
        const pins = [...this.pinsList, ...this.clusterPins];
        pins.forEach((pin) => {
            const rawScale = (pin.userData['originalScale'] as number) * this._computePinScaleMultiplier(camera, pin);
            const clampedScale = Math.min(rawScale, this.pinScaleAbsoluteMax);
            pin.scale.set(clampedScale, clampedScale, clampedScale);
        });
    }

    public expandCluster(_cluster: THREE.Object3D, lockMs: number = 3000): void {
        this.clusterFactor = null;
        this.clusterLockUntil = performance.now() + lockMs;
        this._requestClusterRebuild();
    }

    public setClusterDistance(distance: number): void {
        if (performance.now() < this.clusterLockUntil) return;
        const next = this._pickFactorByDistance(distance);
        if (next === this.clusterFactor) return;
        this.clusterFactor = next;
        this._requestClusterRebuild();
    }

    private _pickFactorByDistance(distance: number): number | null {
        for (const lvl of this.clusterLevels) {
            if (distance >= lvl.minDistance) return lvl.factor;
        }
        return null;
    }

    public update(mouse: THREE.Vector2, camera: THREE.Camera): void {
        if (this.pinsList.length === 0) return;
        this.lastCamera = camera;

        if (this.clusterDirty) {
            this._rebuildClusters(this.clusterFactor);
            this.clusterDirty = false;
            this.hoveredPin = null;
            this.lastHoveredPinRef = null;
            this._applyInstantScale(camera);
        }

        this.currentOpacity += (this.targetOpacity - this.currentOpacity) * this.fadeSpeed;

        let currentPin: THREE.Object3D | null = null;

        if (this.currentOpacity > 0.1) {
            this.raycasterHover.setFromCamera(mouse, camera);
            const intersects = this.raycasterHover.intersectObjects(this.interactables, true);
            
            if (intersects.length > 0) {
                let obj = intersects[0].object;
                while (obj.parent && !this.interactables.includes(obj)) obj = obj.parent;
                currentPin = obj;
            }

            // --- EMITIR EVENTO DE HOVER PREVIEW ---
            if (!this.suppressHover && (this.onHoverCallback || this.onClusterHoverCallback)) {
                if (currentPin) {
                    // Pin detectado: reiniciar contador de misses
                    this.hoverMissFrames = 0;
                    if (currentPin !== this.lastHoveredPinRef) {
                        this.lastHoveredPinRef = currentPin;
                    }
                    
                    // Verificar si es un cluster
                    if (currentPin.userData?.['isCluster'] && this.onClusterHoverCallback) {
                        const memberProducts = currentPin.userData['memberProducts'] || [];
                        const count = currentPin.userData['count'] || memberProducts.length;
                        const screenPos = this._projectToScreen(currentPin, camera);
                        this.onClusterHoverCallback({ 
                            products: memberProducts, 
                            count: count,
                            screenX: screenPos.x, 
                            screenY: screenPos.y 
                        });
                        // Limpiar el hover de pin individual si existe
                        if (this.onHoverCallback) {
                            this.onHoverCallback(null);
                        }
                    } 
                    // Pin individual
                    else if (currentPin.userData?.['product'] && this.onHoverCallback) {
                        const screenPos = this._projectToScreen(currentPin, camera);
                        this.onHoverCallback({ product: currentPin.userData['product'], screenX: screenPos.x, screenY: screenPos.y });
                        // Limpiar el hover de cluster si existe
                        if (this.onClusterHoverCallback) {
                            this.onClusterHoverCallback(null);
                        }
                    }
                } else {
                    // No hay hit: acumular frames de miss antes de aceptar la salida
                    this.hoverMissFrames++;
                    if (this.hoverMissFrames >= this.HOVER_MISS_TOLERANCE) {
                        if (this.lastHoveredPinRef !== null) {
                            this.lastHoveredPinRef = null;
                            if (this.onHoverCallback) this.onHoverCallback(null);
                            if (this.onClusterHoverCallback) this.onClusterHoverCallback(null);
                        }
                    } else if (this.lastHoveredPinRef) {
                        // Mantener posición del último pin/cluster conocido durante los frames de tolerancia
                        const screenPos = this._projectToScreen(this.lastHoveredPinRef, camera);
                        
                        if (this.lastHoveredPinRef.userData?.['isCluster'] && this.onClusterHoverCallback) {
                            const memberProducts = this.lastHoveredPinRef.userData['memberProducts'] || [];
                            const count = this.lastHoveredPinRef.userData['count'] || memberProducts.length;
                            this.onClusterHoverCallback({ 
                                products: memberProducts, 
                                count: count,
                                screenX: screenPos.x, 
                                screenY: screenPos.y 
                            });
                        } else if (this.lastHoveredPinRef.userData?.['product'] && this.onHoverCallback) {
                            this.onHoverCallback({ product: this.lastHoveredPinRef.userData['product'], screenX: screenPos.x, screenY: screenPos.y });
                        }
                    }
                }
            }

            if (this.hoveredPin && this.hoveredPin !== currentPin) {
                const originalPos = this.hoveredPin.userData['originalPosition'] as THREE.Vector3;
                const originalScale = this.hoveredPin.userData['originalScale'] as number;
                const dynamicScaleRaw = originalScale * this._computePinScaleMultiplier(camera, this.hoveredPin);
                const dynamicScale = Math.min(dynamicScaleRaw, this.pinScaleAbsoluteMax);
                this.hoveredPin.position.lerp(originalPos, 0.1);
                this.hoveredPin.scale.lerp(this._tmpVec.set(dynamicScale, dynamicScale, dynamicScale), 0.1);
                this.hoveredPin.userData['breathPhase'] = 0;
                if (this.hoveredPin.position.distanceTo(originalPos) < 0.00001) this.hoveredPin = null;
            }

            if (currentPin) {
                this.hoveredPin = currentPin;
                const originalPos = this.hoveredPin.userData['originalPosition'] as THREE.Vector3;
                const directionOut = originalPos.clone().normalize();
                const baseLift = 0.00045;
                const baseScaleRaw = (this.hoveredPin.userData['originalScale'] as number) *
                    this._computePinScaleMultiplier(camera, this.hoveredPin);
                const baseScale = Math.min(baseScaleRaw, this.pinScaleAbsoluteMax);

                if (this.targetStraight) {
                    const targetPos = originalPos.clone().add(directionOut.multiplyScalar(baseLift));
                    this.hoveredPin.position.lerp(targetPos, 0.1);
                    const targetScale = Math.min(baseScale * 1.3, this.pinScaleAbsoluteMax);
                    this.hoveredPin.scale.lerp(this._tmpVec.set(targetScale, targetScale, targetScale), 0.1);
                } else {
                    const phase = (this.hoveredPin.userData['breathPhase'] ?? 0) + this.breathSpeed;
                    this.hoveredPin.userData['breathPhase'] = phase;
                    const lift = baseLift + this.breathLiftAmp * Math.sin(phase);
                    const targetPos = originalPos.clone().add(directionOut.multiplyScalar(lift));
                    this.hoveredPin.position.lerp(targetPos, 0.12);
                    const hoverBaseScale = Math.min(baseScale * 1.05, this.pinScaleAbsoluteMax);
                    const targetScale = Math.min(hoverBaseScale * (1 + this.breathScaleAmp * Math.sin(phase)), this.pinScaleAbsoluteMax);
                    this.hoveredPin.scale.lerp(this._tmpVec.set(targetScale, targetScale, targetScale), 0.12);
                }
                document.body.style.cursor = 'pointer';
            } else if (!this.hoveredPin) { 
                document.body.style.cursor = 'default';
            }
        }

        [...this.pinsList, ...this.clusterPins].forEach(pin => {
            const zoomScale = this._computePinScaleMultiplier(camera, pin);
            const baseScale = (pin.userData['originalScale'] as number) * zoomScale;
            const clampedBaseScale = Math.min(baseScale, this.pinScaleAbsoluteMax);
            // Aplicamos la corrección de escala por zoom en todos los pines que no estén siendo hovereados.
            if (pin !== this.hoveredPin) {
                pin.scale.lerp(this._tmpVec.set(clampedBaseScale, clampedBaseScale, clampedBaseScale), this.pinScaleLerp);
            }
            pin.visible = !pin.userData['clusterHidden'] && this.currentOpacity > 0.01;
            pin.traverse(obj => {
                const mat = (obj as any).material;
                if (mat) {
                    const mats = Array.isArray(mat) ? mat : [mat];
                    mats.forEach((m: any) => m.opacity = this.currentOpacity);
                }
            });
            const targetQuat = this.targetStraight ? pin.userData['straightQuat'] : pin.userData['tiltedQuat'];
            if ((pin === this.hoveredPin || pin === this.activePin) && this.targetStraight) {
                pin.userData['spinAngle'] += 0.05;
                const spinQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pin.userData['spinAngle']);
                pin.quaternion.slerp((pin.userData['straightQuat'] as THREE.Quaternion).clone().multiply(spinQuat), 0.1);
            } else {
                pin.quaternion.slerp(targetQuat, 0.05);
            }
        });
    }

    public handleClick(mouse: THREE.Vector2, camera: THREE.Camera): THREE.Object3D | null {
        if (this.currentOpacity < 0.8) return null;
        this.raycasterClick.setFromCamera(mouse, camera);
        const intersects = this.raycasterClick.intersectObjects(this.interactables, true);
        if (intersects.length > 0) {
            let obj = intersects[0].object;
            while (obj.parent && !this.interactables.includes(obj)) obj = obj.parent;
            this.activePin = obj; 
            return obj;
        }
        this.activePin = null; 
        return null;
    }

    public clearActivePin(): void { this.activePin = null; }

    /** Activa o desactiva la emisión de eventos hover desde el loop */
    public setSuppressHover(value: boolean): void {
        this.suppressHover = value;
        if (this.suppressHoverTimer) {
            clearTimeout(this.suppressHoverTimer);
            this.suppressHoverTimer = null;
        }
        if (value) {
            // Emitir null inmediatamente para limpiar cualquier hover visible
            this.lastHoveredPinRef = null;
            this.hoverMissFrames = this.HOVER_MISS_TOLERANCE;
            if (this.onHoverCallback) this.onHoverCallback(null);
            if (this.onClusterHoverCallback) this.onClusterHoverCallback(null);
        }
    }

    /** Fuerza la limpieza del estado de hover y lo reactiva automáticamente tras el cooldown */
    public clearHover(cooldownMs: number = 800): void {
        this.setSuppressHover(true);
        this.suppressHoverTimer = setTimeout(() => {
            this.suppressHoverTimer = null;
            this.suppressHover = false;
        }, cooldownMs);
    }

    public setActivePin(pin: THREE.Object3D | null): void {
        this.activePin = pin;
        if (this.activePin) {
            this.activePin.userData['spinAngle'] = this.activePin.userData['spinAngle'] ?? 0;
        }
    }

    public getPinByProductId(productId: string): THREE.Object3D | null {
        const wanted = String(productId || '');
        if (!wanted) return null;

        const pin = this.pinsList.find((p) => {
            const prod = p.userData?.['product'];
            const uid = String(prod?.uid || '');
            const id = String(prod?._id || '');
            return uid === wanted || id === wanted;
        });

        return pin ?? null;
    }

    /** Libera todos los recursos GPU/memoria: materiales, geometrías y texturas de sprites */
    public dispose(): void {
        if (this.suppressHoverTimer) {
            clearTimeout(this.suppressHoverTimer);
            this.suppressHoverTimer = null;
        }
        this._clearAllPins();
        this._spriteTexCache.forEach(tex => tex.dispose());
        this._spriteTexCache.clear();
        if (this.pinTemplate) {
            this.pinTemplate.traverse(obj => {
                const mesh = obj as THREE.Mesh;
                if (mesh.geometry) mesh.geometry.dispose();
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                mats.forEach((m: any) => m?.dispose?.());
            });
            this.pinTemplate = null;
        }
    }

    /** Calcula un factor de escala que mantiene el tamaño aparente del pin al variar el zoom */
    private _computePinScaleMultiplier(camera: THREE.Camera, pin: THREE.Object3D): number {
        if (!(camera instanceof THREE.PerspectiveCamera)) return 1;

        pin.getWorldPosition(this._tmpWorldPos);
        let effectiveDistance: number;
        if (this.zoomDistanceOverride != null) {
            // Escalado uniforme según la distancia de zoom (rueda), ignorando la posición del pin.
            effectiveDistance = Math.max(this.zoomDistanceOverride, 1e-4);
        } else {
            // Usamos la profundidad en espacio de cámara (z) para evitar que los pines laterales crezcan más.
            this._tmpVec.copy(this._tmpWorldPos).applyMatrix4(camera.matrixWorldInverse);
            const depth = Math.abs(this._tmpVec.z);
            effectiveDistance = Math.max(depth, 1e-4);
        }

        const viewportHeight = this.rendererRef?.domElement?.clientHeight || window.innerHeight || this.pinScaleReferenceHeight;
        const refHeight = this.pinScaleReferenceHeight;

        const fovRad = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov || this.pinScaleReferenceFov);
        const refFovRad = THREE.MathUtils.degToRad(this.pinScaleReferenceFov);
        const tanHalf = Math.tan(fovRad * 0.5);
        const refTanHalf = Math.tan(refFovRad * 0.5);

        const distanceTerm = effectiveDistance / this.pinScaleReferenceDistance;
        const fovTerm = tanHalf / refTanHalf;
        const heightTerm = refHeight / viewportHeight;

        const multiplier = distanceTerm * fovTerm * heightTerm;
        return THREE.MathUtils.clamp(multiplier, this.pinScaleMinMultiplier, this.pinScaleMaxMultiplier);
    }

    /** Devuelve los productos almacenados en un pin de cluster */
    public getClusterProducts(clusterPin: THREE.Object3D): any[] {
        if (!clusterPin.userData?.['isCluster']) return [];
        return clusterPin.userData['memberProducts'] || [];
    }

    /**
     * Predice si los pines miembros de un cluster se solaparían visualmente
     * al expandirse, proyectando sus posiciones a coordenadas de pantalla.
     * Devuelve true si algún par de miembros estaría a menos de `pixelThreshold` px.
     */
    public wouldMembersOverlap(clusterPin: THREE.Object3D, camera: THREE.Camera, pixelThreshold: number = 45): boolean {
        const memberPins: THREE.Object3D[] = clusterPin.userData?.['memberPins'];
        if (!memberPins || memberPins.length < 2) return false;

        // Proyectamos las posiciones originales (mundo) de cada miembro
        const screenPositions: { x: number; y: number }[] = [];
        for (const pin of memberPins) {
            const origPos = pin.userData?.['originalPosition'] as THREE.Vector3;
            if (!origPos) continue;

            // Necesitamos la posición en mundo: aplicamos la matriz del planeta
            const worldPos = origPos.clone();
            if (this.planetModel) {
                worldPos.applyMatrix4(this.planetModel.matrixWorld);
            }
            const projected = worldPos.clone().project(camera);

            const canvas = this.rendererRef?.domElement;
            const width = canvas?.clientWidth || window.innerWidth;
            const height = canvas?.clientHeight || window.innerHeight;

            screenPositions.push({
                x: ((projected.x + 1) / 2) * width,
                y: ((-projected.y + 1) / 2) * height
            });
        }

        // Verificar si algún par se solaparía
        for (let i = 0; i < screenPositions.length; i++) {
            for (let j = i + 1; j < screenPositions.length; j++) {
                const dx = screenPositions[i].x - screenPositions[j].x;
                const dy = screenPositions[i].y - screenPositions[j].y;
                if (Math.sqrt(dx * dx + dy * dy) < pixelThreshold) {
                    return true;
                }
            }
        }

        return false;
    }

    /** Proyecta un objeto 3D a coordenadas de pantalla (píxeles) */
    private _projectToScreen(obj: THREE.Object3D, camera: THREE.Camera): { x: number; y: number } {
        const worldPos = new THREE.Vector3();
        obj.getWorldPosition(worldPos);
        const projected = worldPos.clone().project(camera);

        const canvas = this.rendererRef?.domElement;
        const width = canvas?.clientWidth || window.innerWidth;
        const height = canvas?.clientHeight || window.innerHeight;

        return {
            x: ((projected.x + 1) / 2) * width,
            y: ((-projected.y + 1) / 2) * height
        };
    }
}
