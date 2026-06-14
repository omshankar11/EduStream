# Deployment Guide

This project is configured for split deployment: **Backend on Render** and **Frontend on Netlify** (or Render).

## 🚀 Backend Deployment (Render)

The backend uses **Docker** to ensure Python is available for transcript generation.

1.  **Go to Render Dashboard**: [dashboard.render.com](https://dashboard.render.com/)
2.  **Create New Blueprint**:
    -   Click **New +** -> **Blueprint**.
    -   Connect your GitHub repository.
3.  **Apply**: Render will detect `render.yaml` and prompt for:
    -   `MONGO_URI`: Your MongoDB Atlas string.
    -   `SESSION_SECRET`: A random string for cookies.
    -   `GOOGLE_CLIENT_ID` / `SECRET`: For Google Auth.
    -   `GEMINI_API_KEY_SUMMARY` / `QUIZ`: For AI features.

---

## ⚡ Frontend Deployment (Netlify) - RECOMMENDED

Netlify is often faster for static React sites.

1.  **New Site from Git**: Connect your repo.
2.  **Settings**:
    -   **Base directory**: `frontend`
    -   **Build command**: `npm run build`
    -   **Publish directory**: `dist`
3.  **Environment Variables**:
    -   `VITE_API_URL`: Your Render backend URL (e.g., `https://EduStream-backend.onrender.com`).
4.  **Configuration**: The `netlify.toml` file in the root handles automatic redirects for React Router.

---

## 📦 Local Development (Docker)

To run the entire stack (including a local database) in one command:

```bash
docker-compose up
```

-   **Frontend**: http://localhost:5173
-   **Backend**: http://localhost:8000
-   **MongoDB**: http://localhost:27017

---

## Required Environment Variables

| Variable | Source | Description |
| :--- | :--- | :--- |
| `MONGO_URI` | MongoDB Atlas | Connection string for the database |
| `GOOGLE_CLIENT_ID` | Google Console | For OAuth authentication |
| `GEMINI_API_KEY_SUMMARY` | Google AI Studio | For AI-powered video summaries |
| `VITE_API_URL` | Render / Local | Backend URL for the frontend to call |

