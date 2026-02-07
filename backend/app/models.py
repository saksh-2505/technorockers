from __future__ import annotations

from sqlalchemy import Column, Integer, String, Float, Date, DateTime, ForeignKey, Boolean, Text, func
from sqlalchemy.orm import relationship

from .db import Base


class Dealer(Base):
    __tablename__ = "dealers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    region = Column(String, nullable=False, index=True)
    city = Column(String, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)

    inventories = relationship("Inventory", back_populates="dealer", cascade="all, delete-orphan")
    sales = relationship("SalesHistory", back_populates="dealer", cascade="all, delete-orphan")


class SKU(Base):
    __tablename__ = "skus"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    color_family = Column(String, nullable=False)
    size_ltr = Column(Float, nullable=False)
    unit_cost = Column(Float, nullable=False)
    unit_price = Column(Float, nullable=False)

    inventories = relationship("Inventory", back_populates="sku", cascade="all, delete-orphan")
    sales = relationship("SalesHistory", back_populates="sku", cascade="all, delete-orphan")


class Inventory(Base):
    __tablename__ = "inventories"

    id = Column(Integer, primary_key=True, index=True)
    dealer_id = Column(Integer, ForeignKey("dealers.id"), nullable=False)
    sku_id = Column(Integer, ForeignKey("skus.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    last_received_date = Column(Date, nullable=False)
    last_updated = Column(DateTime, server_default=func.now(), onupdate=func.now())

    dealer = relationship("Dealer", back_populates="inventories")
    sku = relationship("SKU", back_populates="inventories")


class SalesHistory(Base):
    __tablename__ = "sales_history"

    id = Column(Integer, primary_key=True, index=True)
    dealer_id = Column(Integer, ForeignKey("dealers.id"), nullable=False)
    sku_id = Column(Integer, ForeignKey("skus.id"), nullable=False)
    date = Column(Date, nullable=False, index=True)
    demand = Column(Float, nullable=False)
    fulfilled = Column(Float, nullable=False)
    stockout = Column(Boolean, nullable=False, default=False)

    dealer = relationship("Dealer", back_populates="sales")
    sku = relationship("SKU", back_populates="sales")


class BuyerSignal(Base):
    __tablename__ = "buyer_signals"

    id = Column(Integer, primary_key=True, index=True)
    region = Column(String, nullable=False, index=True)
    sku_id = Column(Integer, ForeignKey("skus.id"), nullable=False)
    date = Column(Date, nullable=False, index=True)
    search_interest = Column(Float, nullable=False)
    demand_spike = Column(Float, nullable=False)
    event_tag = Column(String, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, server_default=func.now())
    entity_type = Column(String, nullable=False)
    entity_id = Column(Integer, nullable=True)
    action = Column(String, nullable=False)
    payload = Column(Text, nullable=False)
