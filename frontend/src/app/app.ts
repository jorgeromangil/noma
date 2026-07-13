import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CookieBanner } from './commons/cookie-banner/cookie-banner';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CookieBanner],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('frontend');
}
