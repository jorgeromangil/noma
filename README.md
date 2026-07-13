# Noma: Artisanal Heritage Platform

!Noma Project
!Frontend-Angular
!Backend-Node.js
!Database-MongoDB

## Project Overview

Noma (Núcleo de Origen y Memoria Artesanal) is an interactive, educational Single Page Application (SPA) designed to preserve and promote artisanal and agro-food heritage. By bridging the digital gap for local artisans, Noma restores visibility to traditional crafts and connects creators directly with global audiences.

The platform serves as a digital showcase, providing artisans with the tools to present their work to the world while offering users an immersive experience to discover, learn about, and connect with unique cultural products.

## Key Features

*   **Immersive 3D Map**: A custom WebGL 3-axis interactive graphics engine serving as the main search tool with rotation, zoom, and dynamic regional product pins.
*   **Multimedia Product Pages**: Detailed insights into heritage, traditional processing techniques, and an embedded Three.js & WebGL 3D model viewer.
*   **Advanced Search & Filtering**: Users can easily find products using text search or by applying filters for categories, proximity, official certifications (e.g., D.O., I.G.P.), and personal favorites.
*   **Smart Assistant**: An integrated Dialogflow chatbot offering personalized product recommendations and catalogue guidance.
*   **Artisan Dashboard**: A dedicated space for local creators to register, create detailed profiles, and manage their product listings, including uploading images and 3D models.
*   **Open Data Portal**: In the spirit of open knowledge, Noma provides a "Datos Abiertos" section where product datasets can be downloaded in `JSON` and `CSV` formats.

## Tech Stack

*   **Frontend**:
    *   **Framework**: **Angular** (SPA)
    *   **Language**: **TypeScript**
    *   **State Management**: **RxJS** for handling asynchronous data streams and state.

*   **Backend**:
    *   **Framework**: **Node.js** & **Express.js**
    *   **API**: RESTful API for product, user, and authentication management.

*   **Database**:
    *   **Type**: **MongoDB** (NoSQL) for flexible and scalable data storage.

*   **Graphics & 3D**:
    *   **WebGL** (Custom 3D Map Engine)
    *   **Three.js** (Product Model Viewer)

*   **NLP / Chatbot**:
    *   **Google Dialogflow** (NLU)

*   **External Services**:
    *   **Geolocation**: **Nominatim (OpenStreetMap)** for reverse geocoding functionality.

## Project Structure

The repository is organized into two main parts:

*   `frontend/`: Contains the complete Angular client-side application.
    *   `src/app/pages/home/`: The main interactive map component and its 3D engine logic.
    *   `src/app/pages/dashboard/`: Includes artisan-specific features like product management.
    *   `src/app/services/`: Houses the application's core services for API communication, caching, and state management.
*   `backend/`: Contains the Node.js and Express.js server application.
    *   `controllers/`: Handles the business logic for API endpoints.
    *   `models/`: Defines the MongoDB data schemas.
    *   `routes/`: Manages the API routing structure.

## Getting Started

### Prerequisites

*   Node.js and npm
*   MongoDB instance (local or cloud)
*   Angular CLI

### Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/jorgeromangil/noma.git
    cd noma
    ```

2.  **Backend Setup:**
    ```bash
    cd backend
    npm install
    # Create a .env file with your database connection string and other variables
    # Example: MONGODB_CNN=mongodb://...
    npm start
    ```

3.  **Frontend Setup:**
    ```bash
    cd ../frontend
    npm install
    # Ensure the API base URL in src/app/shared/api-base.ts points to your backend
    ng serve
    ```

The application will be available at `http://localhost:4200`.

## Disclaimer

This is an academic project developed as the final year project for the Multimedia Engineering degree at the University of Alicante. It is intended for educational and demonstrative purposes.

## License

This project is licensed under the GNU General Public License v3.0 (GPLv3). This is a "copyleft" license, which means that any derivative work you distribute must also be licensed under the GPLv3, ensuring the software and its modifications remain free and open-source for all users.

See the `LICENSE` file for more details.
