import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router'; 
import { Navbar } from '../../commons/navbar/navbar'; 

@Component({
  selector: 'app-admin-layout', 
  standalone: true, 
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.css',
  imports: [RouterOutlet, Navbar] 
})
export class AdminLayout { }