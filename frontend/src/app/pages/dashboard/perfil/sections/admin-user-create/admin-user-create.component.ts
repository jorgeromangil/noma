import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { Subscription } from 'rxjs';
import { AdminUserPayload, AdminUsersService } from '../../services/admin-users.service';

@Component({
  selector: 'app-admin-user-create',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, NgSelectModule],
  templateUrl: './admin-user-create.component.html',
  styleUrl: './admin-user-create.component.css'
})
export class AdminUserCreateComponent implements OnInit, OnDestroy {
  @Input() embedded = false;
  @Output() mostrarPopup = new EventEmitter<{ title: string; message: string }>();
  @Output() usuarioCreado = new EventEmitter<void>();

  readonly roleOptions = [
    { value: 'regular', label: 'Nómada' },
    { value: 'artisan', label: 'Artesano' }
  ] as const;

  readonly userForm: FormGroup;
  loading = false;
  backendError = '';
  private roleSub?: Subscription;

  constructor(
    private fb: FormBuilder,
    private adminUsersService: AdminUsersService
  ) {
    this.userForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50), Validators.pattern(/[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\s]+/)]],
      surname: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50), Validators.pattern(/[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\s]+/)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(100)]],
      role: ['regular', [Validators.required]],
      company_name: ['', [Validators.minLength(2), Validators.maxLength(100)]],
      description: ['', [Validators.minLength(10), Validators.maxLength(500)]],
      address_text: ['', [Validators.minLength(5), Validators.maxLength(200)]],
      contact: ['', [Validators.pattern(/[0-9+\s()-]{9,15}/)]],
      province: ['', [Validators.minLength(2), Validators.maxLength(50)]]
    });
  }

  ngOnInit(): void {
    this.roleSub = this.userForm.get('role')?.valueChanges.subscribe((role) => {
      this.applyArtisanValidators(role === 'artisan');
    });
    this.applyArtisanValidators(false);
  }

  ngOnDestroy(): void {
    this.roleSub?.unsubscribe();
  }

  get isArtisan(): boolean {
    return this.userForm.get('role')?.value === 'artisan';
  }

  private applyArtisanValidators(isArtisan: boolean): void {
    const artisanControls: Array<[string, ValidatorFn[]]> = [
      ['company_name', [Validators.minLength(2), Validators.maxLength(100)]],
      ['description', [Validators.minLength(10), Validators.maxLength(500)]],
      ['address_text', [Validators.minLength(5), Validators.maxLength(200)]],
      ['contact', [Validators.pattern(/[0-9+\s()-]{9,15}/)]],
      ['province', [Validators.minLength(2), Validators.maxLength(50)]]
    ];

    artisanControls.forEach(([controlName, validators]) => {
      const control = this.userForm.get(controlName);
      if (!control) return;
      control.setValidators(isArtisan ? [Validators.required, ...validators] : validators);
      if (!isArtisan) {
        control.setValue('', { emitEvent: false });
      }
      control.updateValueAndValidity({ emitEvent: false });
    });
  }

  private buildPayload(): AdminUserPayload {
    const raw = this.userForm.getRawValue();
    const payload: AdminUserPayload = {
      name: String(raw.name || '').trim(),
      surname: String(raw.surname || '').trim(),
      email: String(raw.email || '').trim(),
      password: String(raw.password || ''),
      role: raw.role
    };

    if (raw.role === 'artisan') {
      payload.company_name = String(raw.company_name || '').trim();
      payload.description = String(raw.description || '').trim();
      payload.address_text = String(raw.address_text || '').trim();
      payload.contact = String(raw.contact || '').trim();
      payload.province = String(raw.province || '').trim();
    }

    return payload;
  }

  submit(): void {
    this.backendError = '';
    if (this.userForm.invalid) {
      this.userForm.markAllAsTouched();
      return;
    }

    this.loading = true;
    const payload = this.buildPayload();

    this.adminUsersService.createUser(payload).subscribe({
      next: (resp) => {
        this.loading = false;
        this.userForm.reset({
          name: '',
          surname: '',
          email: '',
          password: '',
          role: 'regular',
          company_name: '',
          description: '',
          address_text: '',
          contact: '',
          province: ''
        });
        this.applyArtisanValidators(false);
        this.mostrarPopup.emit({
          title: 'Usuario creado',
          message: resp.msg || 'El usuario se ha creado correctamente.'
        });
        this.usuarioCreado.emit();
      },
      error: (err) => {
        this.loading = false;
        this.backendError = err?.error?.msg || 'No se pudo crear el usuario.';
      }
    });
  }
}
