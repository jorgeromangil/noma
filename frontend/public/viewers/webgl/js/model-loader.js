/**
 * Universal Model Loader
 * Soporta múltiples formatos: JSON (OBJ convertido), GLB (GLTF binario)
 */

class ModelLoader {
    constructor() {
        this.cache = {};
        this.gltfLoader = null;
        this.texturePixelCache = new Map();
        this.initGLTFLoader();
    }

    initGLTFLoader() {
        // Inicializar Three.js para cargar GLB
        
        if (typeof THREE === 'undefined') {
            console.error('[ModelLoader] THREE no está definido');
            return;
        }
        
        // Intentar diferentes formas de acceder a GLTFLoader
        let GLTFLoaderClass = null;
        
        // Forma 1: THREE.GLTFLoader (más común en versiones recientes)
        if (THREE.GLTFLoader) {
            GLTFLoaderClass = THREE.GLTFLoader;
        }
        // Forma 2: Esperar a que se haya cargado desde unpkg/CDN
        else if (typeof window !== 'undefined' && window.GLTFLoader) {
            GLTFLoaderClass = window.GLTFLoader;
        }
        
        if (GLTFLoaderClass) {
            try {
                this.gltfLoader = new GLTFLoaderClass();
                if (typeof this.gltfLoader.setCrossOrigin === 'function') {
                    this.gltfLoader.setCrossOrigin('anonymous');
                }

            } catch (error) {
                console.error('[ModelLoader] Error al instanciar GLTFLoader:', error);
            }
        } else {
            console.error('[ModelLoader] THREE.GLTFLoader no está disponible en ninguna forma conocida');
        }
    }

    /**
     * Detecter formato del modelo por extensión
     */
    getFormat(modelName) {
        const lowerName = modelName.toLowerCase();
        if (lowerName.endsWith('.glb')) return 'glb';
        if (lowerName.endsWith('.gltf')) return 'gltf';
        if (lowerName.endsWith('.obj')) return 'obj';
        return 'json'; // suposición: es JSON (OBJ convertido)
    }

    async detectFormatFromResponse(modelPath) {
        try {
            const response = await fetch(modelPath, { method: 'GET' });
            if (!response.ok) {
                console.warn('[ModelLoader] detectFormatFromResponse HTTP no OK:', response.status);
                return null;
            }

            const contentType = (response.headers.get('content-type') || '').toLowerCase();

            if (contentType.includes('model/gltf-binary') || contentType.includes('application/octet-stream')) {
                return 'glb';
            }
            if (contentType.includes('model/gltf+json') || contentType.includes('application/json') || contentType.includes('text/json')) {
                return 'json';
            }
            return null;
        } catch (error) {
            console.warn('[ModelLoader] detectFormatFromResponse falló:', error.message || error);
            return null;
        }
    }

    /**
     * Cargar modelo de cualquier formato con detección inteligente
     */
    async loadModel(modelPath) {
        
        // Verifica caché
        if (this.cache[modelPath]) {
            return this.cache[modelPath];
        }

        // Detectar formato por extensión primero
        let format = this.getFormat(modelPath);
        const detectedByContentType = await this.detectFormatFromResponse(modelPath);
        if (detectedByContentType) {
            format = detectedByContentType;
        }

        let modelData;
        
        try {
            
            // Para URLs sin extensión clara, intentar JSON primero, fallback a GLB
            if (format === 'json') {
                try {

                    modelData = await this.loadJSON(modelPath);
                    format = 'json'; // Confirmado JSON
                } catch (jsonError) {

                    // Si falló parsear como JSON, intentar como GLB
                    format = 'glb';
                    modelData = await this.loadGLB(modelPath);
                }
            } else {
                // Para formatos bien definidos, seguir el switch normal
                switch(format) {
                    case 'glb':
                    case 'gltf':

                        modelData = await this.loadGLB(modelPath);
                        break;
                    case 'json':

                        modelData = await this.loadJSON(modelPath);
                        break;
                    case 'obj':

                        modelData = await this.loadOBJ(modelPath);
                        break;
                    default:
                        throw new Error(`Formato desconocido: ${format}`);
                }
            }

            // Cachea el resultado
            this.cache[modelPath] = modelData;
            return modelData;
        } catch (error) {
            console.error(`Error cargando ${modelPath}:`, error);
            throw error;
        }
    }

