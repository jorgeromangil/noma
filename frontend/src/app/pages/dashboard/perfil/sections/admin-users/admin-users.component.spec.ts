import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, Subject } from 'rxjs';
import { AdminUsersComponent } from './admin-users.component';
import { AdminUsersService } from '../../services/admin-users.service';
import { AuthService } from '../../../../../layouts/auth-layout/auth.service';

describe('AdminUsersComponent', () => {
  let component: AdminUsersComponent;
  let fixture: ComponentFixture<AdminUsersComponent>;
  let adminUsersServiceSpy: jasmine.SpyObj<AdminUsersService>;

  beforeEach(async () => {
    const usersChanged$ = new Subject<void>();
    adminUsersServiceSpy = jasmine.createSpyObj<AdminUsersService>(
      'AdminUsersService',
      ['getUsers', 'createUser', 'updateUser', 'deleteUser', 'notifyUsersChanged'],
      { usersChanged$: usersChanged$.asObservable() }
    );

    adminUsersServiceSpy.getUsers.and.returnValue(of([
      {
        uid: 'user-1',
        name: 'Lucia',
        surname: 'Lopez',
        email: 'lucia@noma.test',
        role: 'regular',
        active: false,
        createdAt: '2026-02-01T10:00:00.000Z'
      },
      {
        uid: 'artisan-3',
        name: 'Mario',
        surname: 'Moya',
        email: 'mario@noma.test',
        role: 'artisan',
        company_name: 'Taller Moya',
        active: true,
        createdAt: '2026-03-01T10:00:00.000Z'
      },
      {
        uid: 'admin-2',
        name: 'Admin',
        surname: 'Root',
        email: 'admin@noma.test',
        role: 'admin',
        active: true,
        createdAt: '2026-03-15T10:00:00.000Z'
      }
    ]));
    adminUsersServiceSpy.updateUser.and.returnValue(of({
      ok: true,
      msg: 'Usuario actualizado'
    }));
    adminUsersServiceSpy.createUser.and.returnValue(of({
      ok: true,
      msg: 'Usuario creado'
    }));
    adminUsersServiceSpy.deleteUser.and.returnValue(of({
      ok: true,
      msg: 'Usuario eliminado'
    }));

    await TestBed.configureTestingModule({
      imports: [AdminUsersComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AdminUsersService, useValue: adminUsersServiceSpy },
        {
          provide: AuthService,
          useValue: {
            get uid() {
              return 'admin-1';
            }
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AdminUsersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads users with active status by default', () => {
    expect(adminUsersServiceSpy.getUsers).toHaveBeenCalledTimes(1);
    expect(component.overallUserCount).toBe(3);
    expect(component.totalUsers).toBe(2);
    expect(component.users.every((user) => user.active !== false)).toBeTrue();
    expect(component.users.map((user) => user.uid)).toEqual(['admin-2', 'artisan-3']);
  });

  it('filters in memory without requesting users again', () => {
    component.searchQuery = 'mario';
    component.selectedRole = 'artisan';

    component.applyFilters();

    expect(adminUsersServiceSpy.getUsers).toHaveBeenCalledTimes(1);
    expect(component.totalUsers).toBe(1);
    expect(component.users[0].uid).toBe('artisan-3');
  });

  it('exposes destructive actions only for inactive non-admin users', () => {
    const regularInactiveUser = component.allUsers.find((user) => user.uid === 'user-1')!;
    const adminUser = component.allUsers.find((user) => user.uid === 'admin-2')!;

    expect(component.canDelete(regularInactiveUser)).toBeTrue();
    expect(component.canEdit(adminUser)).toBeFalse();
    expect(component.canToggleState(adminUser)).toBeFalse();
  });

  it('sorts users by role priority in memory', () => {
    component.selectedStatus = 'all';
    component.selectedSort = 'role';

    component.applyFilters();

    expect(component.users.map((user) => user.uid)).toEqual(['admin-2', 'artisan-3', 'user-1']);
    expect(adminUsersServiceSpy.getUsers).toHaveBeenCalledTimes(1);
  });

  it('renders all filtered users as list rows without pagination', () => {
    const host: HTMLElement = fixture.nativeElement;
    component.allUsers = Array.from({ length: 20 }, (_, index) => ({
      uid: `user-${index.toString().padStart(2, '0')}`,
      name: `User ${index.toString().padStart(2, '0')}`,
      surname: 'Test',
      email: `user${index}@noma.test`,
      role: 'regular' as const,
      active: true,
      createdAt: `2026-01-${(index + 1).toString().padStart(2, '0')}T10:00:00.000Z`
    }));
    component.selectedSort = 'alphabetical';
    component.applyFilters();

    fixture.detectChanges();

    expect(component.totalUsers).toBe(20);
    expect(component.users.length).toBe(20);
    expect(component.users[0].uid).toBe('user-00');
    expect(host.querySelector('.admin-users-list')).not.toBeNull();
    expect(host.querySelectorAll('.admin-user-row').length).toBe(20);
    expect(host.querySelector('.pagination-container')).toBeNull();
  });

  it('updates only the active flag when toggling user state', () => {
    const artisanUser = component.allUsers.find((user) => user.uid === 'artisan-3')!;

    component.requestToggleState(artisanUser);
    component.confirmCurrentAction();

    expect(adminUsersServiceSpy.updateUser).toHaveBeenCalledWith('artisan-3', { active: false });
    expect(component.confirmDialog).toBeNull();
  });

  it('opens the create-user modal from the users section and closes it after creation', () => {
    component.openCreateModal();
    expect(component.showCreateModal).toBeTrue();

    component.onUserCreated();

    expect(component.showCreateModal).toBeFalse();
  });
});
