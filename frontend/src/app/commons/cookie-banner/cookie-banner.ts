import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { trigger, transition, style, animate } from '@angular/animations';
import { ConsentService } from '../../services/consent.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-cookie-banner',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './cookie-banner.html',
  styleUrl: './cookie-banner.css',
  animations: [
    trigger('slideIn', [
      transition(':enter', [
        style({ transform: 'translateX(-50%) translateY(150px)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateX(-50%) translateY(0)', opacity: 1 }))
      ]),
      transition(':leave', [
        animate('300ms ease-in', style({ transform: 'translateX(-50%) translateY(150px)', opacity: 0 }))
      ])
    ])
  ]
})
export class CookieBanner implements OnInit, OnDestroy {
  hasConsented = false;
  private destroy$ = new Subject<void>();

  constructor(private consentService: ConsentService) {}

  ngOnInit(): void {
    this.hasConsented = this.consentService.hasConsented();
    
    // Escuchar cambios en el estado de consentimiento
    this.consentService.acknowledged$
      .pipe(takeUntil(this.destroy$))
      .subscribe(acknowledged => {
        this.hasConsented = acknowledged;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onAcceptAll(): void {
    this.consentService.acceptAll();
    this.consentService.setConsentAcknowledged();
    this.hasConsented = true;
  }

  onRejectAnalytics(): void {
    this.consentService.rejectAll();
    this.consentService.setConsentAcknowledged();
    this.hasConsented = true;
  }
}