    /**
     * Cargar JSON (OBJ pre-procesado)
     */
    async loadJSON(modelPath) {
        return fetch(modelPath)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then(data => ({
                format: 'json',
                data: data,
                vertices: data.vertices || [],
                normals: data.normals || [],
                vertexNormals: data.vertexNormals || [],
                colors: data.colors || [],
                indices: data.indices || []
            }));
    }

    /**
     * Cargar GLB (GLTF binario) y convertir a formato interno
     */
    async loadGLB(modelPath) {
        
        if (!this.gltfLoader && typeof THREE === 'undefined') {
            throw new Error('Three.js no está cargado. Agrega: <script src="https://unpkg.com/three@0.128.0/build/three.min.js"></script>');
        }

        if (!this.gltfLoader) {

            this.initGLTFLoader();
            if (!this.gltfLoader) {
                throw new Error('No se pudo inicializar GLTFLoader');
            }
        }


        return new Promise((resolve, reject) => {
            this.gltfLoader.load(
                modelPath,
                (gltf) => {

                    try {
                        const model = this.convertGLTFToVertexData(gltf);

                        resolve({
                            format: 'glb',
                            data: gltf,
                            ...model
                        });
                    } catch (error) {
                        console.error('[ModelLoader] Error convirtiendo GLTF a datos de vértices:', error);
                        reject(error);
                    }
                },
                (progress) => {
                    // Progress callback - no logging
                },
                (error) => {
                    console.error('[ModelLoader] Error en gltfLoader.load():', error);
                    reject(new Error(`Error cargando GLB: ${error.message || error}`));
                }
            );
        });
    }

    /**
     * Cargar OBJ (requiere convertirlo a JSON primero mediante servidor)
     */
    async loadOBJ(modelPath) {
        // Los archivos OBJ se deben pre-convertir a JSON en el servidor
        // Por ahora, asumimos que están en formato JSON
        const jsonPath = modelPath.replace(/\.obj$/, '.json');
        return this.loadJSON(jsonPath);
    }

    /**
     * Extraer información de textura y renderizarla sobre vértices
     * Mapea colores de textura usando UV coordinates
     */
    extractTextureAndApplyToVertices(texture, positions, geometry, vertexIndices = null) {
        try {
            if (!texture || !texture.image) return null;
            
            const image = texture.image;
            const uvArray = geometry.attributes.uv ? geometry.attributes.uv.array : null;
            
            if (!uvArray) {
                // Si no hay UVs, extraer color dominante como fallback
                return this.extractDominantColor(image);
            }
            
            // Crear canvas para procesar textura
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Usar resolución alta para mejor detalle
            canvas.width = Math.min(image.width || 512, 512);
            canvas.height = Math.min(image.height || 512, 512);
            
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // Mapear colores de textura a vértices por UV
            const vertexCount = vertexIndices ? vertexIndices.length : (positions.length / 3);
            const colors = new Array(vertexCount * 3);
            
            for (let i = 0; i < vertexCount; i++) {
                const sourceVertexIndex = vertexIndices ? vertexIndices[i] : i;
                const uvIndex = sourceVertexIndex * 2;
                if (uvIndex + 1 < uvArray.length) {
                    let u = uvArray[uvIndex];
                    let v = uvArray[uvIndex + 1];
                    
                    // Normalizar UVs al rango [0, 1] con wrap correcto
                    u = ((u % 1.0) + 1.0) % 1.0;
                    v = ((v % 1.0) + 1.0) % 1.0;
                    
                    // Muestreo bilineal para suavizar artefactos de "punteado"
                    const x = u * (canvas.width - 1);
                    const y = v * (canvas.height - 1);
                    const x0 = Math.floor(x);
                    const y0 = Math.floor(y);
                    const x1 = Math.min(x0 + 1, canvas.width - 1);
                    const y1 = Math.min(y0 + 1, canvas.height - 1);
                    const tx = x - x0;
                    const ty = y - y0;

                    const i00 = (y0 * canvas.width + x0) * 4;
                    const i10 = (y0 * canvas.width + x1) * 4;
                    const i01 = (y1 * canvas.width + x0) * 4;
                    const i11 = (y1 * canvas.width + x1) * 4;

                    const rTop = data[i00] * (1 - tx) + data[i10] * tx;
                    const gTop = data[i00 + 1] * (1 - tx) + data[i10 + 1] * tx;
                    const bTop = data[i00 + 2] * (1 - tx) + data[i10 + 2] * tx;
                    const rBottom = data[i01] * (1 - tx) + data[i11] * tx;
                    const gBottom = data[i01 + 1] * (1 - tx) + data[i11 + 1] * tx;
                    const bBottom = data[i01 + 2] * (1 - tx) + data[i11 + 2] * tx;

                    let r = (rTop * (1 - ty) + rBottom * ty) / 255;
                    let g = (gTop * (1 - ty) + gBottom * ty) / 255;
                    let b = (bTop * (1 - ty) + bBottom * ty) / 255;

                    // Corrección gamma suave para evitar zonas demasiado quemadas/apagadas
                    r = Math.pow(Math.min(Math.max(r, 0), 1), 1.0 / 1.8);
                    g = Math.pow(Math.min(Math.max(g, 0), 1), 1.0 / 1.8);
                    b = Math.pow(Math.min(Math.max(b, 0), 1), 1.0 / 1.8);

                    colors[i * 3] = r;
                    colors[i * 3 + 1] = g;
                    colors[i * 3 + 2] = b;
                } else {
                    // Fallback a gris neutro si no hay UV válido
                    colors[i * 3] = 0.7;
                    colors[i * 3 + 1] = 0.7;
                    colors[i * 3 + 2] = 0.7;
                }
            }
            
            return colors;
        } catch (error) {
            console.warn('[ModelLoader] Error extrayendo textura:', error);
            return null;
        }
    }

