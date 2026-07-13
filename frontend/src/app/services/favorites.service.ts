import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class FavoritesService {
  private favoritesChanged = new Subject<void>();
  public favoritesChanged$: Observable<void> = this.favoritesChanged.asObservable();

  notifyFavoritesChanged(): void {
    this.favoritesChanged.next();
  }
}
