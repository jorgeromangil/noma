// Colores y categorías igual que en map-search-overlay
type CategoryKey = 'agroalimentario' | 'textil' | 'barro_alfareria' | 'madera_mueble' | 'otros';
const CATEGORY_LABELS: Record<CategoryKey, string> = {
    agroalimentario: 'Alimentación',
    textil: 'Textil',
    barro_alfareria: 'Barro y Alfarería',
    madera_mueble: 'Madera y mueble',
    otros: 'Otros'
};
const CATEGORY_COLORS: Record<CategoryKey, string> = {
    agroalimentario: '#5aabee',
    barro_alfareria: '#f83d3a',
    madera_mueble: '#f09cae',
    textil: '#b44194',
    otros: '#2924b4'
};
import { Component, EventEmitter, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../layouts/auth-layout/auth.service';
import { CustomTooltipDirective } from '../../../shared/custom-tooltip.directive';

interface InstructionStep {
    title: string;
    description: string;
    icon: string;
    spotlight?: boolean; // indica si este paso usa spotlight
    highlightCircle?: boolean; // indica si mostrar el círculo de highlight (solo aplica cuando spotlight es true)
    spotlightPos?: { bottom?: string; right?: string; top?: string; left?: string; }; // posición personalizada del círculo
    popupPos?: { bottom?: string; right?: string; top?: string; left?: string; }; // posición personalizada del popup
    hideBackground?: boolean; // quita el background oscuro del overlay
}

interface Position {
    bottom?: string;
    right?: string;
    top?: string;
    left?: string;
}

@Component({
    selector: 'app-instructions-modal',
    standalone: true,
    imports: [CommonModule, CustomTooltipDirective],
    templateUrl: './instructions-modal.html',
    styleUrl: './instructions-modal.css'
})
export class InstructionsModalComponent implements OnInit {
    categoryLabels = CATEGORY_LABELS;
    categoryColors = CATEGORY_COLORS;
    categoryKeys: CategoryKey[] = ['agroalimentario', 'textil', 'barro_alfareria', 'madera_mueble', 'otros'];
    @Output() close = new EventEmitter<void>();

    currentStep: number = 0;
    spotlightPosition: Position = { bottom: '0.60em', right: '0.75em' };
    popupPosition: Position = { bottom: '6.5em', right: '1.25em' };
    isLoggedIn: boolean = false;
    userRole: string = '';

    steps: InstructionStep[] = [];

    constructor(private authService: AuthService) {}

    ngOnInit(): void {
        // Obtener estado de login y rol
        this.authService.isLoggedIn$.subscribe(isLoggedIn => {
            this.isLoggedIn = isLoggedIn;
        });
        
        // Obtener rol del token
        this.userRole = this.getRoleFromToken();

        // Inicializar steps después de obtener la información del usuario
        this.initializeSteps();
    }

    private getRoleFromToken(): string {
        const token = this.authService.getToken();
        if (!token) return '';

        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));

            const payload = JSON.parse(jsonPayload);
            return payload.role || '';
        } catch (error) {
            console.error('Error desencriptando el rol del token');
            return '';
        }
    }

    private initializeSteps(): void {
        this.steps = [
            {
                title: '¡Bienvenido a Noma!',
                description: 'Esta es tu plataforma para descubrir artesanos y sus productos únicos. Te mostraremos cómo utilizarla.',
                icon: '',
                hideBackground: true
            },
            {
                title: 'Chatbot inteligente',
                description: 'En la esquina inferior derecha encontrarás nuestro chatbot. Puedes usarlo para hacer preguntas y buscar productos de forma natural. ¡Está aquí para ayudarte!',
                icon: '',
                spotlight: true,
                highlightCircle: false
            },
            {
                title: this.isLoggedIn ? 'Tu Perfil' : 'Iniciar sesión o Registrarse',
                description: this.getLoginStepDescription(),
                icon: '',
                spotlight: true,
                highlightCircle: false,
                spotlightPos: { top: '3.5em', right: '0.75em' },
                popupPos: { top: '5em', right: '1.25em' }
            },
            {
                title: 'Barra de búsqueda y Filtros',
                description: 'Utiliza la barra de búsqueda para encontrar productos. Puedes activar filtros de certificaciones y proximidad. También tienes la opción de filtrar por categorías de productos. Los colores de los pines corresponden a cada categoría:',
                icon: '',
                spotlight: true,
                highlightCircle: false,
                popupPos: { top: '6em', left: 'calc(50% - 10.2em)' }
            },
            {
                title: 'Productos en el mapa',
                description: 'Los pines en el mapa representan diferentes productos y artesanos. Haz clic en cualquier pin para ver la ficha completa del producto con detalles, fotos y contacto.',
                icon: '',
                spotlight: true,
                highlightCircle: false,
                popupPos: { top: '30%', left: '75%' }
            },
            {
                title: 'Cambia tu vista',
                description: 'En la parte inferior central encontrarás un switch para cambiar entre diferentes motores de búsqueda. También puedes cambiar entre vista 2D y 3D para explorar el mapa de diferentes formas.',
                icon: '',
                spotlight: true,
                highlightCircle: false,
                popupPos: { bottom: '5.5em', left: 'calc(50% - 10.2em)' }
            },
            {
                title: '¡Ya estás listo!',
                description: 'Ahora puedes explorar el mapa, descubrir artesanos increíbles y encontrar productos únicos. ¡Que disfrutes la experiencia!',
                icon: '',
                hideBackground: true
            }
        ];
    }

    private getLoginStepDescription(): string {
        if (this.isLoggedIn) {
            if (this.userRole === 'artisan') {
                return 'Aquí encontrarás tu perfil y catálogo. Puedes subir productos, editarlos, borrarlos y ocultarlos. También verás tus estadísticas de ventas y podrás editar tu información personal.';
            } else {
                return 'Aquí encontrarás tu perfil, donde puedes ver tus favoritos y editar tu información personal.';
            }
        } else {
            return 'En la barra de navegación superior puedes iniciar sesión con tu cuenta o crear una nueva.';
        }
    }

    nextStep(): void {
        if (this.currentStep < this.steps.length - 1) {
            this.currentStep++;
        }
    }

    prevStep(): void {
        if (this.currentStep > 0) {
            this.currentStep--;
        }
    }

    goToStep(index: number): void {
        this.currentStep = index;
    }

    onOverlayClick(): void {
        // Solo cierra si está en spotlight mode y hace click en el overlay
        if (this.isSpotlightMode) {
            this.close.emit();
        }
    }

    closeModal(): void {
        this.close.emit();
    }

    get currentStepData(): InstructionStep {
        return this.steps[this.currentStep];
    }

    get isFirstStep(): boolean {
        return this.currentStep === 0;
    }

    get isLastStep(): boolean {
        return this.currentStep === this.steps.length - 1;
    }

    get progress(): number {
        return ((this.currentStep + 1) / this.steps.length) * 100;
    }

    get isSpotlightMode(): boolean {
        return this.currentStepData.spotlight === true;
    }

    get currentSpotlightPosition(): Position {
        if (this.currentStepData.spotlightPos) {
            return this.currentStepData.spotlightPos as Position;
        }
        return this.spotlightPosition;
    }

    get currentPopupPosition(): Position {
        if (this.currentStepData.popupPos) {
            return this.currentStepData.popupPos as Position;
        }
        return this.popupPosition;
    }

    get shouldHideBackground(): boolean {
        return this.currentStepData.hideBackground === true;
    }
}
