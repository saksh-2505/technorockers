from __future__ import annotations

from datetime import date, datetime
from typing import Optional, List

from pydantic import BaseModel, conint, confloat, constr, validator


class DealerBase(BaseModel):
    name: constr(strip_whitespace=True, min_length=1, max_length=120)
    region: constr(strip_whitespace=True, min_length=1, max_length=80)
    city: constr(strip_whitespace=True, min_length=1, max_length=80)
    latitude: confloat(ge=-90, le=90)
    longitude: confloat(ge=-180, le=180)


class DealerCreate(DealerBase):
    pass


class DealerUpdate(BaseModel):
    name: Optional[constr(strip_whitespace=True, min_length=1, max_length=120)] = None
    region: Optional[constr(strip_whitespace=True, min_length=1, max_length=80)] = None
    city: Optional[constr(strip_whitespace=True, min_length=1, max_length=80)] = None
    latitude: Optional[confloat(ge=-90, le=90)] = None
    longitude: Optional[confloat(ge=-180, le=180)] = None


class Dealer(DealerBase):
    id: int

    class Config:
        from_attributes = True


class SKUBase(BaseModel):
    name: constr(strip_whitespace=True, min_length=1, max_length=160)
    color_family: constr(strip_whitespace=True, min_length=1, max_length=40)
    size_ltr: confloat(gt=0)
    unit_cost: confloat(ge=0)
    unit_price: confloat(ge=0)


class SKUCreate(SKUBase):
    pass


class SKUUpdate(BaseModel):
    name: Optional[constr(strip_whitespace=True, min_length=1, max_length=160)] = None
    color_family: Optional[constr(strip_whitespace=True, min_length=1, max_length=40)] = None
    size_ltr: Optional[confloat(gt=0)] = None
    unit_cost: Optional[confloat(ge=0)] = None
    unit_price: Optional[confloat(ge=0)] = None


class SKU(SKUBase):
    id: int

    class Config:
        from_attributes = True


class InventoryBase(BaseModel):
    dealer_id: conint(gt=0)
    sku_id: conint(gt=0)
    quantity: conint(ge=0)
    last_received_date: date

    @validator("last_received_date")
    def _received_not_future(cls, value: date):
        if value > date.today():
            raise ValueError("last_received_date cannot be in the future")
        return value


class InventoryCreate(InventoryBase):
    pass


class InventoryUpdate(BaseModel):
    quantity: Optional[conint(ge=0)] = None
    last_received_date: Optional[date] = None

    @validator("last_received_date")
    def _received_not_future(cls, value: Optional[date]):
        if value and value > date.today():
            raise ValueError("last_received_date cannot be in the future")
        return value


class Inventory(InventoryBase):
    id: int
    last_updated: Optional[datetime] = None

    class Config:
        from_attributes = True


class ForecastPoint(BaseModel):
    date: date
    forecast: float
    lower: float
    upper: float


class ForecastResponse(BaseModel):
    sku_id: int
    region: str
    model: str
    horizon: int
    confidence: float
    explanation: str
    signal_adjustment: float
    points: List[ForecastPoint]


class DealerHealth(BaseModel):
    dealer_id: int
    dealer_name: str
    region: str
    health_score: float
    category: str
    turnover_ratio: float
    aging_percent: float
    stockout_rate: float


class TransferRecommendation(BaseModel):
    from_dealer_id: int
    from_dealer: str
    to_dealer_id: int
    to_dealer: str
    sku_id: int
    sku_name: str
    quantity: int
    distance_km: float
    logistics_cost: float
    score: float
    explanation: str


class AlertRecommendation(BaseModel):
    dealer_id: int
    dealer_name: str
    sku_id: int
    sku_name: str
    alert_type: str
    recommended_action: str
    confidence: float
    reasoning: str
    metrics: dict


class SummaryResponse(BaseModel):
    total_inventory_units: int
    total_skus: int
    total_dealers: int
    stockout_risk_count: int
    dead_stock_risk_count: int


class WhatIfRequest(BaseModel):
    sku_id: conint(gt=0)
    region: constr(strip_whitespace=True, min_length=1, max_length=80)
    horizon: conint(ge=7, le=120) = 30
    percent_change: float = 0.0
    event_tag: Optional[str] = None


class AuditLogEntry(BaseModel):
    id: int
    created_at: datetime
    entity_type: str
    entity_id: Optional[int]
    action: str
    payload: str

    class Config:
        from_attributes = True
