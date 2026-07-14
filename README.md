# Noma: Artisanal Heritage Platform

## Project Overview

<img width="1920" height="1032" alt="noma-landing-page" src="https://github.com/user-attachments/assets/706c935c-c917-4b8e-863c-18032262bf54" />


Noma (Núcleo de Origen y Memoria Artesanal) is an interactive, educational Single Page Application (SPA) designed to preserve and promote artisanal and agro-food heritage. By bridging the digital gap for local artisans, Noma restores visibility to traditional crafts and connects creators directly with global audiences.

The platform serves as a digital showcase, providing artisans with the tools to present their work to the world while offering users an immersive experience to discover, learn about, and connect with unique cultural products.

## Key Features

*   **Immersive 3D Map**: A custom WebGL 3-axis interactive graphics engine serving as the main search tool with rotation, zoom, and dynamic regional product pins.
  
<img width="1920" height="1032" alt="noma-map" src="https://github.com/user-attachments/assets/45f14748-5db0-4f0c-ac2b-dad5d04eac76" />


*   **Multimedia Product Pages**: Detailed insights into heritage, traditional processing techniques, and an embedded Three.js & WebGL 3D model viewer.
  
<img width="1920" height="1032" alt="noma-product-page" src="https://github.com/user-attachments/assets/2d3dbe5b-01f0-44db-8f0e-0bdf44eee617" />


<img width="1920" height="1032" alt="noma-product-page-2" src="https://github.com/user-attachments/assets/4d26245d-e283-4277-869d-7b8eb5420b62" />


*   **Advanced Search & Filtering**: Users can easily find products using text search or by applying filters for categories, proximity, official certifications (e.g., D.O., I.G.P.), and personal favorites.

<img width="1920" height="1032" alt="noma-search-bar" src="https://github.com/user-attachments/assets/91399738-2263-408d-b2f6-25290ff214fd" />


*   **Smart Assistant**: An integrated Dialogflow chatbot offering personalized product recommendations and catalogue guidance.

<img width="1920" height="1032" alt="noma-chatbot" src="https://github.com/user-attachments/assets/5ed395a9-5f93-43de-9592-408823e232c6" />


*   **Artisan Dashboard**: A dedicated space for local creators to register, create detailed profiles, and manage their product listings, including uploading images and 3D models.

<img width="1920" height="1032" alt="noma-artisan-dashboard" src="https://github.com/user-attachments/assets/25ad0f98-e7df-45e1-b7e9-d5f6307e2e5a" />



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

## Authors

The **Syncro Team**:
* **Javier Castelló Ochoa** - [@jco28UA](https://github.com/jco28UA)
* **Claudia Garias Abalos** - [@cga112](https://github.com/cga112)
* **Nicolás Hidalgo Salinas** - [@n1co2611](https://github.com/n1co2611)
* **Fidel Mas Sáez** - [@fidelmas](https://github.com/fidelmas)
* **Jorge Román Gil** - [@jorgeromangil](https://github.com/jorgeromangil)

## Disclaimer

This is an academic project developed as the final year project for the Multimedia Engineering degree at the University of Alicante. It is intended for educational and demonstrative purposes.

## License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

While the software architecture and code are open-source under the MIT License, all visual assets, brand identity (**Noma**), historical texts, and database records remain the intellectual property of the **Syncro Team** as outlined in our [Legal Notice](https://noma-syncro.netlify.app/legal-notice).