    /**
     * Extraer color dominante mejorado de imagen (fallback)
     */
    extractDominantColor(image) {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            canvas.width = Math.min(image.width || 256, 256);
            canvas.height = Math.min(image.height || 256, 256);
            
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            let r = 0, g = 0, b = 0, count = 0;
            
            // Muestrear todos los píxeles
            for (let i = 0; i < data.length; i += 4) {
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
                count++;
            }
            
            return {
                r: Math.max(r / count / 255, 0.2),
                g: Math.max(g / count / 255, 0.2),
                b: Math.max(b / count / 255, 0.2)
            };
        } catch (error) {
            console.warn('[ModelLoader] No se pudo extraer color dominante:', error);
            return null;
        }
    }

    /**
     * Convertir GLTF a formato de vértices compatible con WebGL
     * Maneja correctamente múltiples materiales y texturas
     * Optimizado para modelos pesados
     */
    convertGLTFToVertexData(gltf) {
        const vertices = [];
        const normals = [];
        const colors = [];
        const materialProps = [];
        const uvs = [];
        const textureImages = [];
        const textureMap = new Map();
        const materialTextures = new Map(); // UUID material -> textura
        let primaryTexture = null;
        let useTexture = false;

        const scene = gltf.scene;
        scene.updateMatrixWorld(true);

        // Pre-procesar materiales para extraer todas las texturas
        // Primero: recopilar todos los materiales únicos
        const allMaterials = [];
        scene.traverse((node) => {
            if (node.isMesh && node.material) {
                const mats = Array.isArray(node.material) ? node.material : [node.material];
                mats.forEach(material => {
                    if (material && !allMaterials.find(m => m.uuid === material.uuid)) {
                        allMaterials.push(material);
                    }
                });
            }
        });


        // Segundo: procesar CADA material
        // Importante: materiales SIN textura usan índice centinela (9)
        // para forzar fallback a color (no samplear uSampler0 por error).
        const materialMap = new Map();
        const NO_TEXTURE_INDEX = 9;

        allMaterials.forEach((material, materialIdx) => {
            const color = this.getMaterialColor(material, materialIdx);
            
            const texture = this.getTextureFromMaterial(material);
            
            if (texture && texture.image) {
                const texId = texture.uuid || `tex_${material.uuid}`;
                let actualTextureIndex = 0;
                
                if (!textureMap.has(texId)) {
                    textureMap.set(texId, textureImages.length);
                    textureImages.push(texture.image);
                    actualTextureIndex = textureImages.length - 1;
                    if (!primaryTexture) primaryTexture = texture.image;
                } else {
                    actualTextureIndex = textureMap.get(texId);
                }
                
                useTexture = true;
                // En GLTF: baseColor final = baseColorTexture * material.color (baseColorFactor)
                // Guardar el color real del material para que el shader lo multiplique con la textura.
                materialMap.set(material.uuid, {
                    color,
                    texture,
                    textureIndex: actualTextureIndex,
                    roughness: this.getMaterialRoughness(material),
                    metalness: this.getMaterialMetalness(material),
                    roughnessTexture: this.getRoughnessTextureFromMaterial(material),
                    metalnessTexture: this.getMetalnessTextureFromMaterial(material)
                });
            } else {
                materialMap.set(material.uuid, {
                    color,
                    texture: null,
                    textureIndex: NO_TEXTURE_INDEX,
                    roughness: this.getMaterialRoughness(material),
                    metalness: this.getMaterialMetalness(material),
                    roughnessTexture: this.getRoughnessTextureFromMaterial(material),
                    metalnessTexture: this.getMetalnessTextureFromMaterial(material)
                });
            }
        });
        

        const hasMultipleMaterials = materialMap.size > 1 || textureImages.length > 1;
        

        // Procesar geometrías
        scene.traverse((node) => {
            if (node.isMesh) {
                const geometry = node.geometry;
                const materials = Array.isArray(node.material) ? node.material : [node.material];
                const worldMatrix = node.matrixWorld;

                if (!geometry.attributes.normal) {
                    geometry.computeVertexNormals();
                }

                const positions = geometry.attributes.position.array;
                const normalsAttr = geometry.attributes.normal.array;
                const colorAttr = geometry.attributes.color;
                const uvAttr = geometry.attributes.uv || geometry.attributes.uv2;
                const indexAttr = geometry.index;

                // Si hay grupos definidos, procesarlos
                if (geometry.groups && geometry.groups.length > 0) {
                    for (let groupIdx = 0; groupIdx < geometry.groups.length; groupIdx++) {
                        const group = geometry.groups[groupIdx];
                        const material = materials[group.materialIndex] || materials[0];
                        
                        // Obtener color y textureIndex del material pre-procesado
                        const materialData = materialMap.has(material.uuid) 
                            ? materialMap.get(material.uuid)
                            : {
                                color: this.getMaterialColor(material),
                                textureIndex: NO_TEXTURE_INDEX,
                                roughness: this.getMaterialRoughness(material),
                                metalness: this.getMaterialMetalness(material),
                                roughnessTexture: this.getRoughnessTextureFromMaterial(material),
                                metalnessTexture: this.getMetalnessTextureFromMaterial(material)
                            };
                        
                        const materialColor = materialData.color;
                        const textureIndex = (materialData.textureIndex === undefined || materialData.textureIndex === null)
                            ? NO_TEXTURE_INDEX
                            : materialData.textureIndex;
                        const materialRoughness = Math.min(Math.max(materialData.roughness ?? 0.58, 0.04), 1.0);
                        const materialMetalness = Math.min(Math.max(materialData.metalness ?? 0.05, 0.0), 1.0);
                        const groupStart = group.start;
                        const groupEnd = groupStart + group.count;

                        if (indexAttr) {
                            for (let i = groupStart; i < groupEnd; i++) {
                                const idx = indexAttr.array[i];
                                const p = idx * 3;
                                const uv = idx * 2;

                                const vertex = new THREE.Vector3(positions[p], positions[p + 1], positions[p + 2]);
                                vertex.applyMatrix4(worldMatrix);
                                vertices.push(vertex.x, vertex.y, vertex.z);

                                const normal = new THREE.Vector3(normalsAttr[p], normalsAttr[p + 1], normalsAttr[p + 2]);
                                normal.transformDirection(worldMatrix).normalize();
                                normals.push(normal.x, normal.y, normal.z);

                                if (uvAttr && uvAttr.array && uv + 1 < uvAttr.array.length) {
                                    uvs.push(uvAttr.array[uv], uvAttr.array[uv + 1]);
                                } else {
                                    uvs.push(0, 0);
                                }
                                const uvU = (uvAttr && uvAttr.array && uv + 1 < uvAttr.array.length) ? uvAttr.array[uv] : 0.0;
                                const uvV = (uvAttr && uvAttr.array && uv + 1 < uvAttr.array.length) ? uvAttr.array[uv + 1] : 0.0;
                                const vertexProps = this.getVertexMaterialProps(materialData, uvU, uvV, materialRoughness, materialMetalness);
                                materialProps.push(vertexProps.roughness, vertexProps.metalness);

                                // Para multi-material: RGBA donde RGB = color material, alpha = índice
                                if (hasMultipleMaterials) {
                                    let finalColor = materialColor;
                                    if (colorAttr && colorAttr.array && p + 2 < colorAttr.array.length) {
                                        finalColor = {
                                            r: materialColor.r * colorAttr.array[p],
                                            g: materialColor.g * colorAttr.array[p + 1],
                                            b: materialColor.b * colorAttr.array[p + 2]
                                        };
                                    }
                                    const materialIndexNormalized = textureIndex / 10.0;
                                    colors.push(finalColor.r, finalColor.g, finalColor.b, materialIndexNormalized);
                                } else {
                                    let finalColor = materialColor;
                                    if (colorAttr && colorAttr.array && p + 2 < colorAttr.array.length) {
                                        finalColor = {
                                            r: colorAttr.array[p],
                                            g: colorAttr.array[p + 1],
                                            b: colorAttr.array[p + 2]
                                        };
                                    }
                                    colors.push(finalColor.r, finalColor.g, finalColor.b);
                                }
                            }
                        }
                    }
                } else {
                    // Sin grupos - procesar todo con el primer material
                    const material = materials[0];
                    const materialData = materialMap.has(material.uuid) 
                        ? materialMap.get(material.uuid)
                        : {
                            color: this.getMaterialColor(material),
                            textureIndex: NO_TEXTURE_INDEX,
                            roughness: this.getMaterialRoughness(material),
                            metalness: this.getMaterialMetalness(material),
                            roughnessTexture: this.getRoughnessTextureFromMaterial(material),
                            metalnessTexture: this.getMetalnessTextureFromMaterial(material)
                        };
                    
                    const materialColor = materialData.color;
                    const textureIndex = (materialData.textureIndex === undefined || materialData.textureIndex === null)
                        ? NO_TEXTURE_INDEX
                        : materialData.textureIndex;
                    const materialRoughness = Math.min(Math.max(materialData.roughness ?? 0.58, 0.04), 1.0);
                    const materialMetalness = Math.min(Math.max(materialData.metalness ?? 0.05, 0.0), 1.0);

                    if (indexAttr) {
                        for (let i = 0; i < indexAttr.count; i++) {
                            const idx = indexAttr.array[i];
                            const p = idx * 3;
                            const uv = idx * 2;

                            const vertex = new THREE.Vector3(positions[p], positions[p + 1], positions[p + 2]);
                            vertex.applyMatrix4(worldMatrix);
                            vertices.push(vertex.x, vertex.y, vertex.z);

                            const normal = new THREE.Vector3(normalsAttr[p], normalsAttr[p + 1], normalsAttr[p + 2]);
                            normal.transformDirection(worldMatrix).normalize();
                            normals.push(normal.x, normal.y, normal.z);

                            if (uvAttr && uvAttr.array && uv + 1 < uvAttr.array.length) {
                                uvs.push(uvAttr.array[uv], uvAttr.array[uv + 1]);
                            } else {
                                uvs.push(0, 0);
                            }
                            const uvU = (uvAttr && uvAttr.array && uv + 1 < uvAttr.array.length) ? uvAttr.array[uv] : 0.0;
                            const uvV = (uvAttr && uvAttr.array && uv + 1 < uvAttr.array.length) ? uvAttr.array[uv + 1] : 0.0;
                            const vertexProps = this.getVertexMaterialProps(materialData, uvU, uvV, materialRoughness, materialMetalness);
                            materialProps.push(vertexProps.roughness, vertexProps.metalness);

                            // Para multi-material: RGBA (alpha = índice)
                            if (hasMultipleMaterials) {
                                let finalColor = materialColor;
                                if (colorAttr && colorAttr.array && p + 2 < colorAttr.array.length) {
                                    finalColor = {
                                        r: materialColor.r * colorAttr.array[p],
                                        g: materialColor.g * colorAttr.array[p + 1],
                                        b: materialColor.b * colorAttr.array[p + 2]
                                    };
                                }
                                const materialIndexNormalized = textureIndex / 10.0;
                                colors.push(finalColor.r, finalColor.g, finalColor.b, materialIndexNormalized);
                            } else {
                                let finalColor = materialColor;
                                if (colorAttr && colorAttr.array && p + 2 < colorAttr.array.length) {
                                    finalColor = {
                                        r: colorAttr.array[p],
                                        g: colorAttr.array[p + 1],
                                        b: colorAttr.array[p + 2]
                                    };
                                }
                                colors.push(finalColor.r, finalColor.g, finalColor.b);
                            }
                        }
                    } else {
                        for (let i = 0; i < positions.length; i += 3) {
                            const uv = (i / 3) * 2;

                            const vertex = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
                            vertex.applyMatrix4(worldMatrix);
                            vertices.push(vertex.x, vertex.y, vertex.z);

                            const normal = new THREE.Vector3(normalsAttr[i], normalsAttr[i + 1], normalsAttr[i + 2]);
                            normal.transformDirection(worldMatrix).normalize();
                            normals.push(normal.x, normal.y, normal.z);

                            if (uvAttr && uvAttr.array && uv + 1 < uvAttr.array.length) {
                                uvs.push(uvAttr.array[uv], uvAttr.array[uv + 1]);
                            } else {
                                uvs.push(0, 0);
                            }
                            const uvU = (uvAttr && uvAttr.array && uv + 1 < uvAttr.array.length) ? uvAttr.array[uv] : 0.0;
                            const uvV = (uvAttr && uvAttr.array && uv + 1 < uvAttr.array.length) ? uvAttr.array[uv + 1] : 0.0;
                            const vertexProps = this.getVertexMaterialProps(materialData, uvU, uvV, materialRoughness, materialMetalness);
                            materialProps.push(vertexProps.roughness, vertexProps.metalness);

                            // Para multi-material: RGBA donde RGB = color material, alpha = índice
                            if (hasMultipleMaterials) {
                                let finalColor = materialColor;
                                if (colorAttr && colorAttr.array && i + 2 < colorAttr.array.length) {
                                    finalColor = {
                                        r: materialColor.r * colorAttr.array[i],
                                        g: materialColor.g * colorAttr.array[i + 1],
                                        b: materialColor.b * colorAttr.array[i + 2]
                                    };
                                }
                                const materialIndexNormalized = textureIndex / 10.0;
                                colors.push(finalColor.r, finalColor.g, finalColor.b, materialIndexNormalized);
                            } else {
                                let finalColor = materialColor;
                                if (colorAttr && colorAttr.array && i + 2 < colorAttr.array.length) {
                                    finalColor = {
                                        r: colorAttr.array[i],
                                        g: colorAttr.array[i + 1],
                                        b: colorAttr.array[i + 2]
                                    };
                                }
                                colors.push(finalColor.r, finalColor.g, finalColor.b);
                            }
                        }
                    }
                }
            }
        });

        // DEBUG: mostrar primeros colores asignados (descomentar si es necesario)
        // if (colors.length > 0) {
        //     const colorSampleSize = Math.min(12, colors.length);
        //     const firstColors = colors.slice(0, colorSampleSize);
        // }


        // Usar texturas si están disponibles (1 o más)
        const shouldUseTexture = useTexture && textureImages.length > 0;

        return {
            vertices: vertices,
            normals: normals,
            colors: colors,  // RGBA cuando múltiples materiales (alpha = índice)
            materialProps: materialProps,
            uvs: uvs,
            texCoords: uvs,
            textureImages: textureImages,  // TODAS las texturas
            textureImage: primaryTexture,  // Primera textura (compatibilidad)
            useTexture: shouldUseTexture,
            hasMultipleMaterials: hasMultipleMaterials,  // Usar el valor calculado (múltiples MATERIALES, no texturas)
            materialCount: materialMap.size,
            textureCount: textureImages.length,
            vertexNormals: normals
        };
    }

    /**
     * Extraer color dominante rápidamente sin procesamiento pesado
     */
    extractDominantColorFast(image, textureIndex = 0) {
        try {
            if (!image) return { r: 0.8, g: 0.8, b: 0.8 };

            // Cache el resultado para no reprocesar
            if (!image._cachedColor) {
                const canvas = document.createElement('canvas');
                canvas.width = 128;  // Aumentar a 128x128 para mejor precisión
                canvas.height = 128;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                
                let r = 0, g = 0, b = 0, count = 0;
                
                // Muestrear todos los píxeles OPACOS solamente
                for (let i = 0; i < data.length; i += 4) {
                    // Solo píxeles con alpha > 128 (semi-opacos o más)
                    if (data[i + 3] > 128) {
                        r += data[i];
                        g += data[i + 1];
                        b += data[i + 2];
                        count++;
                    }
                }
                
                if (count === 0) {
                    // Si todo es transparente, intentar con todos los píxeles
                    for (let i = 0; i < data.length; i += 4) {
                        r += data[i];
                        g += data[i + 1];
                        b += data[i + 2];
                    }
                    count = data.length / 4;
                }
                
                // Convertir a 0-1 y aplicar boost de saturación
                let rAvg = r / count / 255;
                let gAvg = g / count / 255;
                let bAvg = b / count / 255;
                
                // Aumentar saturación para que los colores se vean más vibrantes
                const maxColor = Math.max(rAvg, gAvg, bAvg);
                if (maxColor > 0.1) {
                    const saturationBoost = 1.15; // 15% más saturado
                    rAvg = Math.min(1.0, rAvg * saturationBoost);
                    gAvg = Math.min(1.0, gAvg * saturationBoost);
                    bAvg = Math.min(1.0, bAvg * saturationBoost);
                }
                
                image._cachedColor = {
                    r: Math.max(rAvg, 0.05),
                    g: Math.max(gAvg, 0.05),
                    b: Math.max(bAvg, 0.05)
                };
                
            }
            
            return image._cachedColor;
        } catch (error) {
            console.warn(`[ColorExtract] Error extracting color:`, error);
            return { r: 0.8, g: 0.8, b: 0.8 };
        }
    }

    /**
     * Obtener textura del material (busca en varias propiedades)
     */
    getTextureFromMaterial(material) {
        if (!material) return null;

        // FIRST: Only check actual COLOR/ALBEDO textures (never use normal/roughness/metallic for color)
        const colorTextureProps = [
            'map',           // StandardMaterial/MeshStandardMaterial color
            'baseColorMap',  // Babylon.js
            'baseColorTexture',
            'albedoTexture', // Some exporters
            'diffuseMap',    // CommonMaterial 
            'diffuse'        // Sometimes used
        ];

        for (const prop of colorTextureProps) {
            if (material[prop]) {
                const tex = material[prop];
                if (tex.image) {
                    return tex;
                }
            }
        }

        return null;
    }

    /**
     * Obtener color del material - usar EXACTAMENTE el color del GLB
     */
    getMaterialColor(material, materialIdx = 0) {
        // Usar el color exacto que viene del material
        if (material && material.color) {
            return {
                r: material.color.r,
                g: material.color.g,
                b: material.color.b
            };
        }
        
        // Fallback: gris claro
        return { r: 0.8, g: 0.8, b: 0.8 };
    }

    getMaterialRoughness(material) {
        if (!material) return 0.58;
        if (typeof material.roughness === 'number' && Number.isFinite(material.roughness)) {
            return material.roughness;
        }
        return 0.58;
    }

    getMaterialMetalness(material) {
        if (!material) return 0.05;
        if (typeof material.metalness === 'number' && Number.isFinite(material.metalness)) {
            return material.metalness;
        }
        return 0.05;
    }

    getRoughnessTextureFromMaterial(material) {
        if (!material) return null;
        return material.roughnessMap || material.metalnessMap || null;
    }

    getMetalnessTextureFromMaterial(material) {
        if (!material) return null;
        return material.metalnessMap || material.roughnessMap || null;
    }

    getVertexMaterialProps(materialData, u, v, roughnessFallback, metalnessFallback) {
        let roughness = roughnessFallback;
        let metalness = metalnessFallback;

        const roughnessTexture = materialData?.roughnessTexture || null;
        const metalnessTexture = materialData?.metalnessTexture || null;

        if (roughnessTexture && metalnessTexture && roughnessTexture === metalnessTexture) {
            const combinedSample = this.sampleMetalRoughnessCombined(roughnessTexture, u, v);
            roughness *= combinedSample.roughness;
            metalness *= combinedSample.metalness;
        } else {
            if (roughnessTexture) {
                // Three.js roughnessMap usa canal verde.
                roughness *= this.sampleTextureChannel(roughnessTexture, u, v, 1, 1.0);
            }
            if (metalnessTexture) {
                // Three.js metalnessMap usa canal azul.
                metalness *= this.sampleTextureChannel(metalnessTexture, u, v, 2, 1.0);
            }
        }

        return {
            roughness: this.clamp01(roughness, 0.04, 1.0),
            metalness: this.clamp01(metalness, 0.0, 1.0)
        };
    }

    sampleMetalRoughnessCombined(texture, u, v) {
        const pixel = this.sampleTexturePixel(texture, u, v);
        if (!pixel) {
            return { roughness: 1.0, metalness: 1.0 };
        }

        // glTF metallicRoughnessTexture: G = roughness, B = metalness
        return {
            roughness: pixel.g,
            metalness: pixel.b
        };
    }

    sampleTextureChannel(texture, u, v, channelIndex, fallback = 1.0) {
        const pixel = this.sampleTexturePixel(texture, u, v);
        if (!pixel) return fallback;
        if (channelIndex === 0) return pixel.r;
        if (channelIndex === 1) return pixel.g;
        if (channelIndex === 2) return pixel.b;
        return fallback;
    }

    sampleTexturePixel(texture, u, v) {
        const source = this.getTextureSourceData(texture);
        if (!source) return null;

        const wrappedU = ((u % 1.0) + 1.0) % 1.0;
        const wrappedV = ((v % 1.0) + 1.0) % 1.0;

        const x = Math.floor(wrappedU * (source.width - 1));
        const y = Math.floor(wrappedV * (source.height - 1));
        const idx = (y * source.width + x) * 4;

        return {
            r: source.data[idx] / 255.0,
            g: source.data[idx + 1] / 255.0,
            b: source.data[idx + 2] / 255.0
        };
    }

    getTextureSourceData(texture) {
        if (!texture || !texture.image) return null;

        const image = texture.image;
        const cacheKey = texture.uuid || image.currentSrc || image.src || `${image.width}x${image.height}`;
        if (this.texturePixelCache.has(cacheKey)) {
            return this.texturePixelCache.get(cacheKey);
        }

        try {
            const maxSize = 512;
            const srcWidth = image.width || maxSize;
            const srcHeight = image.height || maxSize;
            const scale = Math.min(1, maxSize / Math.max(srcWidth, srcHeight));
            const width = Math.max(1, Math.floor(srcWidth * scale));
            const height = Math.max(1, Math.floor(srcHeight * scale));

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            ctx.drawImage(image, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            const source = {
                width,
                height,
                data: imageData.data
            };

            this.texturePixelCache.set(cacheKey, source);
            return source;
        } catch (error) {
            console.warn('[ModelLoader] No se pudo leer textura para material props:', error);
            return null;
        }
    }

    clamp01(value, min = 0.0, max = 1.0) {
        return Math.min(max, Math.max(min, value));
    }

    /**
     * Muestrear color de textura - simplificado para modelos pesados
     * No se usa actualmente, pero disponible si es necesario en el futuro
     */
    sampleTextureAtUV(image, uv, fallbackColor) {
        try {
            if (!image || !uv || uv.length < 2) return fallbackColor;

            // Solución ultra-rápida: solo extraer color dominante en lugar de muestreo por vértice
            // Esto es mucho más rápido y requiere menos memoria
            if (!image._cachedDominantColor) {
                const canvas = document.createElement('canvas');
                canvas.width = 1;
                canvas.height = 1;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0, 1, 1);
                const imageData = ctx.getImageData(0, 0, 1, 1).data;
                image._cachedDominantColor = {
                    r: imageData[0] / 255,
                    g: imageData[1] / 255,
                    b: imageData[2] / 255
                };
            }
            
            return image._cachedDominantColor;
        } catch (error) {
            return fallbackColor;
        }
    }

    /**
     * Limpiar caché
     */
    clearCache(modelPath) {
        if (modelPath) {
            delete this.cache[modelPath];
        } else {
            this.cache = {};
        }
    }
}

// Instancia global
const globalModelLoader = new ModelLoader();
