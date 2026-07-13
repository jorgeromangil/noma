import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, OnChanges, OnDestroy, OnInit, PLATFORM_ID, SimpleChanges } from '@angular/core';
import { NgFor, NgIf, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';

type HeroSlide = {
  src: string;
  alt?: string;
};

@Component({
  selector: 'app-carrusel',
  standalone: true,
  imports: [NgFor, NgIf, RouterLink],
  templateUrl: './carrusel.html',
  styleUrl: './carrusel.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Carrusel implements OnInit, AfterViewInit, OnDestroy, OnChanges {
  @Input({ required: true }) slides: HeroSlide[] = [];
  @Input() heading = '';
  @Input() subtitle = '';
  @Input() note = '';
  @Input() ctaLabel = '';
  @Input() ctaLink: string | any[] = '/home';
  @Input() intervalMs = 3000;
  @Input() autoPlay = true;

  currentSlide = 0;
  progress = 0;
  private slideStart = 0;
  private progressIntervalId?: number;
  private viewReady = false;

  constructor(
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (this.viewReady && (changes['slides'] || changes['intervalMs'] || changes['autoPlay'])) {
      this.restartSlideLoop();
      this.cdr.markForCheck();
    }
  }

  ngOnInit(): void {
    this.viewReady = true;
    this.restartSlideLoop();
    this.cdr.markForCheck();
  }

  ngAfterViewInit(): void {
    // Nothing extra; kept for future DOM-dependent hooks
  }

  ngOnDestroy(): void {
    this.clearSlideTimers();
  }

  prevSlide(): void {
    if (!this.slides.length) {
      return;
    }

    const prevIndex = (this.currentSlide - 1 + this.slides.length) % this.slides.length;
    this.goToSlide(prevIndex);
  }

  nextSlideManual(): void {
    if (!this.slides.length) {
      return;
    }

    const nextIndex = (this.currentSlide + 1) % this.slides.length;
    this.goToSlide(nextIndex, true);
  }

  goToSlide(index: number, resetLoop = false): void {
    this.setSlide(index);
    if (resetLoop) {
      this.restartSlideLoop();
    }
  }

  isPrev(index: number): boolean {
    if (this.slides.length <= 1) {
      return false;
    }

    return index === (this.currentSlide - 1 + this.slides.length) % this.slides.length;
  }

  isNext(index: number): boolean {
    if (this.slides.length <= 1) {
      return false;
    }

    return index === (this.currentSlide + 1) % this.slides.length;
  }

  onSliderClick(event: MouseEvent): void {
    if (!this.slides.length) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('.slider-dots') || target?.closest('.nav-btn')) {
      return;
    }

    const container = event.currentTarget as HTMLElement | null;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    if (clickX < rect.width / 2) {
      this.prevSlide();
    } else {
      this.nextSlideManual();
    }
  }

  private startSlideLoop(): void {
    if (!this.autoPlay || !isPlatformBrowser(this.platformId) || typeof window === 'undefined' || !this.slides.length) {
      return;
    }

    this.clearSlideTimers();
    this.slideStart = this.now();
    this.progress = 0;

    this.progressIntervalId = window.setInterval(() => {
      const elapsed = this.now() - this.slideStart;
      const pct = Math.min(100, (elapsed / this.intervalMs) * 100);

      this.progress = pct;
      this.cdr.markForCheck();

      if (elapsed >= this.intervalMs && this.slides.length && this.slides.length > 1) {
        this.setSlide((this.currentSlide + 1) % this.slides.length);
      }
    }, 50);
  }

  private restartSlideLoop(): void {
    this.clearSlideTimers();
    this.startSlideLoop();
  }

  private clearSlideTimers(): void {
    if (this.progressIntervalId) {
      clearInterval(this.progressIntervalId);
      this.progressIntervalId = undefined;
    }
  }

  private setSlide(index: number): void {
    if (!this.slides.length) {
      return;
    }

    this.currentSlide = ((index % this.slides.length) + this.slides.length) % this.slides.length;
    this.slideStart = this.now();
    this.progress = 0;
    this.cdr.markForCheck();
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }
}
