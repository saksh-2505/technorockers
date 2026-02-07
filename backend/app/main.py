from __future__ import annotations

import json
import os
from datetime import date, timedelta
from typing import List

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func

from .db import Base, engine, get_db
from .models import Dealer, SKU, Inventory, SalesHistory, AuditLog
from .schemas import (
    Dealer as DealerSchema,
    DealerCreate,
    DealerUpdate,
    SKU as SKUSchema,
    SKUCreate,
    SKUUpdate,
    Inventory as InventorySchema,
    InventoryCreate,
    InventoryUpdate,
    ForecastResponse,
    ForecastPoint,
    DealerHealth,
    TransferRecommendation,
    AlertRecommendation,
    SummaryResponse,
    WhatIfRequest,
    AuditLogEntry,
)
from .analytics.forecasting import forecast_demand
from .analytics.health import compute_dealer_health
from .analytics.rebalance import recommend_transfers
from .analytics.alerts import generate_alerts
from .analytics.simulation import simulate_what_if
from .utils.seed import seed as seed_data


app = FastAPI(
    title="Self-Correcting Supply Chain Decision Intelligence Platform",
    description="Modern Colours Pvt. Ltd. decision intelligence system",
    version="1.0.0",
)

cors_origins = os.getenv("CORS_ORIGINS", "*")
allowed_origins = ["*"] if cors_origins.strip() == "*" else [
    origin.strip() for origin in cors_origins.split(",") if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    auto_seed = os.getenv("AUTO_SEED", "0")
    if auto_seed == "1":
        seed_data(reset=False, days=180)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


@app.get("/api/regions")
def list_regions(db: Session = Depends(get_db)):
    regions = db.query(Dealer.region).distinct().all()
    return [region[0] for region in regions]


@app.get("/api/dealers", response_model=List[DealerSchema])
def list_dealers(db: Session = Depends(get_db)):
    return db.query(Dealer).all()


@app.post("/api/dealers", response_model=DealerSchema)
def create_dealer(payload: DealerCreate, db: Session = Depends(get_db)):
    dealer = Dealer(**payload.dict())
    db.add(dealer)
    db.commit()
    db.refresh(dealer)
    return dealer


@app.put("/api/dealers/{dealer_id}", response_model=DealerSchema)
def update_dealer(dealer_id: int, payload: DealerUpdate, db: Session = Depends(get_db)):
    dealer = db.query(Dealer).filter(Dealer.id == dealer_id).one_or_none()
    if not dealer:
        raise HTTPException(status_code=404, detail="Dealer not found")
    for key, value in payload.dict(exclude_unset=True).items():
        setattr(dealer, key, value)
    db.commit()
    db.refresh(dealer)
    return dealer


@app.delete("/api/dealers/{dealer_id}")
def delete_dealer(dealer_id: int, db: Session = Depends(get_db)):
    dealer = db.query(Dealer).filter(Dealer.id == dealer_id).one_or_none()
    if not dealer:
        raise HTTPException(status_code=404, detail="Dealer not found")
    db.delete(dealer)
    db.commit()
    return {"ok": True}


@app.get("/api/skus", response_model=List[SKUSchema])
def list_skus(db: Session = Depends(get_db)):
    return db.query(SKU).all()


@app.post("/api/skus", response_model=SKUSchema)
def create_sku(payload: SKUCreate, db: Session = Depends(get_db)):
    sku = SKU(**payload.dict())
    db.add(sku)
    db.commit()
    db.refresh(sku)
    return sku


@app.put("/api/skus/{sku_id}", response_model=SKUSchema)
def update_sku(sku_id: int, payload: SKUUpdate, db: Session = Depends(get_db)):
    sku = db.query(SKU).filter(SKU.id == sku_id).one_or_none()
    if not sku:
        raise HTTPException(status_code=404, detail="SKU not found")
    for key, value in payload.dict(exclude_unset=True).items():
        setattr(sku, key, value)
    db.commit()
    db.refresh(sku)
    return sku


@app.delete("/api/skus/{sku_id}")
def delete_sku(sku_id: int, db: Session = Depends(get_db)):
    sku = db.query(SKU).filter(SKU.id == sku_id).one_or_none()
    if not sku:
        raise HTTPException(status_code=404, detail="SKU not found")
    db.delete(sku)
    db.commit()
    return {"ok": True}


@app.get("/api/inventory", response_model=List[InventorySchema])
def list_inventory(
    dealer_id: int | None = Query(None),
    sku_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Inventory)
    if dealer_id:
        query = query.filter(Inventory.dealer_id == dealer_id)
    if sku_id:
        query = query.filter(Inventory.sku_id == sku_id)
    return query.all()


@app.post("/api/inventory", response_model=InventorySchema)
def create_inventory(payload: InventoryCreate, db: Session = Depends(get_db)):
    dealer = db.query(Dealer).filter(Dealer.id == payload.dealer_id).one_or_none()
    if not dealer:
        raise HTTPException(status_code=404, detail="Dealer not found")
    sku = db.query(SKU).filter(SKU.id == payload.sku_id).one_or_none()
    if not sku:
        raise HTTPException(status_code=404, detail="SKU not found")
    existing = (
        db.query(Inventory)
        .filter(Inventory.dealer_id == payload.dealer_id, Inventory.sku_id == payload.sku_id)
        .one_or_none()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Inventory already exists for dealer and SKU")

    inventory = Inventory(**payload.dict())
    db.add(inventory)
    db.commit()
    db.refresh(inventory)
    return inventory


@app.put("/api/inventory/{inventory_id}", response_model=InventorySchema)
def update_inventory(inventory_id: int, payload: InventoryUpdate, db: Session = Depends(get_db)):
    inventory = db.query(Inventory).filter(Inventory.id == inventory_id).one_or_none()
    if not inventory:
        raise HTTPException(status_code=404, detail="Inventory not found")
    for key, value in payload.dict(exclude_unset=True).items():
        setattr(inventory, key, value)
    db.commit()
    db.refresh(inventory)
    return inventory


@app.delete("/api/inventory/{inventory_id}")
def delete_inventory(inventory_id: int, db: Session = Depends(get_db)):
    inventory = db.query(Inventory).filter(Inventory.id == inventory_id).one_or_none()
    if not inventory:
        raise HTTPException(status_code=404, detail="Inventory not found")
    db.delete(inventory)
    db.commit()
    return {"ok": True}


@app.get("/api/summary", response_model=SummaryResponse)
def summary(db: Session = Depends(get_db)):
    total_inventory = db.query(func.sum(Inventory.quantity)).scalar() or 0
    total_skus = db.query(func.count(SKU.id)).scalar() or 0
    total_dealers = db.query(func.count(Dealer.id)).scalar() or 0

    alerts = generate_alerts(db)
    stockout_risk = sum(1 for alert in alerts if alert["alert_type"] == "Stockout Risk")
    dead_stock = sum(1 for alert in alerts if alert["alert_type"] == "Dead Stock Risk")

    return SummaryResponse(
        total_inventory_units=int(total_inventory),
        total_skus=int(total_skus),
        total_dealers=int(total_dealers),
        stockout_risk_count=stockout_risk,
        dead_stock_risk_count=dead_stock,
    )


@app.get("/api/metrics/inventory")
def inventory_metrics(dealer_id: int | None = Query(None), db: Session = Depends(get_db)):
    today = date.today()
    window_start = today - timedelta(days=30)

    query = db.query(Inventory)
    if dealer_id:
        query = query.filter(Inventory.dealer_id == dealer_id)
    inventories = query.all()

    total_qty = sum(item.quantity for item in inventories)
    aging_qty = sum(
        item.quantity for item in inventories if (today - item.last_received_date).days > 60
    )

    sales_query = db.query(func.sum(SalesHistory.fulfilled), func.sum(SalesHistory.demand))
    if dealer_id:
        sales_query = sales_query.filter(SalesHistory.dealer_id == dealer_id)
    sales_query = sales_query.filter(SalesHistory.date >= window_start)
    total_fulfilled, total_demand = sales_query.one()

    total_fulfilled = float(total_fulfilled or 0.0)
    total_demand = float(total_demand or 0.0)

    turnover_ratio = (total_fulfilled / total_qty) if total_qty else 0.0
    fill_rate = (total_fulfilled / total_demand) if total_demand else 1.0

    return {
        "total_inventory_units": total_qty,
        "aging_percent": round((aging_qty / total_qty), 2) if total_qty else 0.0,
        "turnover_ratio": round(turnover_ratio, 2),
        "fill_rate": round(fill_rate, 2),
    }


@app.get("/api/health/dealers", response_model=List[DealerHealth])
def dealer_health(db: Session = Depends(get_db)):
    return compute_dealer_health(db)


@app.get("/api/forecast", response_model=ForecastResponse)
def forecast(
    sku_id: int = Query(...),
    region: str = Query(...),
    horizon: int = Query(30, ge=7, le=120),
    db: Session = Depends(get_db),
):
    result = forecast_demand(db, sku_id, region, horizon=horizon)
    return ForecastResponse(
        sku_id=sku_id,
        region=region,
        model=result.model_name,
        horizon=result.horizon,
        confidence=result.confidence,
        explanation=result.explanation,
        signal_adjustment=result.signal_adjustment,
        points=[ForecastPoint(**point) for point in result.points],
    )


@app.get("/api/rebalance", response_model=List[TransferRecommendation])
def rebalance(
    sku_id: int = Query(...),
    region: str | None = Query(None),
    db: Session = Depends(get_db),
):
    recommendations = recommend_transfers(db, sku_id, region)
    _log_audit(db, "rebalance", sku_id, "generate", {"region": region, "count": len(recommendations)})
    return recommendations


@app.get("/api/alerts", response_model=List[AlertRecommendation])
def alerts(dealer_id: int | None = Query(None), db: Session = Depends(get_db)):
    items = generate_alerts(db, dealer_id)
    _log_audit(db, "alerts", dealer_id or 0, "generate", {"count": len(items)})
    return items


@app.post("/api/simulate/whatif", response_model=ForecastResponse)
def simulate(payload: WhatIfRequest, db: Session = Depends(get_db)):
    result = simulate_what_if(
        db,
        sku_id=payload.sku_id,
        region=payload.region,
        horizon=payload.horizon,
        percent_change=payload.percent_change,
        event_tag=payload.event_tag,
    )
    _log_audit(db, "whatif", payload.sku_id, "simulate", result)
    return ForecastResponse(
        sku_id=result["sku_id"],
        region=result["region"],
        model=result["model"],
        horizon=result["horizon"],
        confidence=result["confidence"],
        explanation=result["explanation"],
        signal_adjustment=result["signal_adjustment"],
        points=[ForecastPoint(**point) for point in result["points"]],
    )


@app.get("/api/audit", response_model=List[AuditLogEntry])
def audit_log(db: Session = Depends(get_db)):
    logs = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(200).all()
    return logs


def _log_audit(db: Session, entity_type: str, entity_id: int, action: str, payload: dict):
    log = AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        payload=json.dumps(payload, default=str),
    )
    db.add(log)
    db.commit()
