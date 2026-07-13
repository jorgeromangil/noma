import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CityLabelManager } from './city-label-manager';

export class PlanetManager {
    private scene: THREE.Scene;
    private planet: THREE.Object3D | null = null;
    private loader: GLTFLoader;

    // --- COMUNIDADES ---
    private comunidades: THREE.Object3D | null = null;
    private comunidadesMaterial: THREE.Material[] = []; 
    private areComunidadesVisible: boolean = false; 
    public zoomDistanceThreshold: number = 96; 
    private currentOpacity: number = 0.0;
    private targetOpacity: number = 0.0;
    private readonly fadeSpeed: number = 0.05;
    private readonly comunidadesFadeInRange: number = 8.0;
    private readonly comunidadesOpacityWhenProvinciasVisible: number = 0.38;

    // --- PROVINCIAS ---
    private provincias: THREE.Object3D | null = null;
    private provinciasMaterial: THREE.Material[] = []; 
    private areProvinciasVisible: boolean = false; 
    public zoomDistanceThresholdProvincias: number = 81; 
    private currentOpacityProvincias: number = 0.0;
    private targetOpacityProvincias: number = 0.0;
    private readonly fadeSpeedProvincias: number = 0.04;
    private readonly fadeOutSpeedProvincias: number = 0.08;
    private readonly provinciasFadeInRange: number = 5.0;
    private readonly provinciasUnlockComunidadesBlend: number = 0.92;

    private camera!: THREE.PerspectiveCamera;
    private controls: any;

