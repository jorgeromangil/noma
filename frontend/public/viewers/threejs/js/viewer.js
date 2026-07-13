/**
 * Three.js 3D Model Viewer
 * Renderiza modelos GLB/GLTF con soporte completo de texturas y materiales
 */

class ThreeJSViewer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.model = null;
        this.gltfLoader = null;
        this.spinner = document.getElementById('loading-spinner');
        this.errorBox = document.getElementById('error-message');
        
        this.ambientLight = null;
        this.directionalLight = null;

        this.defaultCameraDistance = 50;
        
        this.init();
    }

    init() {
        // Escena
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        this.scene.fog = new THREE.Fog(0x000000, 50, 200);

        // Cámara
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        this.camera.position.set(0, 0, 50);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true, 
            alpha: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.container.appendChild(this.renderer.domElement);

        // Controles
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.autoRotate = false;
        this.controls.autoRotateSpeed = 5;
        this.applyZoomLimits(this.defaultCameraDistance);
        this.controls.enableZoom = true;
        this.controls.zoomSpeed = 1.2; // Velocidad de zoom cómoda

        // Iluminación
        this.setupLighting();

        // Loader
        this.gltfLoader = new THREE.GLTFLoader();

        // Event listeners
        this.setupEventListeners();

        // Render loop
        this.animate();

        // Resize
        window.addEventListener('resize', () => this.onWindowResize());
    }

    applyZoomLimits(baseDistance) {
        const safeBase = (typeof baseDistance === 'number' && baseDistance > 0) ? baseDistance : this.defaultCameraDistance;
        this.controls.minDistance = Math.max(0.5, safeBase * 0.35);
        this.controls.maxDistance = safeBase * 3.0;
    }

    setupLighting() {
        // Luz ambiental
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(this.ambientLight);

        // Luz directa
        this.directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        this.directionalLight.position.set(5, 10, 7);
        this.directionalLight.castShadow = true;
        this.directionalLight.shadow.mapSize.width = 2048;
        this.directionalLight.shadow.mapSize.height = 2048;
        this.directionalLight.shadow.camera.left = -50;
        this.directionalLight.shadow.camera.right = 50;
        this.directionalLight.shadow.camera.top = 50;
        this.directionalLight.shadow.camera.bottom = -50;
        this.scene.add(this.directionalLight);

        // Segunda luz para rellenar sombras
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-5, 5, -7);
        this.scene.add(fillLight);
    }

    setupEventListeners() {
        // Control de intensidad de luz ambiental
        const ambientSlider = document.getElementById('ambient-intensity');
        if (ambientSlider) {
            ambientSlider.addEventListener('change', (e) => {
                this.ambientLight.intensity = parseFloat(e.target.value);
            });
        }

        // Control de intensidad de luz directa
        const directionalSlider = document.getElementById('directional-intensity');
        if (directionalSlider) {
            directionalSlider.addEventListener('change', (e) => {
                this.directionalLight.intensity = parseFloat(e.target.value);
            });
        }

        // Control de color de fondo
        const bgColor = document.getElementById('bg-color');
        if (bgColor) {
            bgColor.addEventListener('change', (e) => {
                const color = new THREE.Color(e.target.value);
                this.scene.background = color;
                this.scene.fog.color = color;
            });
        }

        // Resetear vista
        const resetBtn = document.getElementById('reset-view');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetView());
        }
    }

    loadModel(modelPath) {
        this.showSpinner();

        const actualPath = this.constructModelPath(modelPath);
        
        this.gltfLoader.load(
            actualPath,
            (gltf) => {
                this.handleModelLoaded(gltf);
            },
            (progress) => {
                const percent = Math.round((progress.loaded / progress.total) * 100);
            },
            (error) => {
                console.error('[ThreeJS Viewer] Error cargando modelo:', error);
                this.showError('Error al cargar el modelo: ' + error.message);
            }
        );
    }

    constructModelPath(modelPath) {
        // Handle diferentes formatos de rutas
        if (modelPath.startsWith('/') || modelPath.startsWith('http://') || modelPath.startsWith('https://')) {
            if (modelPath.startsWith('/')) {
                return window.location.origin + modelPath;
            }
            return modelPath;
        }
        
        // Mapeo de nombres predefinidos
        const modelMap = {
            'teapot': '/assets/models/teapot.glb',
            'kangaroo': '/assets/models/kangaroo.glb',
            'bunny': '/assets/models/bunny.glb',
            'suzanne': '/assets/models/suzanne.glb',
            'buddha': '/assets/models/buddha.glb'
        };
        
        return modelMap[modelPath] || modelPath;
    }

    handleModelLoaded(gltf) {
        // Remover modelo anterior
        if (this.model) {
            this.scene.remove(this.model);
        }

        this.model = gltf.scene;

        // Configurar materiales y sombras
        this.model.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = true;
                
                // Mejorar materiales
                if (node.material) {
                    node.material.side = THREE.DoubleSide; // Renderizar ambos lados
                    
                    // Asegurar que las texturas se rendericen correctamente
                    if (node.material.map) {
                        node.material.map.colorSpace = THREE.SRGBColorSpace;
                    }
                    if (node.material.normalMap) {
                        node.material.normalScale.set(1, 1);
                    }
                    
                    node.material.needsUpdate = true;
                }
            }
        });

        // Agregar modelo a la escena
        this.scene.add(this.model);

        // Ajustar cámara automáticamente
        this.fitCameraToObject();

        this.hideSpinner();
    }

    fitCameraToObject() {
        const box = new THREE.Box3().setFromObject(this.model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraZ = maxDim / 2 / Math.tan(fov / 2);

        // Padding para ver el modelo completo cómodamente (1.5x)
        cameraZ *= 1.5;

        this.camera.position.copy(center);
        this.camera.position.z += cameraZ;

        this.applyZoomLimits(cameraZ);

        this.controls.target.copy(center);
        this.controls.update();
        
    }

    resetView() {
        if (this.model) {
            this.fitCameraToObject();
            this.controls.autoRotate = false;
            document.getElementById('directional-intensity').value = '1';
            document.getElementById('ambient-intensity').value = '0.5';
            this.directionalLight.intensity = 1;
            this.ambientLight.intensity = 0.5;
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        if (this.controls) {
            this.controls.update();
        }

        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
    }

    showSpinner() {
        if (this.spinner) {
            this.spinner.classList.remove('hide');
        }
    }

    hideSpinner() {
        if (this.spinner) {
            this.spinner.classList.add('hide');
        }
    }

    showError(message) {
        console.error('[ThreeJS Viewer] Error:', message);
        if (this.errorBox) {
            this.errorBox.textContent = message;
            this.errorBox.classList.add('show');
            setTimeout(() => {
                this.errorBox.classList.remove('show');
            }, 5000);
        }
        this.hideSpinner();
    }
}

// Instancia global del visor
let viewer = null;

document.addEventListener('DOMContentLoaded', () => {
    viewer = new ThreeJSViewer('container');

    // Cargar modelo desde URL parameter
    const params = new URLSearchParams(window.location.search);
    const modelPath = params.get('model');

    if (modelPath) {
        viewer.loadModel(modelPath);
    }
});
