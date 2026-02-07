# User Manual - Modern Colours Supply Chain Decision Intelligence Platform

## Use Case
Modern Colours Pvt. Ltd. operates a dealer-distributor network across Indian regions with strong seasonality. This platform helps operations teams forecast demand, spot stockout and dead-stock risks, rebalance inventory between dealers, and capture decision logs for accountability.

## Who Uses It
- Operations Head: monitors the network, approves rebalancing, and triggers replenishments.
- Regional Manager: tracks dealer health, forecasts, and regional demand shifts.
- Dealer Manager: watches local inventory, risk alerts, and transfer suggestions.

## Getting Started
1. Start the backend and seed data.
2. Start the frontend and open the dashboard.
3. Select a SKU, region, and dealer from the filters.
4. Review forecasts, health scores, and rebalancing recommendations.

## Demo Entries
The application ships with seeded synthetic data that includes:
- Dealer and SKU inventories with varied stock levels and ages.
- Forecast-ready sales history with seasonal patterns.
- Buyer-signal data (festival and construction spikes).
- Alerts and rebalancing recommendations generated from data.

If the API is empty in development, demo entries are shown automatically. You can control this behavior with `VITE_DEMO_MODE=1` or `VITE_DEMO_MODE=0`.

## Admin Dashboard Guide
- Network Pulse: quick totals for inventory, dealers, SKUs, and risks.
- Demand Forecast: SKU-region forecast with confidence band and explanation.
- What-if Scenario: simulate percent change and event-driven demand shocks.
- Dealer Health Map: health score, aging percent, and stockout rate by dealer.
- Rebalancing Recommendations: suggested dealer-to-dealer transfers and logistics cost.

## Dealer Dashboard Guide
- Dealer Inventory: SKU-level stock with aging visibility and low-stock highlights.
- Risk Alerts: severity-tagged actions with confidence and reasoning.
- Transfer Suggestions: prioritized transfer actions with distance and cost.
- Regional Inventory Mix: quick comparison of regional inventory distribution.

## Decision and Audit Log
Every recommendation and simulation call is logged. Use the audit endpoint to review the action trail:
- `GET /api/audit`

## Operational Workflow
1. Start with Network Pulse to understand current exposure.
2. Review forecast and what-if scenarios for upcoming demand pressure.
3. Check Dealer Health Map to identify risk clusters.
4. Approve transfer suggestions for immediate rebalancing.
5. Use alerts to trigger reorders or local promotions.
6. Export or review audit logs for compliance and review.

## Production Readiness Notes
- Replace SQLite with PostgreSQL for multi-user production.
- Set `VITE_API_URL` to your production backend.
- Disable demo mode in production using `VITE_DEMO_MODE=0`.
