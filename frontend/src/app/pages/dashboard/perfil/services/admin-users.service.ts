import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, Subject, finalize, map, of, shareReplay, tap } from 'rxjs';
import { buildApiUrl } from '../../../../shared/api-base';
import { AuthService } from '../../../../layouts/auth-layout/auth.service';

export interface AdminManagedUser {
  uid: string;
  name: string;
  surname: string;
  email: string;
  role: 'regular' | 'artisan' | 'admin';
  active?: boolean;
  company_name?: string;
  description?: string;
  address_text?: string;
  contact?: string;
  province?: string;
  artisanStatus?: string;
  image?: string;
  slug?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminUsersResponse {
  ok: boolean;
  msg?: string;
  users: AdminManagedUser[];
  page?: {
    from: number;
    recordsPerPage: number;
    total: number;
  };
}

export interface AdminUserMutationResponse {
  ok: boolean;
  msg: string;
  user?: AdminManagedUser;
}

export interface AdminUserPayload {
  name: string;
  surname: string;
  email: string;
  password?: string;
  role: 'regular' | 'artisan';
  company_name?: string;
  description?: string;
  address_text?: string;
  contact?: string;
  province?: string;
  active?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AdminUsersService {
  private readonly usersChangedSubject = new Subject<void>();
  readonly usersChanged$ = this.usersChangedSubject.asObservable();
  private cachedUsers: AdminManagedUser[] | null = null;
  private inflightUsersRequest$?: Observable<AdminManagedUser[]>;

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  private buildHeaders(): HttpHeaders {
    return new HttpHeaders().set('x-token', this.authService.getToken() || '');
  }

  notifyUsersChanged(forceRefresh = false): void {
    if (forceRefresh) {
      this.cachedUsers = null;
    }
    this.usersChangedSubject.next();
  }

  getUsers(options: { forceRefresh?: boolean } = {}): Observable<AdminManagedUser[]> {
    if (!options.forceRefresh && this.cachedUsers) {
      return of([...this.cachedUsers]);
    }

    if (!options.forceRefresh && this.inflightUsersRequest$) {
      return this.inflightUsersRequest$;
    }

    const request$ = this.http.get<AdminUsersResponse>(buildApiUrl('users'), {
      headers: this.buildHeaders(),
      params: new HttpParams().set('all', 'true')
    }).pipe(
      map((resp) => (Array.isArray(resp.users) ? resp.users : [])),
      tap((users) => {
        this.cachedUsers = [...users];
      }),
      map((users) => [...users]),
      finalize(() => {
        this.inflightUsersRequest$ = undefined;
      }),
      shareReplay(1)
    );

    this.inflightUsersRequest$ = request$;
    return request$;
  }

  createUser(payload: AdminUserPayload): Observable<AdminUserMutationResponse> {
    return this.http.post<AdminUserMutationResponse>(buildApiUrl('users'), payload, {
      headers: this.buildHeaders()
    }).pipe(
      tap((resp) => {
        if (resp.user && this.cachedUsers) {
          this.cachedUsers = [resp.user, ...this.cachedUsers.filter((user) => user.uid !== resp.user?.uid)];
        }
        this.usersChangedSubject.next();
      })
    );
  }

  updateUser(userId: string, payload: Partial<AdminUserPayload>): Observable<AdminUserMutationResponse> {
    return this.http.put<AdminUserMutationResponse>(buildApiUrl(`users/${userId}`), payload, {
      headers: this.buildHeaders()
    }).pipe(
      tap((resp) => {
        if (resp.user && this.cachedUsers) {
          this.cachedUsers = this.cachedUsers.map((user) => (user.uid === userId ? resp.user! : user));
        }
        this.usersChangedSubject.next();
      })
    );
  }

  deleteUser(userId: string): Observable<AdminUserMutationResponse> {
    return this.http.delete<AdminUserMutationResponse>(buildApiUrl(`users/${userId}`), {
      headers: this.buildHeaders()
    }).pipe(
      tap(() => {
        if (this.cachedUsers) {
          this.cachedUsers = this.cachedUsers.filter((user) => user.uid !== userId);
        }
        this.usersChangedSubject.next();
      })
    );
  }
}
