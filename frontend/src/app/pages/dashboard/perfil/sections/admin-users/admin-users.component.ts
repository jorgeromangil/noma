import { ChangeDetectorRef, Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { Subscription } from 'rxjs';
import { AdminManagedUser, AdminUserPayload, AdminUsersService } from '../../services/admin-users.service';
import { AuthService } from '../../../../../layouts/auth-layout/auth.service';
import { AdminUserCreateComponent } from '../admin-user-create/admin-user-create.component';

interface ConfirmDialogState {
  title: string;
  message: string;
  actionLabel: string;
  kind: 'primary' | 'danger';
  onConfirm: () => void;
}

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, NgSelectModule, AdminUserCreateComponent],
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.css'
})
export class AdminUsersComponent implements OnInit, OnDestroy {
  @Output() mostrarPopup = new EventEmitter<{ title: string; message: string }>();

  readonly roleFilterOptions = [
    { value: '', label: 'Todos los roles' },
    { value: 'regular', label: 'Nómadas' },
    { value: 'artisan', label: 'Artesanos' },
    { value: 'admin', label: 'Admins' }
  ];

  readonly statusFilterOptions = [
    { value: 'active', label: 'Activos' },
    { value: 'inactive', label: 'Desactivados' },
    { value: 'all', label: 'Todos' }
  ];

  readonly sortOptions = [
    { value: 'created_desc', label: 'Fecha de creación' },
    { value: 'alphabetical', label: 'Orden alfabético' },
    { value: 'role', label: 'Tipo de usuario' }
  ];

  readonly editableRoleOptions = [
    { value: 'regular', label: 'Nómada' },
    { value: 'artisan', label: 'Artesano' }
  ];

  allUsers: AdminManagedUser[] = [];
  users: AdminManagedUser[] = [];
  loading = false;
  error = '';
  searchQuery = '';
  selectedRole = '';
  selectedStatus = 'active';
  selectedSort = 'created_desc';
  overallUserCount = 0;
  totalUsers = 0;

  showEditModal = false;
  showCreateModal = false;
  editLoading = false;
  editError = '';
  editingUser: AdminManagedUser | null = null;
  readonly editForm: FormGroup;

  confirmDialog: ConfirmDialogState | null = null;
  confirmLoading = false;

  private readonly subscriptions = new Subscription();

