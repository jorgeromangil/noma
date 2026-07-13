import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { LoginComponent } from './login';
import { AuthService } from '../../layouts/auth-layout/auth.service';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;

  beforeEach(async () => {
    (globalThis as any).google = {
      accounts: {
        id: {
          initialize: () => undefined,
          renderButton: () => undefined
        }
      }
    };

    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', [
      'googleSignIn',
      'login',
      'getToken',
      'consumeDisabledAccountNotice'
    ]);
    authServiceSpy.googleSignIn.and.returnValue(of({ ok: true, msg: 'ok' }));
    authServiceSpy.login.and.returnValue(of({ ok: true, msg: 'ok' }));
    authServiceSpy.getToken.and.returnValue(null);
    authServiceSpy.consumeDisabledAccountNotice.and.returnValue('');

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, LoginComponent],
      providers: [
        {
          provide: AuthService,
          useValue: authServiceSpy
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    delete (globalThis as any).google;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the disabled account popup when login returns USER_DISABLED', () => {
    authServiceSpy.login.and.returnValue(of({
      ok: false,
      code: 'USER_DISABLED',
      msg: 'Tu cuenta está desactivada.'
    }));

    component.loginData.email = 'admin@noma.test';
    component.loginData.password = '123456';
    component.login();

    expect(component.showDisabledPopup).toBeTrue();
    expect(component.disabledPopupMessage).toContain('desactivada');
  });
});
