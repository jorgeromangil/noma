import * as THREE from 'three';

export class UtilsGeo {
    // Constantes de calibración, tipadas y marcadas como readonly
    // Al ser static, se accede a ellas como UtilsGeo.PLANET_RADIUS
    public static readonly TEXTURE_OFFSET_LON: number = -0.082;
    public static readonly TEXTURE_OFFSET_LAT: number = 0.021;
    public static readonly PLANET_RADIUS: number = 80;

    /**
     * Variante sin dependencias de THREE para motores WebGL puros.
     * Devuelve coordenadas cartesianas (x,y,z) en una esfera de radio `radius`.
     */
    public static latLonToVec3Plain(lat: number, lon: number, radius: number = UtilsGeo.PLANET_RADIUS): [number, number, number] {
        const phi: number = (90 - lat) * (Math.PI / 180) + UtilsGeo.TEXTURE_OFFSET_LAT;
        const theta: number = (lon * (Math.PI / 180)) + UtilsGeo.TEXTURE_OFFSET_LON;
        return [
            -(radius * Math.sin(phi) * Math.cos(theta)),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.sin(theta)
        ];
    }

    /**
     * Convierte coordenadas de latitud y longitud a un vector 3D cartesiano.
     * @param lat - Latitud en grados.
     * @param lon - Longitud en grados.
     * @param radius - Radio de la esfera (por defecto el radio del planeta).
     * @returns Un nuevo vector THREE.Vector3.
     */
    public static latLonToVector3(lat: number, lon: number, radius: number = UtilsGeo.PLANET_RADIUS): THREE.Vector3 {
        // La conversión de coordenadas esféricas a cartesianas requiere ajustar los ángulos.
        // Convertir latitud a ángulo polar (phi, de 0 a PI)
        const phi: number = (90 - lat) * (Math.PI / 180) + UtilsGeo.TEXTURE_OFFSET_LAT;
        
        // Convertir longitud a ángulo azimutal (theta, de -PI a PI)
        const theta: number = (lon * (Math.PI / 180)) + UtilsGeo.TEXTURE_OFFSET_LON;

        // Fórmulas de conversión de coordenadas esféricas
        // Nota: El signo negativo en la componente X es común para mapear correctamente
        // el sistema de coordenadas de Three.js (eje Y arriba) a la geografía.
        return new THREE.Vector3(
            -(radius * Math.sin(phi) * Math.cos(theta)),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.sin(theta)
        );
    }
}
