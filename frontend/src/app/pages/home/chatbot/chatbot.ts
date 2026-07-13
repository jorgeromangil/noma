import { Component, OnInit, OnDestroy, ChangeDetectorRef, ViewChild, ElementRef, Output, EventEmitter, Inject, PLATFORM_ID } from '@angular/core'; // Añadidos ViewChild y ElementRef
import { CommonModule, isPlatformBrowser } from '@angular/common'; // IMPORTANTE
import { FormsModule } from '@angular/forms'; // Para el [(ngModel)] del input
import { ChatbotService } from './chatbot.service';
import { Router } from '@angular/router';
import { GeolocationService, UserCoords } from '../../../services/geolocation.service';
import { CustomTooltipDirective } from '../../../shared/custom-tooltip.directive';

/**
 * Evento emitido cuando el chatbot activa/desactiva filtros de mapa
 * (categoría, certificación o "quitar filtros").
 */
export interface ChatbotMapFilter {
  /** Nombre de categoría tal como lo devuelve el backend: "Alimentación", "Textil", etc. */
  category: string;
  /** Nombre de certificación: "DO", "DOP", "IGP", "IGA", "Artesanía garantizada" */
  certification: string;
  /** Ubicación detectada por el bot para centrar el mapa (provincia/comunidad/ciudad). */
  focusLocation?: string;
  /** Si es true, se deben limpiar todos los filtros del mapa */
  clearFilters: boolean;
}

export interface ChatbotProduct {
  id?: string;
  title: string;
  subtitle?: string;
  image?: string | null;
  images?: string[];
  imageIndex?: number;
  actionLink?: string;
  cardType?: 'product' | 'artisan' | 'unknown';
  province?: string;
  category?: string;
  certification?: string;
  artisanName?: string;
  specialty?: string;
  isFading?: boolean;
}

@Component({
  selector: 'app-chatbot',
  standalone: true, // Probablemente sea standalone por el error que te da
  imports: [CommonModule, FormsModule, CustomTooltipDirective],
  templateUrl: './chatbot.html',
  styleUrls: ['./chatbot.css']
})
export class ChatbotComponent implements OnInit, OnDestroy {
  @ViewChild('scrollMe') private myScrollContainer!: ElementRef; // Referencia al div de scroll
  @ViewChild('userInputField') private userInputField!: ElementRef; // Referencia al input
  @Output() productSelected = new EventEmitter<ChatbotProduct>();
  /** Emitido cuando el bot activa/desactiva filtros de categoría o certificación */
  @Output() mapFilterChange = new EventEmitter<ChatbotMapFilter>();
  isOpen: boolean = false;
  userInput: string = '';
  messages: any[] = [];
  showHardResetDialog = false;
  private locationConsentGrantedInChat = false;
  private productCardCache = new Map<string, Partial<ChatbotProduct>>();
  private artisanCardCache = new Map<string, Partial<ChatbotProduct>>();
  private imageRotateIntervalId: ReturnType<typeof setInterval> | null = null;
  private imageFadeTimeoutIds = new Set<ReturnType<typeof setTimeout>>();

  // Bienvenida proactiva (preview sobre el icono + primer mensaje del bot)
  // Preview corto (bocadillo sobre el icono)
  welcomeText: string = '¡Hola! ¿Necesitas ayuda? Puedo recomendarte productos y guiarte';
  welcomePreviewVisible: boolean = true;

  // Primer mensaje dentro del chat (puede ser más largo) + chips para no obligar a escribir
  welcomeMessageText: string = '¡Hola! Soy el asistente de Noma. ¿Te gustaría explorar productos artesanales, conocer más sobre nuestra plataforma o conectar con artesanos locales?';
  welcomeChips: Array<{ text: string }> = [
    { text: 'Ver productos' },
    { text: 'Productos cerca de mí' },
    { text: 'Conocer la plataforma' },
    { text: 'Conectar con artesanos' }
  ];

  constructor(
    private chatbotService: ChatbotService,
    private geolocationService: GeolocationService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object,
    private router: Router
  ) {}

  ngOnInit() {

    this.ensureWelcomeMessage();

    // Oculta el preview automáticamente tras unos segundos
    setTimeout(() => {
      this.welcomePreviewVisible = false;
      this.cdr.detectChanges();
    }, 8000);

    this.cdr.detectChanges();
    this.startCardImageRotation();
  }

