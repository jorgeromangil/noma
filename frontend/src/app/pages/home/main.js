import { MotorGraficoFacade } from './src/MotorGraficoFacade.js';

const locations = [
    {name: "TEST CERO", lat: 0, lon: 0},
    {name: "Madrid", lat: 40.4168, lon: -3.7038},
    {name: "Punta de Gibraltar", lat: 36.12369998230646, lon:  -5.349900202980974},
    {name: "Sevilla", lat: 37.3891, lon: -5.9845},
    {name: "Salamanca", lat: 40.9701, lon: -5.6635},
    {name: "Badajoz", lat: 38.8794, lon: -6.9706},
    {name: "Cáceres", lat: 39.4763, lon: -6.3724},
    {name: "Valencia", lat: 39.4699, lon: -0.3763},
    {name: "Zamora", lat: 41.5033, lon: -5.7446},
    {name: "Huesca", lat: 42.1401, lon: -0.4089},
    {name: "San Juan", lat: 38.4015, lon: -0.4334},
    {name: "Palma de Mallorca", lat: 39.5696, lon: 2.6502},
    {name: "Gijón", lat: 43.5453, lon: -5.6619},
    {name: "A Coruña", lat: 43.3623, lon: -8.4115},
    {name: "Barcelona", lat: 41.3851, lon: 2.1734},
    {name: "Cádiz", lat: 36.5271, lon: -6.2886},
    {name: "Almería", lat: 36.8340, lon: -2.4637},
    {name: "Calpe", lat: 38.6420, lon: 0.0450},
    {name: "San Sebastián", lat: 43.3183, lon: -1.9812},
    {name: "Málaga", lat: 36.7213, lon: -4.4214},
    {name: "Gran Canaria", lat: 28.1235, lon: -15.4363}    
];

// Instanciamos la fachada
const motor = new MotorGraficoFacade('body', locations);

// Arrancamos
motor.init();