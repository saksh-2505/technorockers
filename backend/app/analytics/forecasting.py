from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import List, Tuple

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

from ..models import SalesHistory, Dealer, BuyerSignal


@dataclass
class ForecastResult:
    model_name: str
    horizon: int
    confidence: float
    explanation: str
    signal_adjustment: float
    points: List[dict]


def _moving_average(series: np.ndarray, window: int, horizon: int) -> np.ndarray:
    window = max(3, min(window, len(series)))
    avg = np.mean(series[-window:])
    return np.full(horizon, avg)


def _exp_smoothing(series: np.ndarray, alpha: float, horizon: int) -> np.ndarray:
    level = series[0]
    for value in series[1:]:
        level = alpha * value + (1 - alpha) * level
    return np.full(horizon, level)


def _linear_regression(dates: pd.Series, series: np.ndarray, horizon: int) -> np.ndarray:
    day_of_year = dates.dt.dayofyear.values
    idx = np.arange(len(dates))
    features = np.column_stack(
        [
            idx,
            np.sin(2 * np.pi * day_of_year / 365),
            np.cos(2 * np.pi * day_of_year / 365),
            dates.dt.month.values,
        ]
    )

    model = LinearRegression()
    model.fit(features, series)

    future_dates = pd.date_range(dates.iloc[-1] + pd.Timedelta(days=1), periods=horizon, freq="D")
    future_idx = np.arange(len(dates), len(dates) + horizon)
    future_day = future_dates.dayofyear.values
    future_features = np.column_stack(
        [
            future_idx,
            np.sin(2 * np.pi * future_day / 365),
            np.cos(2 * np.pi * future_day / 365),
            future_dates.month.values,
        ]
    )
    forecast = model.predict(future_features)
    return np.clip(forecast, 0, None)


def _mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    denom = np.maximum(1.0, y_true)
    return np.mean(np.abs(y_true - y_pred) / denom)


def _build_series(db, sku_id: int, region: str) -> pd.DataFrame:
    rows = (
        db.query(SalesHistory.date, SalesHistory.demand)
        .join(Dealer, Dealer.id == SalesHistory.dealer_id)
        .filter(SalesHistory.sku_id == sku_id, Dealer.region == region)
        .all()
    )
    if not rows:
        return pd.DataFrame(columns=["date", "demand"])

    df = pd.DataFrame(rows, columns=["date", "demand"])
    grouped = df.groupby("date", as_index=False).sum().sort_values("date")
    return grouped


def _buyer_signal_adjustment(db, sku_id: int, region: str, lookback_days: int = 14) -> Tuple[float, str]:
    end_date = date.today()
    start_date = end_date - timedelta(days=lookback_days)
    signals = (
        db.query(BuyerSignal.search_interest, BuyerSignal.demand_spike, BuyerSignal.event_tag)
        .filter(
            BuyerSignal.sku_id == sku_id,
            BuyerSignal.region == region,
            BuyerSignal.date >= start_date,
            BuyerSignal.date <= end_date,
        )
        .all()
    )

    if not signals:
        return 1.0, "No recent buyer-signal data; base forecast used."

    search_avg = float(np.mean([row[0] for row in signals]))
    spike_avg = float(np.mean([row[1] for row in signals]))
    signal_multiplier = 1 + (search_avg - 50) / 200 + spike_avg * 0.2
    signal_multiplier = max(0.8, min(1.3, signal_multiplier))

    tags = [row[2] for row in signals if row[2]]
    tag_note = f" Event tags observed: {', '.join(sorted(set(tags)))}." if tags else ""

    explanation = (
        f"Buyer signals adjusted forecast by {signal_multiplier:.2f}x based on "
        f"avg search interest {search_avg:.1f} and spike index {spike_avg:.2f}." + tag_note
    )
    return signal_multiplier, explanation


def forecast_demand(db, sku_id: int, region: str, horizon: int = 30) -> ForecastResult:
    series_df = _build_series(db, sku_id, region)
    if series_df.empty or len(series_df) < 10:
        base_value = float(series_df.demand.mean()) if not series_df.empty else 40.0
        forecast = np.full(horizon, base_value)
        signal_multiplier, signal_note = _buyer_signal_adjustment(db, sku_id, region)
        forecast = forecast * signal_multiplier
        points = _format_points(series_df, forecast)
        explanation = (
            "Insufficient historical data; used average demand baseline. " + signal_note
        )
        return ForecastResult(
            model_name="baseline-average",
            horizon=horizon,
            confidence=0.55,
            explanation=explanation,
            signal_adjustment=signal_multiplier,
            points=points,
        )

    series = series_df.demand.values.astype(float)
    dates = pd.to_datetime(series_df.date)

    split = max(7, int(len(series) * 0.8))
    train, val = series[:split], series[split:]
    val_dates = dates[split:]

    models = {}

    ma_pred = _moving_average(train, window=14, horizon=len(val))
    models["moving-average"] = (ma_pred, _mape(val, ma_pred))

    exp_pred = _exp_smoothing(train, alpha=0.3, horizon=len(val))
    models["exp-smoothing"] = (exp_pred, _mape(val, exp_pred))

    lr_pred = _linear_regression(pd.Series(dates[:split]), train, horizon=len(val))
    models["linear-regression"] = (lr_pred, _mape(val, lr_pred))

    best_model = min(models.items(), key=lambda item: item[1][1])[0]

    if best_model == "moving-average":
        future = _moving_average(series, window=14, horizon=horizon)
    elif best_model == "exp-smoothing":
        future = _exp_smoothing(series, alpha=0.3, horizon=horizon)
    else:
        future = _linear_regression(pd.Series(dates), series, horizon=horizon)

    residuals = val - models[best_model][0]
    std = float(np.std(residuals)) if len(residuals) > 3 else float(np.std(series) * 0.1)

    signal_multiplier, signal_note = _buyer_signal_adjustment(db, sku_id, region)
    adjusted = future * signal_multiplier

    lower = np.clip(adjusted - 1.96 * std, 0, None)
    upper = adjusted + 1.96 * std

    confidence = max(0.6, min(0.9, 1 - models[best_model][1]))

    explanation = (
        f"Selected {best_model} model with MAPE {models[best_model][1]:.2f}. "
        f"Confidence band derived from residual std {std:.2f}. {signal_note}"
    )

    points = _format_points(series_df, adjusted, lower=lower, upper=upper)

    return ForecastResult(
        model_name=best_model,
        horizon=horizon,
        confidence=confidence,
        explanation=explanation,
        signal_adjustment=signal_multiplier,
        points=points,
    )


def _format_points(series_df: pd.DataFrame, forecast: np.ndarray, lower=None, upper=None):
    last_date = series_df.date.max() if not series_df.empty else date.today()
    points = []
    for i, value in enumerate(forecast, start=1):
        point_date = last_date + timedelta(days=i)
        low = float(lower[i - 1]) if lower is not None else float(value * 0.9)
        up = float(upper[i - 1]) if upper is not None else float(value * 1.1)
        points.append(
            {
                "date": point_date,
                "forecast": float(value),
                "lower": low,
                "upper": up,
            }
        )
    return points
