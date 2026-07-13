import {
    Component,
    Input,
    OnDestroy,
    OnChanges,
    SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/**
 * Pipe para marcar URL como segura para iframe
 */
@Pipe({
    name: 'safe',
    standalone: true
})
export class SafePipe implements PipeTransform {
    constructor(private sanitizer: DomSanitizer) {}

    transform(url: string): SafeResourceUrl {
        return this.sanitizer.bypassSecurityTrustResourceUrl(url);
    }
}

/**
 * Componente para visor 3D WebGL
 * Carga modelos en un iframe con soporte para GLB/GLTF
 */
@Component({
    selector: 'app-webgl-viewer',
    standalone: true,
    imports: [CommonModule, SafePipe],
    template: `
        <div class="webgl-viewer-container">
            <iframe 
                [src]="iframeSrc | safe"
                class="webgl-viewer-frame"
                scrolling="no"
                frameborder="0"
                allow="camera *; microphone *"
                (load)="onIframeLoad()"
                (error)="onIframeError()">
            </iframe>
            <div class="webgl-viewer-loading" *ngIf="loading">
                <p>Cargando modelo 3D...</p>
            </div>
            <div class="webgl-viewer-error" *ngIf="error">
                <p>{{ error }}</p>
            </div>
        </div>
    `,
    styles: [`
        .webgl-viewer-container {
            position: relative;
            width: 100%;
            height: 100%;
            border-radius: 1em;
            overflow: hidden;
            background: #000;
        }

        .webgl-viewer-frame {
            width: 100%;
            height: 100%;
            border: none;
            display: block;
            overflow: hidden;
        }

        .webgl-viewer-loading,
        .webgl-viewer-error {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            font-size: 1.1em;
            z-index: 5;
        }

        .webgl-viewer-error {
            color: #ff6b6b;
        }
    `]
})
export class WebGLViewerComponent implements OnChanges, OnDestroy {
    @Input() modelUrl: string = '';

    public loading = true;
    public error: string | null = null;
    public iframeSrc: string = 'about:blank';

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['modelUrl']) {
            this.initWebGLViewer();
        }
    }

    ngOnDestroy(): void {
        this.cleanup();
    }

    private initWebGLViewer(): void {
        this.error = null;
        this.loading = true;

        if (!this.modelUrl) {
            this.error = 'No se especificó modelo';
            this.loading = false;
            this.iframeSrc = 'about:blank';
            return;
        }

        try {
            // Construir URL del iframe con el modelo como parámetro
            const baseUrl = '/viewers/webgl/index.html';
            const encodedModel = encodeURIComponent(this.modelUrl);
            this.iframeSrc = `${baseUrl}?model=${encodedModel}`;

        } catch (error) {
            this.error = `Error inicializando visor: ${error instanceof Error ? error.message : 'desconocido'}`;
            this.loading = false;
        }
    }

    public onIframeLoad(): void {
        if (this.iframeSrc === 'about:blank') return;
        this.loading = false;
    }

    public onIframeError(): void {
        this.error = 'Error cargando el visor WebGL';
        this.loading = false;
    }

    private cleanup(): void {
    }
}