  ngOnDestroy(): void {
    this.stopCardImageRotation();
  }

  toggleChat(event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    // Si el usuario interactúa, quitamos el preview
    this.welcomePreviewVisible = false;

    this.isOpen = !this.isOpen;

    if (this.isOpen) {
      setTimeout(() => this.scrollToBottom(), 0);
      // Autofocus en el input cuando se abre el chat
      setTimeout(() => {
        if (this.userInputField?.nativeElement) {
          this.userInputField.nativeElement.focus();
        }
      }, 100);
    }
  }

  dismissWelcome(event?: Event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.welcomePreviewVisible = false;
    this.cdr.detectChanges();
  }

  openHardResetDialog(event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    this.showHardResetDialog = true;
    this.cdr.markForCheck();
  }

  cancelHardResetDialog(event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    this.showHardResetDialog = false;
    this.cdr.markForCheck();
  }

  confirmHardResetDialog(event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    this.showHardResetDialog = false;
    this.clearConversationCompletely();
  }

  private clearConversationCompletely(): void {
    this.showHardResetDialog = false;

    this.userInput = '';
    this.messages = [];
    this.locationConsentGrantedInChat = false;
    this.productCardCache.clear();
    this.artisanCardCache.clear();
    this.chatbotService.setUserLocation(null);
    this.chatbotService.resetConversationState();

    // Al vaciar por completo el chat, también limpiamos filtros activos en el mapa.
    this.mapFilterChange.emit({ category: '', certification: '', focusLocation: '', clearFilters: true });

    this.ensureWelcomeMessage();
    this.welcomePreviewVisible = false;
    this.cdr.markForCheck();

    setTimeout(() => {
      this.cdr.detectChanges();
      this.scrollToBottom();

      if (this.isOpen && this.userInputField?.nativeElement) {
        this.userInputField.nativeElement.focus();
      }
    }, 0);
  }

