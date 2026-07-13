
export class PopupManager {
    // Tipamos el elemento DOM como HTMLElement, ya que sabemos que existe
    private popup: HTMLElement;

    constructor(popupId: string) {
        // Obtenemos el elemento por ID y usamos el operador '!' de non-null assertion 
        // porque asumimos que el ID existe en home.html
        const element = document.getElementById(popupId);
        if (!element) {
            throw new Error(`PopupManager: No se encontró el elemento con ID: ${popupId}`);
        }
        this.popup = element;
    }

    public show(text: string, x: number, y: number): void {
        this.popup.textContent = text;
        this.popup.style.left = `${x}px`;
        this.popup.style.top = `${y}px`;
        this.popup.classList.add('visible');
    }

    public hide(): void {
        this.popup.classList.remove('visible');
    }

    public updatePosition(x: number, y: number): void {
        this.popup.style.left = `${x}px`;
        this.popup.style.top = `${y}px`;
    }

    public isVisible(): boolean {
        return this.popup.classList.contains('visible');
    }
}
