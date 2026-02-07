from __future__ import annotations

import argparse
import random
from datetime import date, timedelta

from sqlalchemy.orm import Session

from ..db import Base, engine, SessionLocal
from ..models import Dealer, SKU, Inventory, SalesHistory, BuyerSignal


REGION_FACTORS = {
    "North": 1.1,
    "South": 0.95,
    "East": 0.9,
    "West": 1.0,
    "Central": 1.0,
}


def seasonal_factor(day: date) -> float:
    if day.month in {10, 11}:
        return 1.3
    if day.month in {3, 4}:
        return 1.15
    if day.month in {6, 7, 8}:
        return 0.9
    return 1.0


def seed(reset: bool = False, days: int = 180) -> None:
    if reset:
        Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db: Session = SessionLocal()

    if db.query(Dealer).count() > 0 and not reset:
        db.close()
        return

    random.seed(42)

    dealers = [
        ("Modern Colours Delhi", "North", "Delhi", 28.61, 77.20),
        ("Modern Colours Jaipur", "North", "Jaipur", 26.91, 75.79),
        ("Modern Colours Chandigarh", "North", "Chandigarh", 30.74, 76.79),
        ("Modern Colours Mumbai", "West", "Mumbai", 19.07, 72.88),
        ("Modern Colours Pune", "West", "Pune", 18.52, 73.85),
        ("Modern Colours Ahmedabad", "West", "Ahmedabad", 23.02, 72.57),
        ("Modern Colours Bengaluru", "South", "Bengaluru", 12.97, 77.59),
        ("Modern Colours Chennai", "South", "Chennai", 13.08, 80.27),
        ("Modern Colours Kochi", "South", "Kochi", 9.93, 76.27),
        ("Modern Colours Kolkata", "East", "Kolkata", 22.57, 88.36),
        ("Modern Colours Guwahati", "East", "Guwahati", 26.14, 91.73),
        ("Modern Colours Lucknow", "Central", "Lucknow", 26.85, 80.95),
        ("Modern Colours Indore", "Central", "Indore", 22.72, 75.86),
    ]

    dealer_objs = [
        Dealer(name=name, region=region, city=city, latitude=lat, longitude=lon)
        for name, region, city, lat, lon in dealers
    ]
    db.add_all(dealer_objs)
    db.flush()

    skus = [
        ("Interior Emulsion 10L - Ivory", "Warm", 10, 950, 1350),
        ("Exterior Weatherproof 20L - White", "Neutral", 20, 1800, 2600),
        ("Premium Matte 5L - Sand", "Warm", 5, 600, 950),
        ("Silk Shine 10L - Pearl", "Cool", 10, 1150, 1650),
        ("Acrylic Distemper 20L - Cream", "Neutral", 20, 1400, 2100),
        ("Roof Coat 10L - Terracotta", "Earth", 10, 1000, 1500),
    ]

    sku_objs = [
        SKU(
            name=name,
            color_family=color_family,
            size_ltr=size_ltr,
            unit_cost=unit_cost,
            unit_price=unit_price,
        )
        for name, color_family, size_ltr, unit_cost, unit_price in skus
    ]
    db.add_all(sku_objs)
    db.flush()

    today = date.today()
    for dealer in dealer_objs:
        for sku in sku_objs:
            quantity = random.randint(40, 420)
            last_received_date = today - timedelta(days=random.randint(5, 120))

            if dealer.name == "Modern Colours Delhi" and sku.name == "Interior Emulsion 10L - Ivory":
                quantity = 6
                last_received_date = today - timedelta(days=12)
            elif (
                dealer.name == "Modern Colours Mumbai"
                and sku.name == "Interior Emulsion 10L - Ivory"
            ):
                quantity = 620
                last_received_date = today - timedelta(days=75)
            elif (
                dealer.name == "Modern Colours Chennai"
                and sku.name == "Exterior Weatherproof 20L - White"
            ):
                quantity = 3000
                last_received_date = today - timedelta(days=140)
            elif (
                dealer.name == "Modern Colours Bengaluru"
                and sku.name == "Premium Matte 5L - Sand"
            ):
                quantity = 8
                last_received_date = today - timedelta(days=18)
            db.add(
                Inventory(
                    dealer_id=dealer.id,
                    sku_id=sku.id,
                    quantity=quantity,
                    last_received_date=last_received_date,
                )
            )

    sku_base = {sku.id: random.randint(20, 55) for sku in sku_objs}

    for day_offset in range(days):
        day = today - timedelta(days=days - day_offset)
        for dealer in dealer_objs:
            region_factor = REGION_FACTORS.get(dealer.region, 1.0)
            season = seasonal_factor(day)
            for sku in sku_objs:
                base = sku_base[sku.id] * region_factor * season
                noise = random.gauss(0, 6)
                demand = max(5, base + noise)
                fulfil_ratio = random.uniform(0.78, 1.0)
                fulfilled = demand * fulfil_ratio
                stockout = fulfilled < demand * 0.92

                db.add(
                    SalesHistory(
                        dealer_id=dealer.id,
                        sku_id=sku.id,
                        date=day,
                        demand=round(demand, 2),
                        fulfilled=round(fulfilled, 2),
                        stockout=stockout,
                    )
                )

    for day_offset in range(60):
        day = today - timedelta(days=60 - day_offset)
        for region in REGION_FACTORS:
            season = seasonal_factor(day)
            for sku in sku_objs:
                base_interest = 50 + (season - 1) * 40 + random.gauss(0, 6)
                search_interest = max(10, min(95, base_interest))

                spike = 0.0
                event_tag = None
                if day.month == 11 and random.random() < 0.2:
                    spike = 0.4
                    event_tag = "Diwali"
                elif day.month == 3 and random.random() < 0.15:
                    spike = 0.3
                    event_tag = "Holi"
                elif random.random() < 0.05:
                    spike = 0.25
                    event_tag = "Construction Boom"

                db.add(
                    BuyerSignal(
                        region=region,
                        sku_id=sku.id,
                        date=day,
                        search_interest=round(search_interest, 2),
                        demand_spike=round(spike, 2),
                        event_tag=event_tag,
                    )
                )

    demo_signal_dates = [
        today - timedelta(days=5),
        today - timedelta(days=12),
        today - timedelta(days=20),
        today - timedelta(days=28),
    ]
    demo_tags = ["Diwali", "Holi", "Construction Boom", "Monsoon Impact"]
    for idx, sku in enumerate(sku_objs):
        tag = demo_tags[idx % len(demo_tags)]
        db.add(
            BuyerSignal(
                region="North",
                sku_id=sku.id,
                date=demo_signal_dates[idx % len(demo_signal_dates)],
                search_interest=78.0,
                demand_spike=0.35,
                event_tag=tag,
            )
        )

    db.commit()
    db.close()


def main():
    parser = argparse.ArgumentParser(description="Seed synthetic data for the supply chain platform")
    parser.add_argument("--reset", action="store_true", help="Drop existing tables before seeding")
    parser.add_argument("--days", type=int, default=180, help="Number of days of sales history")
    args = parser.parse_args()

    seed(reset=args.reset, days=args.days)
    print("Seed complete")


if __name__ == "__main__":
    main()
