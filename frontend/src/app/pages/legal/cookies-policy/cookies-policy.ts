import { Component, OnInit, OnDestroy, Renderer2, Inject, PLATFORM_ID, ViewEncapsulation } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Navbar } from '../../../commons/navbar/navbar';
import { Footer } from '../../../commons/footer/footer';
import { ConsentService } from '../../../services/consent.service';

@Component({
  selector: 'app-cookies-policy',
  standalone: true,
  imports: [RouterLink, Navbar, Footer],
  templateUrl: './cookies-policy.html',
  styleUrl: './cookies-policy.css',
  encapsulation: ViewEncapsulation.None
})
export class CookiesPolicy implements OnInit, OnDestroy {
  constructor(
    private renderer: Renderer2,
    @Inject(DOCUMENT) private document: Document,
    @Inject(PLATFORM_ID) private platformId: Object,
    private consentService: ConsentService
  ) {}

  ngOnInit(): void {
    this.renderer.addClass(this.document.body, 'legal-page');
  }

  ngOnDestroy(): void {
    this.renderer.removeClass(this.document.body, 'legal-page');
  }

  resetConsent(): void {
    this.consentService.resetConsent();
  }
}
