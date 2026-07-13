import { Component, OnInit, OnDestroy, Renderer2, Inject, PLATFORM_ID, ViewEncapsulation } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Navbar } from '../../../commons/navbar/navbar';
import { Footer } from '../../../commons/footer/footer';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [RouterLink, Navbar, Footer],
  templateUrl: './privacy-policy.html',
  styleUrl: './privacy-policy.css',
  encapsulation: ViewEncapsulation.None
})
export class PrivacyPolicy implements OnInit, OnDestroy {
  constructor(
    private renderer: Renderer2,
    @Inject(DOCUMENT) private document: Document,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    this.renderer.addClass(this.document.body, 'legal-page');
  }

  ngOnDestroy(): void {
    this.renderer.removeClass(this.document.body, 'legal-page');
  }
}
