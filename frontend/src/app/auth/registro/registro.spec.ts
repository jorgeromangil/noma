import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { RegistroComponent } from './registro';
import { AuthService } from '../../layouts/auth-layout/auth.service';

describe('RegistroComponent', () => {
  let component: RegistroComponent;
  let fixture: ComponentFixture<RegistroComponent>;

  beforeEach(async () => {
    (globalThis as any).google = {
      accounts: {
        id: {
          initialize: () => undefined,
          renderButton: () => undefined
        }
      }
    };

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, RegistroComponent],
      providers: [
        {
          provide: AuthService,
          useValue: {
            googleSignIn: () => of({ ok: true }),
            register: () => of({ ok: true }),
            getToken: () => null
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RegistroComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    delete (globalThis as any).google;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should disable Google button when artisan is selected', () => {
    component.isArtisan = true;
    fixture.detectChanges();

    const googleButton = fixture.nativeElement.querySelector('.boton-google-custom') as HTMLButtonElement;
    expect(googleButton.disabled).toBeTrue();
  });
});
