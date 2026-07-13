import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { AdminUserCreateComponent } from './admin-user-create.component';
import { AdminUsersService } from '../../services/admin-users.service';

describe('AdminUserCreateComponent', () => {
  let component: AdminUserCreateComponent;
  let fixture: ComponentFixture<AdminUserCreateComponent>;
  let adminUsersServiceSpy: jasmine.SpyObj<AdminUsersService>;

  beforeEach(async () => {
    adminUsersServiceSpy = jasmine.createSpyObj<AdminUsersService>('AdminUsersService', ['createUser']);
    adminUsersServiceSpy.createUser.and.returnValue(of({ ok: true, msg: 'Usuario creado' }));

    await TestBed.configureTestingModule({
      imports: [AdminUserCreateComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AdminUsersService, useValue: adminUsersServiceSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AdminUserCreateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('requires artisan fields when the role changes to artisan', () => {
    component.userForm.get('role')?.setValue('artisan');

    expect(component.userForm.get('company_name')?.hasError('required')).toBeTrue();
    expect(component.userForm.get('province')?.hasError('required')).toBeTrue();
  });

  it('submits the artisan payload with all artisan fields', () => {
    const usuarioCreadoSpy = jasmine.createSpy('usuarioCreado');
    component.usuarioCreado.subscribe(usuarioCreadoSpy);

    component.userForm.setValue({
      name: 'Lucia',
      surname: 'Lopez',
      email: 'lucia@noma.test',
      password: '123456',
      role: 'artisan',
      company_name: 'Taller Lucia',
      description: 'Cerámica tradicional con técnicas locales.',
      address_text: 'Calle Mayor 12, Valencia',
      contact: '600123456',
      province: 'Valencia'
    });

    component.submit();

    expect(adminUsersServiceSpy.createUser).toHaveBeenCalledWith(jasmine.objectContaining({
      role: 'artisan',
      company_name: 'Taller Lucia',
      province: 'Valencia'
    }));
    expect(usuarioCreadoSpy).toHaveBeenCalled();
  });
});