    // --- LABELS DE CIUDADES ---
    private cityLabelManager: CityLabelManager | null = null;
    private readonly planetCenterWorld = new THREE.Vector3();

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.loader = new GLTFLoader();
    }

    public setCamera(camera: THREE.PerspectiveCamera): void {
        this.camera = camera;
    }

    public setControls(controls: any): void {
        this.controls = controls;
    }

    public async loadPlanet(
        path: string = '/assets/models/prueba_de_provincias.glb'
    ): Promise<THREE.Object3D> {

        return new Promise((resolve, reject) => {
            this.loader.load(path, (gltf) => {

                this.planet = gltf.scene;
                this.planet.scale.set(80, 80, 80);
                this.planet.rotation.set(0, 0, 0);

                //  CONFIGURACIÓN COMUNIDADES
                this.comunidades = this.planet.getObjectByName("Comunidades_autonomas") || null;
                if (this.comunidades) {
                    this.setupFadeObject(this.comunidades, this.comunidadesMaterial, this.currentOpacity);
                    this.comunidades.visible = false; 
                    this.areComunidadesVisible = false;
                }

                //  CONFIGURACIÓN PROVINCIAS 
                this.provincias = this.planet.getObjectByName("Provincias") || null;
                if (this.provincias) {
                
                    this.setupFadeObject(this.provincias, this.provinciasMaterial, this.currentOpacityProvincias);
                    
            
                    this.provincias.visible = false; 
                    this.areProvinciasVisible = false;
                }

                this.scene.add(this.planet);

                // Inicializar labels de ciudades por jerarquía de zoom
                this.cityLabelManager = new CityLabelManager(this.scene);

                resolve(this.planet);

            }, undefined, reject);
        });
    }

    
    private setupFadeObject(object: THREE.Object3D, materialArray: THREE.Material[], initialOpacity: number) {
        object.traverse((obj) => {
            if (obj instanceof THREE.Mesh && obj.material) {
                const sourceMaterials = Array.isArray(obj.material) ? obj.material : [obj.material];
                const clonedMaterials = sourceMaterials.map((sourceMaterial) => {
                    // Evita que comunidades/provincias compartan material y se pisen opacidad.
                    const material = sourceMaterial.clone();
                    material.transparent = true;
                    material.opacity = initialOpacity;
                    material.visible = true;
                    material.depthWrite = false;
                    materialArray.push(material);
                    return material;
                });
                obj.material = Array.isArray(obj.material) ? clonedMaterials : clonedMaterials[0];
            }
        });
    }

    public update(): void {
        if (!this.planet) return;

        // --- Animación inicial del planeta ---
        this.planet.rotation.y += (Math.PI * 0.55 - this.planet.rotation.y) * 0.02;
        this.planet.rotation.x += (0.678 - this.planet.rotation.x) * 0.02;

        if (!this.camera || !this.controls) return;

        // Distancia de zoom estable para 2D/3D: cámara respecto al centro del planeta.
        // En modo 3D el controls.target está sobre la superficie y deja de ser buena métrica.
        const zoomDistance = this.computeZoomDistanceForLayers();
        const zoomMetric = this.computePerspectiveZoomMetric(zoomDistance);
        const comunidadesBlend = this.computeZoomBlendByMetric(
            zoomMetric,
            this.zoomDistanceThreshold + this.comunidadesFadeInRange,
            this.zoomDistanceThreshold
        );
        const provinciasBlendByMetric = this.computeZoomBlendByMetric(
            zoomMetric,
            this.zoomDistanceThresholdProvincias + this.provinciasFadeInRange,
            this.zoomDistanceThresholdProvincias
        );
        const provinciasUnlocked = comunidadesBlend >= this.provinciasUnlockComunidadesBlend;
        const provinciasBlend = provinciasUnlocked ? provinciasBlendByMetric : 0;

        // --- LÓGICA DE FADE COMUNIDADES ---
        if (this.comunidades && this.comunidadesMaterial.length > 0) {
            const comunidadesAttenuation = THREE.MathUtils.lerp(
                1,
                this.comunidadesOpacityWhenProvinciasVisible,
                provinciasBlend
            );
            this.targetOpacity = comunidadesBlend * comunidadesAttenuation;
            this.areComunidadesVisible = this.targetOpacity > 0.001;

            this.currentOpacity += (this.targetOpacity - this.currentOpacity) * this.fadeSpeed;
            this.currentOpacity = THREE.MathUtils.clamp(this.currentOpacity, 0, 1);
            this.applyOpacity(this.comunidades, this.comunidadesMaterial, this.currentOpacity);
        }

        // --- LÓGICA DE FADE PROVINCIAS ---
        if (this.provincias && this.provinciasMaterial.length > 0) {
            this.targetOpacityProvincias = provinciasBlend;
            this.areProvinciasVisible = this.targetOpacityProvincias > 0.001;
            const isFadingIn = this.targetOpacityProvincias > this.currentOpacityProvincias;
            const dynamicSpeed = isFadingIn ? this.fadeSpeedProvincias : this.fadeOutSpeedProvincias;

            this.currentOpacityProvincias += (this.targetOpacityProvincias - this.currentOpacityProvincias) * dynamicSpeed;
            this.currentOpacityProvincias = THREE.MathUtils.clamp(this.currentOpacityProvincias, 0, 1);
            
            this.applyOpacity(this.provincias, this.provinciasMaterial, this.currentOpacityProvincias);
        }

        // --- LABELS DE CIUDADES (fade por zoom) ---
        if (this.cityLabelManager && this.planet) {
            this.cityLabelManager.update(zoomDistance, this.planet);
        }
    }
 
    private applyOpacity(object: THREE.Object3D, materials: THREE.Material[], opacity: number) {
        if (opacity > 0.001) {
            if (!object.visible) object.visible = true;
            materials.forEach(m => m.opacity = opacity);
        } else {
            object.visible = false;
        }
    }

    private computeZoomDistanceForLayers(): number {
        if (!this.planet) return this.camera.position.length();
        this.planet.getWorldPosition(this.planetCenterWorld);
        return this.camera.position.distanceTo(this.planetCenterWorld);
    }

    private computePerspectiveZoomMetric(distance: number): number {
        const fovRad = THREE.MathUtils.degToRad(this.camera.fov || 60);
        const invTanHalfFov = 1 / Math.tan(fovRad * 0.5);
        return invTanHalfFov / Math.max(distance, 1e-4);
    }

    private computeZoomBlendByMetric(currentMetric: number, fadeStartDistance: number, fadeEndDistance: number): number {
        if (!Number.isFinite(currentMetric)) return 0;
        if (fadeStartDistance <= fadeEndDistance) {
            const endMetric = this.computePerspectiveZoomMetric(fadeEndDistance);
            return currentMetric >= endMetric ? 1 : 0;
        }

        const startMetric = this.computePerspectiveZoomMetric(fadeStartDistance);
        const endMetric = this.computePerspectiveZoomMetric(fadeEndDistance);
        const t = THREE.MathUtils.clamp(
            (currentMetric - startMetric) / Math.max(endMetric - startMetric, 1e-6),
            0,
            1
        );
        return t * t * (3 - 2 * t);
    }

    public getPlanet(): THREE.Object3D | null {
        return this.planet;
    }

    public dispose(): void {
        this.cityLabelManager?.dispose();
        this.cityLabelManager = null;
    }
}
