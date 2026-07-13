import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { AuthService } from '../../../layouts/auth-layout/auth.service';
import { AdminUsersService } from './services/admin-users.service';

import { Perfil } from './perfil';

describe('Perfil', () => {
  let component: Perfil;
  let fixture: ComponentFixture<Perfil>;
  const isLoggedIn$ = new BehaviorSubject(true);

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [Perfil],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            isLoggedIn$,
            uid: 'admin-1',
            getToken: () => 'token',
            logOut: () => undefined
          }
        },
        {
          provide: HttpClient,
          useValue: {
            get: () => of({
              ok: true,
              users: [{
                uid: 'admin-1',
                name: 'Admin',
                surname: 'Root',
                email: 'admin@noma.test',
                role: 'admin',
                active: true
              }]
            })
          }
        },
        {
          provide: AdminUsersService,
          useValue: {
            usersChanged$: of(),
            getUsers: () => of([]),
            createUser: () => of({ ok: true, msg: 'ok' }),
            updateUser: () => of({ ok: true, msg: 'ok' }),
            deleteUser: () => of({ ok: true, msg: 'ok' }),
            notifyUsersChanged: () => undefined
          }
        }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Perfil);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the admin user management entry for admin users', () => {
    expect(fixture.nativeElement.textContent).toContain('Usuarios');
    expect(fixture.nativeElement.textContent).not.toContain('Crear usuario');
  });

  it('opens the admin products section without an extra password prompt', () => {
    component.setSeccionActiva('productos-admin');

    expect(component.seccionActiva).toBe('productos-admin');
    expect(localStorage.getItem('perfil_seccion_activa')).toBe('productos-admin');
  });

  it('opens the admin users section without an extra password prompt', () => {
    component.setSeccionActiva('usuarios');

    expect(component.seccionActiva).toBe('usuarios');
    expect(localStorage.getItem('perfil_seccion_activa')).toBe('usuarios');
  });

  it('restores admin sections directly from localStorage', async () => {
    localStorage.setItem('perfil_seccion_activa', 'productos-admin');

    const adminFixture = TestBed.createComponent(Perfil);
    const adminComponent = adminFixture.componentInstance;
    adminFixture.detectChanges();
    await adminFixture.whenStable();

    expect(adminComponent.seccionActiva).toBe('productos-admin');
  });

  it('prompts before leaving "Subir producto" when there are unsaved changes', () => {
    component.seccionActiva = 'producto';
    (component as any).subirProductoComponent = {
      tieneCambiosSinGuardar: () => true
    };

    component.setSeccionActiva('favoritos');

    expect(component.seccionActiva).toBe('producto');
    expect(component.showProductExitPrompt).toBeTrue();
  });

  it('saves draft and continues navigation from the unsaved-changes prompt', async () => {
    const guardarComoBorradorSpy = jasmine.createSpy('guardarComoBorrador');
    component.seccionActiva = 'producto';
    (component as any).subirProductoComponent = {
      tieneCambiosSinGuardar: () => true,
      guardarComoBorrador: guardarComoBorradorSpy
    };

    component.setSeccionActiva('favoritos');
    await component.saveDraftAndLeaveProduct();

    expect(guardarComoBorradorSpy).toHaveBeenCalled();
    expect(component.seccionActiva).toBe('favoritos');
    expect(component.showProductExitPrompt).toBeFalse();
  });
});
