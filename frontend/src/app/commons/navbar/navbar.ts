import { Component, Input, ChangeDetectorRef, OnDestroy, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AsyncPipe, CommonModule } from '@angular/common'; 
import { AuthService } from '../../layouts/auth-layout/auth.service';
import { CustomTooltipDirective } from '../../shared/custom-tooltip.directive'; 
import { Observable } from 'rxjs';

@Component({
  selector: 'app-navbar',
  imports: [RouterLink, CommonModule, AsyncPipe, CustomTooltipDirective],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css',
  standalone: true,
})
export class Navbar implements OnInit, OnDestroy {
    @Input() logoToHome: boolean = false;

    public isLoggedIn$: Observable<boolean>; 
    private isLoggedInSub: any;
    public showMenu: boolean = false;

    constructor(private authService: AuthService, public router: Router, private cdr: ChangeDetectorRef) {
        this.isLoggedIn$ = this.authService.isLoggedIn$;
    }

    ngOnInit() {
        this.isLoggedInSub = this.isLoggedIn$.subscribe(() => {
            this.cdr.detectChanges();
        });
    }

    ngOnDestroy() {
        if (this.isLoggedInSub) {
            this.isLoggedInSub.unsubscribe();
        }
    }

    toggleMenu() {
        this.showMenu = !this.showMenu;
    }

    logOut() {
        this.showMenu = false;
        this.authService.logOut();
    }

    handleLogoClick(event: MouseEvent) {
        if (this.logoToHome) {
            event.preventDefault();
            this.router.navigate(['/home']);
            this.showMenu = false;
            return;
        }
        // Si estamos en home, ir a landing
        if (this.router.url === '/' || this.router.url.startsWith('/home')) {
            event.preventDefault();
            this.router.navigate(['/']); // landing es la ruta vacía
            this.showMenu = false;
            return;
        }
        this.showMenu = false;
    }
}
