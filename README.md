# Modern Colours Supply Chain Decision Intelligence Platform

A full-stack, explainable decision intelligence system for Modern Colours Pvt. Ltd. It forecasts SKU demand by region, scores dealer health, recommends inventory rebalancing, and emits rule-based alerts with human-readable reasoning.

## Features
- Dealer and SKU inventory tracking with CRUD APIs
- Explainable time-series forecasting (moving average, exponential smoothing, linear regression)
- Buyer-signal simulation for leading indicators
- Dealer health scoring and categorization
- Inventory rebalancing recommendations with distance-based logistics cost
- Rule-based alerts with reasoning, metrics, and confidence
- What-if analysis and event-based demand shocks
- Decision audit log

## Architecture
- Backend: FastAPI + SQLAlchemy
- ML/Analytics: Pandas, NumPy, scikit-learn
- Database: SQLite by default (PostgreSQL supported)
- Frontend: React + Chart.js (via react-chartjs-2)

## Setup

### 1. Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m app.utils.seed --reset
uvicorn app.main:app --reload
```

Optional: auto-seed on startup
```bash
AUTO_SEED=1 uvicorn app.main:app --reload
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

The frontend expects the API at `http://localhost:8000`. Override with `VITE_API_URL`.

## User Manual
See `USER_MANUAL.md` for a role-based walkthrough, demo use case, and operational guidance.

## Demo Mode
In development, the UI can fall back to demo entries when the API has no data. Control this with:
- `VITE_DEMO_MODE=1` to force demo mode
- `VITE_DEMO_MODE=0` to disable demo mode

## API Docs
FastAPI interactive docs are available at:
- `http://localhost:8000/docs`

## Key Endpoints
- `GET /api/dealers`, `POST /api/dealers`, `PUT /api/dealers/{id}`, `DELETE /api/dealers/{id}`
- `GET /api/skus`, `POST /api/skus`, `PUT /api/skus/{id}`, `DELETE /api/skus/{id}`
- `GET /api/inventory` (filters: `dealer_id`, `sku_id`)
- `GET /api/summary`
- `GET /api/health/dealers`
- `GET /api/forecast?sku_id=1&region=West&horizon=30`
- `GET /api/rebalance?sku_id=1&region=West`
- `GET /api/alerts?dealer_id=1`
- `POST /api/simulate/whatif`
- `GET /api/audit`

## Notes
- SQLite database file is created as `backend/app.db`.
- Switch to PostgreSQL by setting `DATABASE_URL` (e.g., `postgresql+psycopg2://...`).
- Forecasts include confidence bands and explainable text rationale.

## Project Structure
```
backend/
  app/
    analytics/
    utils/
    main.py
frontend/
  src/
    App.jsx
    styles/
README.md
```