  constructor(
    private adminUsersService: AdminUsersService,
    private authService: AuthService,
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef
  ) {
    this.editForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50), Validators.pattern(/[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\s]+/)]],
      surname: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50), Validators.pattern(/[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\s]+/)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.minLength(6), Validators.maxLength(100)]],
      role: ['regular', [Validators.required]],
      company_name: ['', [Validators.minLength(2), Validators.maxLength(100)]],
      description: ['', [Validators.minLength(10), Validators.maxLength(500)]],
      address_text: ['', [Validators.minLength(5), Validators.maxLength(200)]],
      contact: ['', [Validators.pattern(/[0-9+\s()-]{9,15}/)]],
      province: ['', [Validators.minLength(2), Validators.maxLength(50)]]
    });
  }

  ngOnInit(): void {
    const roleControl = this.editForm.get('role');
    if (roleControl) {
      this.subscriptions.add(
        roleControl.valueChanges.subscribe((role) => {
          this.applyArtisanValidators(this.editForm, role === 'artisan');
        })
      );
    }

    this.subscriptions.add(
      this.adminUsersService.usersChanged$.subscribe(() => {
        this.loadUsers();
      })
    );

    this.loadUsers();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get currentUserId(): string {
    return this.authService.uid;
  }

  trackByUser(_: number, user: AdminManagedUser): string {
    return user.uid;
  }

  isUserActive(user: AdminManagedUser): boolean {
    return user.active !== false;
  }

  getRoleLabel(role: string): string {
    switch (role) {
      case 'admin':
        return 'Admin';
      case 'artisan':
        return 'Artesano';
      default:
        return 'Nómada';
    }
  }

  getStatusLabel(user: AdminManagedUser): string {
    return this.isUserActive(user) ? 'Activo' : 'Desactivado';
  }

  loadUsers(): void {
    this.loading = true;
    this.error = '';

    this.adminUsersService.getUsers().subscribe({
      next: (users) => {
        this.allUsers = Array.isArray(users) ? [...users] : [];
        this.overallUserCount = this.allUsers.length;
        this.applyFilters();
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.msg || 'No se pudo cargar la lista de usuarios.';
        this.cdr.detectChanges();
      }
    });
  }

  applyFilters(): void {
    this.updateVisibleUsers();
  }

  resetFilters(): void {
    this.searchQuery = '';
    this.selectedRole = '';
    this.selectedStatus = 'active';
    this.selectedSort = 'created_desc';
    this.updateVisibleUsers();
  }

  canEdit(user: AdminManagedUser): boolean {
    return user.role !== 'admin';
  }

  canToggleState(user: AdminManagedUser): boolean {
    return user.role !== 'admin' && user.uid !== this.currentUserId;
  }

  canDelete(user: AdminManagedUser): boolean {
    return this.canToggleState(user) && !this.isUserActive(user);
  }

  openEditModal(user: AdminManagedUser): void {
    if (!this.canEdit(user)) {
      return;
    }

    this.editingUser = user;
    this.editError = '';
    this.editForm.reset({
      name: user.name || '',
      surname: user.surname || '',
      email: user.email || '',
      password: '',
      role: user.role === 'artisan' ? 'artisan' : 'regular',
      company_name: user.company_name || '',
      description: user.description || '',
      address_text: user.address_text || '',
      contact: user.contact || '',
      province: user.province || ''
    });
    this.applyArtisanValidators(this.editForm, user.role === 'artisan');
    this.showEditModal = true;
  }

  openCreateModal(): void {
    this.showCreateModal = true;
  }

  closeCreateModal(): void {
    this.showCreateModal = false;
  }

  onUserCreated(): void {
    this.showCreateModal = false;
    this.cdr.detectChanges();
  }

  closeEditModal(force = false): void {
    if (this.editLoading && !force) {
      return;
    }

    this.showEditModal = false;
    this.editingUser = null;
    this.editError = '';
    this.cdr.detectChanges();
  }

  private applyArtisanValidators(form: FormGroup, isArtisan: boolean): void {
    const artisanControls: Array<[string, ValidatorFn[]]> = [
      ['company_name', [Validators.minLength(2), Validators.maxLength(100)]],
      ['description', [Validators.minLength(10), Validators.maxLength(500)]],
      ['address_text', [Validators.minLength(5), Validators.maxLength(200)]],
      ['contact', [Validators.pattern(/[0-9+\s()-]{9,15}/)]],
      ['province', [Validators.minLength(2), Validators.maxLength(50)]]
    ];

    artisanControls.forEach(([controlName, validators]) => {
      const control = form.get(controlName);
      if (!control) return;
      control.setValidators(isArtisan ? [Validators.required, ...validators] : validators);
      if (!isArtisan) {
        control.setValue('', { emitEvent: false });
      }
      control.updateValueAndValidity({ emitEvent: false });
    });
  }

  private buildEditPayload(): Partial<AdminUserPayload> {
    const raw = this.editForm.getRawValue();
    const payload: Partial<AdminUserPayload> = {
      name: String(raw.name || '').trim(),
      surname: String(raw.surname || '').trim(),
      email: String(raw.email || '').trim(),
      role: raw.role
    };

    if (String(raw.password || '').trim()) {
      payload.password = String(raw.password || '');
    }

    if (raw.role === 'artisan') {
      payload.company_name = String(raw.company_name || '').trim();
      payload.description = String(raw.description || '').trim();
      payload.address_text = String(raw.address_text || '').trim();
      payload.contact = String(raw.contact || '').trim();
      payload.province = String(raw.province || '').trim();
    }

    return payload;
  }

  private updateVisibleUsers(): void {
    const query = this.normalizeForSearch(this.searchQuery);
    const filteredUsers = this.allUsers.filter((user) => {
      if (this.selectedRole && user.role !== this.selectedRole) {
        return false;
      }

      if (this.selectedStatus === 'active' && !this.isUserActive(user)) {
        return false;
      }

      if (this.selectedStatus === 'inactive' && this.isUserActive(user)) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = this.normalizeForSearch([
        user.name,
        user.surname,
        user.email,
        user.company_name
      ].filter(Boolean).join(' '));

      return haystack.includes(query);
    });
    const sortedUsers = [...filteredUsers].sort((a, b) => this.compareUsers(a, b));

    this.totalUsers = sortedUsers.length;
    this.users = sortedUsers;
  }

  private normalizeForSearch(value: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private compareUsers(a: AdminManagedUser, b: AdminManagedUser): number {
    switch (this.selectedSort) {
      case 'alphabetical':
        return this.compareUsersAlphabetically(a, b);
      case 'role':
        return this.compareUsersByRole(a, b);
      default:
        return this.compareUsersByCreatedAt(a, b);
    }
  }

  private compareUsersByCreatedAt(a: AdminManagedUser, b: AdminManagedUser): number {
    const createdAtDiff = this.getCreatedAtTimestamp(b) - this.getCreatedAtTimestamp(a);
    return createdAtDiff !== 0 ? createdAtDiff : this.compareUsersAlphabetically(a, b);
  }

  private compareUsersAlphabetically(a: AdminManagedUser, b: AdminManagedUser): number {
    const fullNameA = this.normalizeForSearch(`${a.name || ''} ${a.surname || ''}`) || this.normalizeForSearch(a.email);
    const fullNameB = this.normalizeForSearch(`${b.name || ''} ${b.surname || ''}`) || this.normalizeForSearch(b.email);
    const nameDiff = fullNameA.localeCompare(fullNameB, 'es');
    return nameDiff !== 0 ? nameDiff : this.normalizeForSearch(a.email).localeCompare(this.normalizeForSearch(b.email), 'es');
  }

  private compareUsersByRole(a: AdminManagedUser, b: AdminManagedUser): number {
    const roleWeights: Record<AdminManagedUser['role'], number> = {
      admin: 0,
      artisan: 1,
      regular: 2
    };
    const roleDiff = (roleWeights[a.role] ?? 99) - (roleWeights[b.role] ?? 99);
    return roleDiff !== 0 ? roleDiff : this.compareUsersAlphabetically(a, b);
  }

  private getCreatedAtTimestamp(user: AdminManagedUser): number {
    const timestamp = Date.parse(user.createdAt || '');
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  saveEdit(): void {
    if (!this.editingUser) {
      return;
    }

    this.editError = '';
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }

    this.editLoading = true;
    this.adminUsersService.updateUser(this.editingUser.uid, this.buildEditPayload()).subscribe({
      next: (resp) => {
        this.editLoading = false;
        this.showEditModal = false;
        this.editingUser = null;
        this.mostrarPopup.emit({
          title: 'Usuario actualizado',
          message: resp.msg || 'Los datos del usuario se han actualizado correctamente.'
        });
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.editLoading = false;
        this.editError = err?.error?.msg || 'No se pudo actualizar el usuario.';
        this.cdr.detectChanges();
      }
    });
  }

  requestToggleState(user: AdminManagedUser): void {
    if (!this.canToggleState(user)) {
      return;
    }

    const nextActive = !this.isUserActive(user);
    this.confirmDialog = {
      title: nextActive ? 'Reactivar usuario' : 'Desactivar usuario',
      message: nextActive
        ? `Se reactivará la cuenta de ${user.name} ${user.surname}.`
        : `Se desactivará la cuenta de ${user.name} ${user.surname}. Si es artesano, sus productos quedarán ocultos.`,
      actionLabel: nextActive ? 'Reactivar' : 'Desactivar',
      kind: nextActive ? 'primary' : 'danger',
      onConfirm: () => this.executeToggleState(user, nextActive)
    };
  }

  private executeToggleState(user: AdminManagedUser, active: boolean): void {
    this.confirmLoading = true;
    this.adminUsersService.updateUser(user.uid, { active }).subscribe({
      next: (resp) => {
        this.confirmLoading = false;
        this.confirmDialog = null;
        this.mostrarPopup.emit({
          title: active ? 'Usuario reactivado' : 'Usuario desactivado',
          message: resp.msg || 'El estado del usuario se ha actualizado correctamente.'
        });
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.confirmLoading = false;
        this.confirmDialog = null;
        this.mostrarPopup.emit({
          title: 'Error',
          message: err?.error?.msg || 'No se pudo actualizar el estado del usuario.'
        });
        this.cdr.detectChanges();
      }
    });
  }

  requestDeleteUser(user: AdminManagedUser): void {
    if (!this.canDelete(user)) {
      return;
    }

    this.confirmDialog = {
      title: 'Eliminar usuario',
      message: user.role === 'artisan'
        ? `Se eliminará definitivamente a ${user.name} ${user.surname} y también sus productos asociados.`
        : `Se eliminará definitivamente a ${user.name} ${user.surname}.`,
      actionLabel: 'Eliminar',
      kind: 'danger',
      onConfirm: () => this.executeDeleteUser(user)
    };
  }

  private executeDeleteUser(user: AdminManagedUser): void {
    this.confirmLoading = true;
    this.adminUsersService.deleteUser(user.uid).subscribe({
      next: (resp) => {
        this.confirmLoading = false;
        this.confirmDialog = null;
        this.mostrarPopup.emit({
          title: 'Usuario eliminado',
          message: resp.msg || 'El usuario se ha eliminado correctamente.'
        });
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.confirmLoading = false;
        this.confirmDialog = null;
        this.mostrarPopup.emit({
          title: 'Error',
          message: err?.error?.msg || 'No se pudo eliminar el usuario.'
        });
        this.cdr.detectChanges();
      }
    });
  }

  closeConfirmDialog(): void {
    if (this.confirmLoading) {
      return;
    }
    this.confirmDialog = null;
  }

  confirmCurrentAction(): void {
    this.confirmDialog?.onConfirm();
  }
}
