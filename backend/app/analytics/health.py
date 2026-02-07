from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, cast, Integer

from ..models import Dealer, Inventory, SalesHistory


def compute_dealer_health(db):
    today = date.today()
    window_start = today - timedelta(days=60)

    dealers = db.query(Dealer).all()
    results = []

    for dealer in dealers:
        inventories = db.query(Inventory).filter(Inventory.dealer_id == dealer.id).all()
        total_inventory = sum(item.quantity for item in inventories)

        aging_qty = 0
        for item in inventories:
            age_days = (today - item.last_received_date).days
            if age_days >= 60:
                aging_qty += item.quantity
        aging_percent = (aging_qty / total_inventory) if total_inventory else 0.0

        sales = (
            db.query(
                func.sum(SalesHistory.fulfilled),
                func.count(SalesHistory.id),
                func.sum(cast(SalesHistory.stockout, Integer)),
            )
            .filter(
                SalesHistory.dealer_id == dealer.id,
                SalesHistory.date >= window_start,
                SalesHistory.date <= today,
            )
            .one()
        )
        total_fulfilled = float(sales[0] or 0.0)
        total_days = int(sales[1] or 0)
        stockout_days = int(sales[2] or 0)

        turnover_ratio = (total_fulfilled / total_inventory) if total_inventory else 0.0
        stockout_rate = (stockout_days / total_days) if total_days else 0.0

        turnover_score = min(turnover_ratio / 2.0, 1.0)
        aging_score = 1 - min(aging_percent, 1.0)
        stockout_score = 1 - min(stockout_rate, 1.0)

        health_score = 100 * (0.4 * turnover_score + 0.3 * aging_score + 0.3 * stockout_score)
        if health_score >= 70:
            category = "Healthy"
        elif health_score >= 40:
            category = "At Risk"
        else:
            category = "Critical"

        results.append(
            {
                "dealer_id": dealer.id,
                "dealer_name": dealer.name,
                "region": dealer.region,
                "health_score": round(health_score, 2),
                "category": category,
                "turnover_ratio": round(turnover_ratio, 2),
                "aging_percent": round(aging_percent, 2),
                "stockout_rate": round(stockout_rate, 2),
            }
        )

    return results
