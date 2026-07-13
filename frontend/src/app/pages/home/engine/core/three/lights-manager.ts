import * as THREE from 'three';

export class LightsManager {
    private scene: THREE.Scene;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.initLights();
    }

    private initLights(): void {
        // Luz Ambiental 
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); 
        this.scene.add(ambientLight);

        // Luz Direccional Principal
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        directionalLight.position.set(5, 5, 5);
        this.scene.add(directionalLight);

        // Luz de Relleno 
        const fillLight = new THREE.DirectionalLight(0x88ccff, 0.6);
        fillLight.position.set(-4, 2, -3);
        this.scene.add(fillLight);

        // Luz Puntual
        const warmLight = new THREE.PointLight(0xffddaa, 0.6);
        warmLight.position.set(3, 3, 2);
        this.scene.add(warmLight);
    }
}