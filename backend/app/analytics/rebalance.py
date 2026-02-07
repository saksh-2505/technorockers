from __future__ import annotations

from typing import List

from sqlalchemy import func

from ..models import Dealer, Inventory, SKU, SalesHistory
from ..utils.geo import haversine_km
from .forecasting import forecast_demand


COST_PER_KM = 2.5
TARGET_COVER_DAYS = 14
OVERSTOCK_COVER_DAYS = 35


def recommend_transfers(db, sku_id: int, region: str | None = None) -> List[dict]:
    sku = db.query(SKU).filter(SKU.id == sku_id).one_or_none()
    if not sku:
        return []

    dealers_query = db.query(Dealer)
    if region:
        dealers_query = dealers_query.filter(Dealer.region == region)

    dealers = dealers_query.all()
    if not dealers:
        return []

    regions = {dealer.region for dealer in dealers}
    region_forecasts = {}
    for reg in regions:
        forecast = forecast_demand(db, sku_id, reg, horizon=14)
        daily = sum(point["forecast"] for point in forecast.points) / forecast.horizon
        region_forecasts[reg] = max(daily, 1.0)

    dealer_demand = {}
    for dealer in dealers:
        total_demand = (
            db.query(func.sum(SalesHistory.demand))
            .filter(SalesHistory.dealer_id == dealer.id, SalesHistory.sku_id == sku_id)
            .scalar()
        )
        dealer_demand[dealer.id] = float(total_demand or 0.0)

    total_region_demand = {}
    for dealer in dealers:
        total_region_demand.setdefault(dealer.region, 0.0)
        total_region_demand[dealer.region] += dealer_demand[dealer.id]

    dealer_metrics = []
    for dealer in dealers:
        inventory = (
            db.query(Inventory)
            .filter(Inventory.dealer_id == dealer.id, Inventory.sku_id == sku_id)
            .one_or_none()
        )
        quantity = inventory.quantity if inventory else 0

        region_daily = region_forecasts.get(dealer.region, 1.0)
        region_total = total_region_demand.get(dealer.region, 0.0)
        share = dealer_demand[dealer.id] / region_total if region_total else 1 / len(dealers)
        dealer_daily = max(region_daily * share, 1.0)

        days_cover = quantity / dealer_daily if dealer_daily else 0.0
        dealer_metrics.append(
            {
                "dealer": dealer,
                "quantity": quantity,
                "daily": dealer_daily,
                "days_cover": days_cover,
            }
        )

    receivers = [m for m in dealer_metrics if m["days_cover"] < 7]
    donors = [m for m in dealer_metrics if m["days_cover"] > OVERSTOCK_COVER_DAYS]

    recommendations = []
    for receiver in receivers:
        need_qty = int(max(0, TARGET_COVER_DAYS * receiver["daily"] - receiver["quantity"]))
        if need_qty <= 0:
            continue

        for donor in donors:
            if donor["dealer"].id == receiver["dealer"].id:
                continue
            excess_qty = int(max(0, donor["quantity"] - OVERSTOCK_COVER_DAYS * donor["daily"]))
            if excess_qty <= 0:
                continue

            transfer_qty = min(need_qty, excess_qty)
            distance = haversine_km(
                donor["dealer"].latitude,
                donor["dealer"].longitude,
                receiver["dealer"].latitude,
                receiver["dealer"].longitude,
            )
            logistics_cost = distance * COST_PER_KM
            score = (receiver["days_cover"] + 1) / (logistics_cost + 1)

            explanation = (
                f"Receiver cover {receiver['days_cover']:.1f} days; donor cover {donor['days_cover']:.1f} days. "
                f"Distance {distance:.0f} km; estimated logistics cost ₹{logistics_cost:,.0f}."
            )

            recommendations.append(
                {
                    "from_dealer_id": donor["dealer"].id,
                    "from_dealer": donor["dealer"].name,
                    "to_dealer_id": receiver["dealer"].id,
                    "to_dealer": receiver["dealer"].name,
                    "sku_id": sku_id,
                    "sku_name": sku.name,
                    "quantity": transfer_qty,
                    "distance_km": round(distance, 1),
                    "logistics_cost": round(logistics_cost, 2),
                    "score": round(score, 3),
                    "explanation": explanation,
                }
            )

    recommendations.sort(key=lambda item: item["score"], reverse=True)
    return recommendations
