from __future__ import annotations

from datetime import date, timedelta
from typing import List

from sqlalchemy import func, cast, Integer

from ..models import Dealer, Inventory, SKU, SalesHistory
from .forecasting import forecast_demand
from .rebalance import recommend_transfers


ALERT_STOCKOUT = "Stockout Risk"
ALERT_DEAD_STOCK = "Dead Stock Risk"


def generate_alerts(db, dealer_id: int | None = None) -> List[dict]:
    today = date.today()
    window_start = today - timedelta(days=60)

    dealers_query = db.query(Dealer)
    if dealer_id:
        dealers_query = dealers_query.filter(Dealer.id == dealer_id)
    dealers = dealers_query.all()

    skus = db.query(SKU).all()

    alerts = []
    transfer_cache = {}
    for dealer in dealers:
        for sku in skus:
            inventory = (
                db.query(Inventory)
                .filter(Inventory.dealer_id == dealer.id, Inventory.sku_id == sku.id)
                .one_or_none()
            )
            quantity = inventory.quantity if inventory else 0

            sales_window = (
                db.query(func.sum(SalesHistory.demand), func.sum(SalesHistory.fulfilled), func.count(SalesHistory.id))
                .filter(
                    SalesHistory.dealer_id == dealer.id,
                    SalesHistory.sku_id == sku.id,
                    SalesHistory.date >= window_start,
                    SalesHistory.date <= today,
                )
                .one()
            )

            total_demand = float(sales_window[0] or 0.0)
            total_fulfilled = float(sales_window[1] or 0.0)
            total_points = int(sales_window[2] or 0)

            stockout_days = (
                db.query(func.sum(cast(SalesHistory.stockout, Integer)))
                .filter(
                    SalesHistory.dealer_id == dealer.id,
                    SalesHistory.sku_id == sku.id,
                    SalesHistory.date >= window_start,
                    SalesHistory.date <= today,
                )
                .scalar()
            )
            stockout_days = int(stockout_days or 0)

            turnover_ratio = (total_fulfilled / quantity) if quantity else 0.0
            stockout_rate = (stockout_days / total_points) if total_points else 0.0

            forecast = forecast_demand(db, sku.id, dealer.region, horizon=14)
            region_daily = sum(point["forecast"] for point in forecast.points) / forecast.horizon
            region_daily = max(region_daily, 1.0)

            region_total = (
                db.query(func.sum(SalesHistory.demand))
                .join(Dealer, Dealer.id == SalesHistory.dealer_id)
                .filter(
                    Dealer.region == dealer.region,
                    SalesHistory.sku_id == sku.id,
                    SalesHistory.date >= window_start,
                )
                .scalar()
            )
            region_total = float(region_total or 0.0)
            share = (total_demand / region_total) if region_total else 1 / max(1, len(dealers))
            dealer_daily = max(region_daily * share, 1.0)

            days_cover = quantity / dealer_daily if dealer_daily else 0.0

            aging_percent = 0.0
            if inventory:
                age_days = (today - inventory.last_received_date).days
                aging_percent = 1.0 if age_days > 90 else (age_days / 90)

            metrics = {
                "days_of_cover": round(days_cover, 2),
                "turnover_ratio": round(turnover_ratio, 2),
                "stockout_rate": round(stockout_rate, 2),
                "aging_percent": round(aging_percent, 2),
            }

            confidence = max(0.55, min(0.9, 0.5 + total_points / 200))

            if days_cover < 7:
                cache_key = (sku.id, dealer.region)
                if cache_key not in transfer_cache:
                    transfer_cache[cache_key] = recommend_transfers(db, sku.id, dealer.region)
                transfers = transfer_cache[cache_key]
                transfer_option = next((t for t in transfers if t["to_dealer_id"] == dealer.id), None)
                action = "Transfer" if transfer_option else "Reorder"
                reasoning = (
                    f"Low cover ({days_cover:.1f} days) and stockout rate {stockout_rate:.2f}. "
                    f"Suggested action: {action}."
                )
                alerts.append(
                    {
                        "dealer_id": dealer.id,
                        "dealer_name": dealer.name,
                        "sku_id": sku.id,
                        "sku_name": sku.name,
                        "alert_type": ALERT_STOCKOUT,
                        "recommended_action": action,
                        "confidence": round(confidence, 2),
                        "reasoning": reasoning,
                        "metrics": metrics,
                    }
                )

            if aging_percent > 0.4 and turnover_ratio < 1:
                reasoning = (
                    f"High aging inventory ({aging_percent:.0%}) with low turnover ({turnover_ratio:.2f}). "
                    "Recommended action: Hold or promote through local campaigns."
                )
                alerts.append(
                    {
                        "dealer_id": dealer.id,
                        "dealer_name": dealer.name,
                        "sku_id": sku.id,
                        "sku_name": sku.name,
                        "alert_type": ALERT_DEAD_STOCK,
                        "recommended_action": "Hold",
                        "confidence": round(confidence - 0.05, 2),
                        "reasoning": reasoning,
                        "metrics": metrics,
                    }
                )

    return alerts