  scrollToBottom(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const element: any = this.myScrollContainer?.nativeElement;
      if (!element) return;

      // Algunos entornos (SSR/JSDOM) o navegadores antiguos no tienen scrollTo en elementos
      if (typeof element.scrollTo === 'function') {
        element.scrollTo({
          top: element.scrollHeight,
          behavior: 'smooth' // Esto fuerza el desplazamiento suave por código
        });
      } else {
        element.scrollTop = element.scrollHeight;
      }
    } catch (err) {
        console.warn('No se pudo desplazar el scroll:', err);
    }
}

  private normalizeText(value: string): string {
    return `${value || ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private ensureWelcomeMessage(): void {
    const alreadyHasWelcome = this.messages.some(
      (m: any) => m?.type === 'bot' && m?.text === this.welcomeMessageText
    );
    if (!alreadyHasWelcome) {
      this.messages.push({ text: this.welcomeMessageText, type: 'bot', chips: this.welcomeChips });
    }
  }

  private normalizeOneLine(value: string, maxLength = 68): string {
    const compact = `${value || ''}`.replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength - 1).trim()}…`;
  }

  private splitSubtitleParts(subtitle?: string): string[] {
    return `${subtitle || ''}`
      .split('•')
      .map((part) => this.normalizeOneLine(part, 90))
      .filter(Boolean);
  }

  private resolveImageFromInfoItem(item: any): string | null {
    const raw = item?.image?.src?.rawUrl || item?.image?.src || item?.image || null;
    if (typeof raw !== 'string') return null;
    const normalized = raw.trim();
    return normalized || null;
  }

  private normalizeImageList(values: unknown[]): string[] {
    const normalized = values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);

    return Array.from(new Set(normalized));
  }

  private startCardImageRotation(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.stopCardImageRotation();

    this.imageRotateIntervalId = setInterval(() => {
      let hasChanges = false;

      for (const message of this.messages) {
        const cards = Array.isArray(message?.products) ? message.products : [];

        for (const card of cards as ChatbotProduct[]) {
          if (card.cardType !== 'product') continue;

          const images = this.normalizeImageList(Array.isArray(card.images) ? card.images : []);
          if (images.length <= 1) continue;
          if (card.isFading) continue;

          const currentIndex = typeof card.imageIndex === 'number' ? card.imageIndex : 0;
          const nextIndex = (currentIndex + 1) % images.length;

          card.images = images;
          card.isFading = true;
          hasChanges = true;

          const timeoutId = setTimeout(() => {
            card.imageIndex = nextIndex;
            card.image = images[nextIndex] || card.image || null;
            card.isFading = false;
            this.imageFadeTimeoutIds.delete(timeoutId);
            this.cdr.markForCheck();
          }, 650);

          this.imageFadeTimeoutIds.add(timeoutId);
        }
      }

      if (hasChanges) {
        this.cdr.markForCheck();
      }
    }, 5000);
  }

  private stopCardImageRotation(): void {
    if (this.imageRotateIntervalId) {
      clearInterval(this.imageRotateIntervalId);
      this.imageRotateIntervalId = null;
    }

    for (const timeoutId of this.imageFadeTimeoutIds) {
      clearTimeout(timeoutId);
    }
    this.imageFadeTimeoutIds.clear();
  }

  getCardImage(card: ChatbotProduct): string | null {
    const images = this.normalizeImageList(Array.isArray(card?.images) ? card.images : []);
    if (images.length > 0) {
      const currentIndex = typeof card.imageIndex === 'number' ? card.imageIndex : 0;
      const safeIndex = ((currentIndex % images.length) + images.length) % images.length;
      return images[safeIndex] || null;
    }

    return card?.image || null;
  }

  private buildCardFromInfoItem(item: any): ChatbotProduct {
    const actionLink = `${item?.actionLink || ''}`.trim();
    const productSlug = this.extractProductSlug(actionLink);
    const artisanSlug = this.extractArtisanSlug(actionLink);
    const subtitleParts = this.splitSubtitleParts(item?.subtitle);
    const title = this.normalizeOneLine(item?.title || 'Elemento destacado', 80);
    const image = this.resolveImageFromInfoItem(item);

    if (productSlug) {
      const images = this.normalizeImageList([image]);
      return {
        id: productSlug,
        title,
        subtitle: subtitleParts.join(' • '),
        image: images[0] || image,
        images,
        imageIndex: 0,
        actionLink,
        cardType: 'product',
        province: subtitleParts[0] || '',
        category: '',
        certification: subtitleParts[1] || '',
        artisanName: ''
      };
    }

    if (artisanSlug) {
      return {
        title,
        subtitle: subtitleParts.join(' • '),
        image,
        actionLink,
        cardType: 'artisan',
        province: subtitleParts[0] || '',
        specialty: subtitleParts[1] || subtitleParts[0] || ''
      };
    }

    return {
      title,
      subtitle: subtitleParts.join(' • '),
      image,
      actionLink,
      cardType: 'unknown'
    };
  }

  private enrichCardsWithRelevantData(cards: ChatbotProduct[]): void {
    const list = Array.isArray(cards) ? cards : [];

    list.forEach((card) => {
      if (card.cardType === 'product' && card.id) {
        if (this.productCardCache.has(card.id)) {
          Object.assign(card, this.productCardCache.get(card.id));
          return;
        }

        this.chatbotService.getProductCardDataBySlug(card.id).subscribe((data) => {
          if (!data) return;

          const images = this.normalizeImageList([
            ...(Array.isArray(data.images) ? data.images : []),
            data.image || '',
            card.image || ''
          ]);
          const safeIndex = images.length > 0
            ? ((card.imageIndex || 0) % images.length + images.length) % images.length
            : 0;

          const patch: Partial<ChatbotProduct> = {
            image: images[safeIndex] || data.image || card.image || null,
            images,
            imageIndex: safeIndex,
            province: this.normalizeOneLine(data.province || card.province || '', 46),
            category: this.normalizeOneLine(data.category || card.category || '', 36),
            certification: this.normalizeOneLine(data.certification || card.certification || '', 52),
            artisanName: this.normalizeOneLine(data.artisanName || card.artisanName || '', 40)
          };

          this.productCardCache.set(card.id as string, patch);
          Object.assign(card, patch);
          this.cdr.markForCheck();
        });
        return;
      }

      if (card.cardType === 'artisan') {
        const slug = this.extractArtisanSlug(card.actionLink);
        if (!slug) return;

        if (this.artisanCardCache.has(slug)) {
          Object.assign(card, this.artisanCardCache.get(slug));
          return;
        }

        this.chatbotService.getArtisanCardDataBySlug(slug).subscribe((data) => {
          if (!data) return;
          const patch: Partial<ChatbotProduct> = {
            image: data.image || card.image || null,
            province: this.normalizeOneLine(data.province || card.province || '', 46),
            specialty: this.normalizeOneLine(data.specialty || card.specialty || '', 56)
          };

          this.artisanCardCache.set(slug, patch);
          Object.assign(card, patch);
          this.cdr.markForCheck();
        });
      }
    });
  }

  private isNearMeCommand(value: string): boolean {
    const normalized = this.normalizeText(value);
    return (
      /^(productos?\s+)?cerca(\s+de\s+mi)?$/.test(normalized) ||
      /^(productos?\s+)?en\s+mi\s+zona$/.test(normalized) ||
      normalized.includes('cerca de mi')
    );
  }

  private isLocationPermissionCommand(value: string): boolean {
    const normalized = this.normalizeText(value);
    return /^(permitir|activar|usar)\s+(mi\s+)?ubicacion$/.test(normalized);
  }

  private isManualCityFallbackCommand(value: string): boolean {
    const normalized = this.normalizeText(value);
    return /^(prefiero\s+indicar\s+ciudad|prefiero\s+escribir\s+ciudad|escribir\s+ciudad)$/.test(normalized);
  }

  private showLocationConsentPrompt(): void {
    const text = 'Para buscar productos cerca de ti, primero necesito tu permiso de ubicación. ¿Quieres permitirlo?';
    this.messages.push({
      text,
      type: 'bot',
      products: [],
      chips: [
        { text: 'Permitir ubicación' },
        { text: 'Prefiero indicar ciudad' }
      ]
    });

    this.cdr.markForCheck();
    setTimeout(() => {
      this.cdr.detectChanges();
      this.scrollToBottom();
    }, 100);
  }

  private async ensureUserLocation(): Promise<UserCoords | null> {
    if (!isPlatformBrowser(this.platformId)) return null;
    if (this.geolocationService.currentCoords) {
      return this.geolocationService.currentCoords;
    }
    return this.geolocationService.requestLocation();
  }

  async sendText(text?: string) {
    // Si el usuario escribe, quitamos el preview
    this.welcomePreviewVisible = false;

    const messageToSend = text || this.userInput;
    if (!messageToSend || !messageToSend.trim()) return;

    // Añadir mensaje del usuario
    this.messages.push({ text: messageToSend, type: 'user' });
    this.userInput = '';

    const isNearMe = this.isNearMeCommand(messageToSend);
    const isPermissionCommand = this.isLocationPermissionCommand(messageToSend);
    const isManualCityFallback = this.isManualCityFallbackCommand(messageToSend);

    if (isNearMe && !isPermissionCommand && !this.locationConsentGrantedInChat) {
      this.showLocationConsentPrompt();
      return;
    }

    if (isPermissionCommand) {
      const coords = await this.ensureUserLocation();
      this.locationConsentGrantedInChat = !!coords;
      this.chatbotService.setUserLocation(coords);
    }

    if (isManualCityFallback) {
      this.locationConsentGrantedInChat = false;
      this.chatbotService.setUserLocation(null);
    }

    let outgoingText = messageToSend;
    if (isPermissionCommand || isManualCityFallback) {
      outgoingText = 'Productos cerca de mí';
    }

    this.chatbotService.sendMessage(outgoingText).subscribe({
      next: (res: any) => {
        // Persistimos contextos entre turnos para que Dialogflow mantenga el flujo
        this.chatbotService.setOutputContexts(res?.outputContexts);

        const botResponse: any = {
          text: res.fulfillmentText,
          type: 'bot',
          products: [],
          chips: []
        };

        // Extraer contenido rico
        const payload = res.fulfillmentMessages?.find((m: any) => m.payload)?.payload;
        if (payload && payload.richContent) {
          const content = payload.richContent[0];

          // MAPEAMOS LOS PRODUCTOS AQUÍ
          botResponse.products = content
            .filter((item: any) => item.type === 'info')
            .map((item: any) => this.buildCardFromInfoItem(item))
            .filter((card: ChatbotProduct) => !!card.title);

          this.enrichCardsWithRelevantData(botResponse.products);

          // Extraer chips/sugerencias
          botResponse.chips = content.find((item: any) => item.type === 'chips')?.options;
        }

        this.messages.push(botResponse);

        // --- SINCRONIZACIÓN CON EL MAPA ---
        this.emitMapFilterFromBotResponse(res, messageToSend);

        // FORZADO DOBLE:
        // 1. Notificamos a Angular del cambio
        this.cdr.markForCheck(); 
        
        // 2. Usamos setTimeout para que se ejecute en el siguiente tick del navegador
        // Esto suele solucionar el problema cuando el componente parece "congelado"
        setTimeout(() => {
          this.cdr.detectChanges();
          this.scrollToBottom(); // Función opcional para bajar el scroll
        }, 100);
      },
        error: (err) => {
          console.error('Error:', err);
          this.messages.push({ text: 'Error de conexión', type: 'bot' });
          this.cdr.detectChanges(); // También aquí por si hay error
        }
      });
  }

  onProductCardClick(product: ChatbotProduct, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    const artisanSlug = this.extractArtisanSlug(product?.actionLink);
    if (artisanSlug) {
      this.router.navigate(['/artesano', artisanSlug]);
      this.isOpen = false;
      return;
    }
    this.productSelected.emit(product);
  }

  private extractProductSlug(actionLink?: string): string | undefined {
    if (!actionLink) return undefined;
    // Solo extraer slugs de productos, no de artesanos
    const match = actionLink.match(/\/producto\/([^/?#]+)/);
    return match?.[1];
  }

  private extractArtisanSlug(actionLink?: string): string | undefined {
    if (!actionLink) return undefined;
    const match = actionLink.match(/\/artesano\/([^/?#]+)/);
    return match?.[1];
  }

  /**
   * Analiza la respuesta del bot y emite un evento de filtro de mapa si procede.
   * - Si el usuario pidió "quitar filtros" → emite clearFilters: true
   * - Si el contexto buscando-productos tiene categoría/certificación → emite los filtros
   */
  private emitMapFilterFromBotResponse(res: any, userText: string): void {
    const normalizedUserText = this.normalizeText(userText);

    // Detectar comando "quitar filtros"
    const isClearFilters =
      /^(quitar|limpiar|borrar|reiniciar)\s+filtros?$/.test(normalizedUserText) ||
      /^ver\s+sin\s+filtros?$/.test(normalizedUserText) ||
      /^sin\s+filtros?$/.test(normalizedUserText);

    if (isClearFilters) {
      this.mapFilterChange.emit({ category: '', certification: '', focusLocation: '', clearFilters: true });
      return;
    }

    // Leer los contextos de la respuesta para extraer filtros activos
    const outputContexts: any[] = res?.outputContexts || [];
    const productCtx = outputContexts.find(
      (ctx: any) => typeof ctx?.name === 'string' && ctx.name.includes('buscando-productos')
    );

    const userLocationCtx = outputContexts.find(
      (ctx: any) => typeof ctx?.name === 'string' && ctx.name.includes('ubicacion-usuario')
    );

    const locationFromProductCtx = `${productCtx?.parameters?.region || productCtx?.parameters?.ciudad || ''}`.trim();
    const locationFromUserCtx = `${userLocationCtx?.parameters?.provincia || userLocationCtx?.parameters?.ciudad || ''}`.trim();
    const focusLocation = locationFromProductCtx || locationFromUserCtx;

    if (!productCtx) {
      if (focusLocation) {
        this.mapFilterChange.emit({
          category: '',
          certification: '',
          focusLocation,
          clearFilters: false
        });
      }
      return;
    }

    const categoria: string = `${productCtx?.parameters?.categoria || ''}`.trim();
    const certificacion: string = `${productCtx?.parameters?.certificacion || ''}`.trim();

    // Emitir si hay filtros de categoría/certificación o ubicación de enfoque.
    if (categoria || certificacion || focusLocation) {
      this.mapFilterChange.emit({
        category: categoria,
        certification: certificacion,
        focusLocation,
        clearFilters: false
      });
    }
  }
}
