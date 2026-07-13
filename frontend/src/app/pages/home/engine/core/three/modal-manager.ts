/**
 * ModalManager ahora funciona como un puente entre el motor 3D y el componente Angular.
 * En lugar de manipular el DOM directamente, llama a callbacks del componente.
 */
export class ModalManager {
    private showCallback: ((product: any) => void) | null = null;
    private hideCallback: (() => void) | null = null;
    private isVisibleState: boolean = false;

    constructor(showCallback?: (product: any) => void, hideCallback?: () => void) {
        this.showCallback = showCallback || null;
        this.hideCallback = hideCallback || null;
    }

    public show(product: any): void {
        if (!product) return;
        this.isVisibleState = true;
        if (this.showCallback) {
            this.showCallback(product);
        }
    }

    public hide(): void {
        this.isVisibleState = false;
        if (this.hideCallback) {
            this.hideCallback();
        }
    }

    public hideSilently(): void {
        this.isVisibleState = false;
    }

    public isVisible(): boolean {
        return this.isVisibleState;
    }

    public setCallbacks(showCallback: (product: any) => void, hideCallback: () => void): void {
        this.showCallback = showCallback;
        this.hideCallback = hideCallback;
    }
}
