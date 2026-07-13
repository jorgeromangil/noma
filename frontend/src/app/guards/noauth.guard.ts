import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService } from '../layouts/auth-layout/auth.service'; 
import { tap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class NoAuthGuard implements CanActivate {
  
  constructor( private authService: AuthService,
                private router: Router) {}

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean> {
      return this.authService.validarNoToken() 
              .pipe(
                tap( noEstaAutenticado => {
                  if (!noEstaAutenticado) {
                    this.router.navigateByUrl('/home');
                  }
                })
              );
  }
}
