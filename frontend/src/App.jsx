import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from "react-router-dom";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler
);

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const demoFlag = import.meta.env.VITE_DEMO_MODE;
const DEMO_MODE = demoFlag === "1" || (demoFlag !== "0" && import.meta.env.MODE === "development");

const fetchJson = async (path, options = {}) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${API_URL}${path}`, { ...options, signal: controller.signal });
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || "Request failed");
    }
    return res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Network timeout. Please retry.");
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const healthTone = (category) => {
  if (category === "Healthy") return "healthy";
  if (category === "At Risk") return "risk";
  return "critical";
};

const alertTone = (type) => (type === "Stockout Risk" ? "critical" : "warning");
const alertToneLabel = (type) => (type === "Stockout Risk" ? "Critical" : "Advisory");

const formatNumber = (value) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value || 0);

const formatDecimal = (value) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value || 0);

const formatDateLabel = (label) => {
  if (!label) return "";
  if (typeof label === "number") return String(label);
  if (typeof label === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
      const [year, month, day] = label.split("-").map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      return parsed.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
    }
    if (/[a-zA-Z]/.test(label)) return label;
  }
  const parsed = new Date(label);
  if (Number.isNaN(parsed.getTime())) return String(label);
  return parsed.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
};

const formatDateTick = function (value, index, ticks) {
  if (this?.getLabelForValue) {
    const label = this.getLabelForValue(value);
    return formatDateLabel(label);
  }
  const raw = ticks?.[index]?.label ?? ticks?.[index]?.value ?? value;
  return formatDateLabel(raw);
};

const formatDate = (value) => value.toISOString().slice(0, 10);

const EVENT_PROFILES = {
  "Monsoon Month (Jun-Sep)": {
    kind: "dip",
    avgImpact: -0.12,
    peakImpact: -0.25,
    window: { start: { m: 6, d: 15 }, end: { m: 9, d: 15 } }
  },
  "Diwali Festival (Oct-Nov)": {
    kind: "spike",
    avgImpact: 0.18,
    peakImpact: 0.32,
    center: { m: 10, d: 25 },
    widthDays: 24
  },
  "Construction Boom (Feb-May)": {
    kind: "ramp",
    avgImpact: 0.12,
    peakImpact: 0.28,
    window: { start: { m: 2, d: 10 }, end: { m: 5, d: 31 } }
  },
  "Summer Paint Push (Mar-Apr)": {
    kind: "step",
    avgImpact: 0.08,
    peakImpact: 0.18,
    window: { start: { m: 3, d: 15 }, end: { m: 4, d: 30 } }
  },
  "Year-End Promo (Dec)": {
    kind: "step",
    avgImpact: 0.07,
    peakImpact: 0.18,
    window: { start: { m: 12, d: 1 }, end: { m: 12, d: 31 } }
  },
  "Winter Slowdown (Jan)": {
    kind: "dip",
    avgImpact: -0.06,
    peakImpact: -0.12,
    window: { start: { m: 1, d: 1 }, end: { m: 1, d: 31 } }
  },
  "Regional Expo (Sep)": {
    kind: "spike",
    avgImpact: 0.05,
    peakImpact: 0.12,
    center: { m: 9, d: 10 },
    widthDays: 12
  },
  "Dealer Anniversary (Variable)": {
    kind: "spike",
    avgImpact: 0.04,
    peakImpact: 0.1,
    widthDays: 10
  }
};

const EVENT_OPTIONS = Object.keys(EVENT_PROFILES);

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

const buildEventMultiplier = (eventTag, dateLabels, context = {}) => {
  const profile = EVENT_PROFILES[eventTag];
  if (!profile || !Array.isArray(dateLabels) || dateLabels.length === 0) {
    return [];
  }

  const toUTCDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) {
      return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    }
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-").map(Number);
      return new Date(Date.UTC(year, month - 1, day));
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  };

  const dates = dateLabels.map((label, index) => {
    const parsed = toUTCDate(label);
    if (parsed) return parsed;
    const fallback = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    return new Date(fallback.getTime() + (index + 1) * 86400000);
  });

  const makeUTCDate = (year, month, day) => new Date(Date.UTC(year, month - 1, day));

  const resolveWindow = (date) => {
    if (!profile.window) return null;
    const year = date.getUTCFullYear();
    let start = makeUTCDate(year, profile.window.start.m, profile.window.start.d);
    let end = makeUTCDate(year, profile.window.end.m, profile.window.end.d);
    if (end < start) {
      if (date <= end) {
        start = makeUTCDate(year - 1, profile.window.start.m, profile.window.start.d);
      } else {
        end = makeUTCDate(year + 1, profile.window.end.m, profile.window.end.d);
      }
    }
    return { start, end };
  };

  const resolveCenter = (date) => {
    if (profile.center) {
      return makeUTCDate(date.getUTCFullYear(), profile.center.m, profile.center.d);
    }
    if (eventTag.includes("Dealer Anniversary") && context.dealer) {
      const month = ((context.dealer.id || 1) % 12) + 1;
      return makeUTCDate(date.getUTCFullYear(), month, 15);
    }
    return null;
  };

  return dates.map((date) => {
    let impact = 0;
    if (profile.kind === "spike") {
      const centerDate = resolveCenter(date);
      if (!centerDate) return 1;
      const widthDays = profile.widthDays ?? 14;
      const sigma = Math.max(3, widthDays / 2.355);
      const dist = (date.getTime() - centerDate.getTime()) / 86400000;
      impact = profile.peakImpact * Math.exp(-0.5 * (dist / sigma) ** 2);
    } else {
      const window = resolveWindow(date);
      if (!window) return 1;
      if (date < window.start || date > window.end) {
        impact = 0;
      } else {
        const t = Math.min(1, Math.max(0, (date - window.start) / (window.end - window.start)));
        if (profile.kind === "dip") {
          const dist = t - 0.5;
          impact = profile.peakImpact * (1 - Math.min(1, dist * dist * 4));
        } else if (profile.kind === "ramp") {
          impact = profile.peakImpact * t;
        } else if (profile.kind === "step") {
          impact = profile.peakImpact;
        }
      }
    }
    return 1 + impact;
  });
};

const formatImpact = (value) => `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;

const describeEventProfile = (profile) => {
  if (!profile) return { windowLabel: "N/A", impactLabel: "N/A" };
  let windowLabel = "Variable timing";
  if (profile.window) {
    const start = `${MONTH_SHORT[profile.window.start.m - 1]} ${profile.window.start.d}`;
    const end = `${MONTH_SHORT[profile.window.end.m - 1]} ${profile.window.end.d}`;
    windowLabel = `${start} – ${end}`;
  } else if (profile.center) {
    const center = `${MONTH_SHORT[profile.center.m - 1]} ${profile.center.d}`;
    const width = profile.widthDays ? `±${profile.widthDays} days` : "seasonal";
    windowLabel = `Peak around ${center} (${width})`;
  }
  const impactLabel = `${formatImpact(profile.avgImpact)} avg, peak ${formatImpact(
    profile.peakImpact
  )}`;
  return { windowLabel, impactLabel };
};

const buildDemoPoints = (horizon, base = 120, trend = 0.6) => {
  const start = new Date();
  const round = (value) => Math.round(value * 10) / 10;
  return Array.from({ length: horizon }, (_, index) => {
    const seasonal = 8 * Math.sin(index / 4);
    const value = base + trend * index + seasonal;
    const forecast = round(value);
    return {
      date: formatDate(new Date(start.getTime() + (index + 1) * 86400000)),
      forecast,
      lower: round(Math.max(0, forecast * 0.88)),
      upper: round(forecast * 1.12)
    };
  });
};

const buildDailyLabels = (count) => {
  const start = new Date();
  return Array.from({ length: count }, (_, index) =>
    formatDate(new Date(start.getTime() + (index + 1) * 86400000))
  );
};

const resolvePointDates = (points) => {
  if (!Array.isArray(points) || points.length === 0) return [];
  const raw = points.map((point) => point.date);
  const unique = new Set(raw.filter(Boolean));
  if (unique.size <= 1 || raw.some((value) => !value)) {
    return buildDailyLabels(points.length);
  }
  return raw;
};

const downsamplePoints = (points, maxPoints) => {
  if (!Array.isArray(points) || points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, index) => index % step === 0 || index === points.length - 1);
};

const buildDemoForecast = (skuId, region, horizon = 30, base = 120) => ({
  sku_id: skuId,
  region,
  model: "linear-regression",
  horizon,
  confidence: 0.78,
  explanation:
    "Demo forecast using linear regression with seasonal adjustment and buyer-signal uplift.",
  signal_adjustment: 1.05,
  points: buildDemoPoints(horizon, base)
});

const demoFixtures = (() => {
  const today = new Date();
  const daysAgo = (days) => formatDate(new Date(today.getTime() - days * 86400000));

  const dealers = [
    {
      id: 1,
      name: "Modern Colours Delhi",
      region: "North",
      city: "Delhi",
      latitude: 28.61,
      longitude: 77.2
    },
    {
      id: 2,
      name: "Modern Colours Mumbai",
      region: "West",
      city: "Mumbai",
      latitude: 19.07,
      longitude: 72.88
    },
    {
      id: 3,
      name: "Modern Colours Bengaluru",
      region: "South",
      city: "Bengaluru",
      latitude: 12.97,
      longitude: 77.59
    }
  ];

  const skus = [
    {
      id: 1,
      name: "Interior Emulsion 10L - Ivory",
      color_family: "Warm",
      size_ltr: 10,
      unit_cost: 950,
      unit_price: 1350
    },
    {
      id: 2,
      name: "Exterior Weatherproof 20L - White",
      color_family: "Neutral",
      size_ltr: 20,
      unit_cost: 1800,
      unit_price: 2600
    }
  ];

  return {
    summary: {
      total_inventory_units: 12480,
      total_skus: skus.length,
      total_dealers: dealers.length,
      stockout_risk_count: 4,
      dead_stock_risk_count: 3
    },
    dealers,
    skus,
    regions: Array.from(new Set(dealers.map((dealer) => dealer.region))),
    health: [
      {
        dealer_id: 1,
        dealer_name: dealers[0].name,
        region: dealers[0].region,
        health_score: 78.4,
        category: "Healthy",
        turnover_ratio: 1.8,
        aging_percent: 0.12,
        stockout_rate: 0.05
      },
      {
        dealer_id: 2,
        dealer_name: dealers[1].name,
        region: dealers[1].region,
        health_score: 52.1,
        category: "At Risk",
        turnover_ratio: 0.9,
        aging_percent: 0.26,
        stockout_rate: 0.12
      },
      {
        dealer_id: 3,
        dealer_name: dealers[2].name,
        region: dealers[2].region,
        health_score: 34.9,
        category: "Critical",
        turnover_ratio: 0.6,
        aging_percent: 0.38,
        stockout_rate: 0.2
      }
    ],
    inventory: [
      {
        id: 1,
        dealer_id: 1,
        sku_id: 1,
        quantity: 42,
        last_received_date: daysAgo(16)
      },
      {
        id: 2,
        dealer_id: 1,
        sku_id: 2,
        quantity: 110,
        last_received_date: daysAgo(24)
      },
      {
        id: 3,
        dealer_id: 2,
        sku_id: 1,
        quantity: 260,
        last_received_date: daysAgo(10)
      },
      {
        id: 4,
        dealer_id: 3,
        sku_id: 1,
        quantity: 78,
        last_received_date: daysAgo(32)
      }
    ],
    alerts: [
      {
        dealer_id: 1,
        dealer_name: dealers[0].name,
        sku_id: 1,
        sku_name: skus[0].name,
        alert_type: "Stockout Risk",
        recommended_action: "Transfer",
        confidence: 0.78,
        reasoning:
          "Low days-of-cover with rising regional demand. Prioritize inbound transfer within 48 hours.",
        metrics: { days_of_cover: 3.5, stockout_rate: 0.18 }
      },
      {
        dealer_id: 1,
        dealer_name: dealers[0].name,
        sku_id: 2,
        sku_name: skus[1].name,
        alert_type: "Dead Stock Risk",
        recommended_action: "Hold",
        confidence: 0.68,
        reasoning: "High aging inventory with slower turnover. Recommend hold and local promotion.",
        metrics: { aging_percent: 0.46, turnover_ratio: 0.7 }
      }
    ],
    rebalance: [
      {
        from_dealer_id: 2,
        from_dealer: dealers[1].name,
        to_dealer_id: 1,
        to_dealer: dealers[0].name,
        sku_id: 1,
        sku_name: skus[0].name,
        quantity: 80,
        distance_km: 1150,
        logistics_cost: 2875,
        score: 0.18,
        explanation: "Donor has 45 days cover while receiver is below 5 days."
      }
    ]
  };
})();

const navItems = ["Home", "Inventory", "Signals", "Risk", "Actions"];

const DetailPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state;
  const handleClose = useCallback(() => navigate(-1), [navigate]);
  const stopClick = (event) => event.stopPropagation();
  const cardRef = useRef(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const node = cardRef.current;
    const focusableSelectors =
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
    const focusable = node ? Array.from(node.querySelectorAll(focusableSelectors)) : [];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first) {
      first.focus();
    }
    const handleKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
      if (event.key === "Tab" && focusable.length > 0) {
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKey);
    };
  }, [handleClose]);

  if (!state) {
    return (
      <div className="detail-page" onClick={handleClose} role="presentation">
      <div
        className="detail-card"
        onClick={stopClick}
        role="dialog"
        aria-modal="true"
        ref={cardRef}
      >
        <button className="detail-close" type="button" onClick={handleClose}>
          Close
        </button>
        <h2>No item selected</h2>
        <p className="subtitle">Return to the dashboard and select a row or card.</p>
      </div>
      </div>
    );
  }

  const { title, subtitle, badge, meta = [], notes } = state;

  return (
    <div className="detail-page" onClick={handleClose} role="presentation">
      <div
        className="detail-card"
        onClick={stopClick}
        role="dialog"
        aria-modal="true"
        ref={cardRef}
      >
        <button className="detail-close" type="button" onClick={handleClose}>
          Close
        </button>
        <div className="detail-header">
          <div>
            <p className="eyebrow">Detail View</p>
            <h2>{title}</h2>
            {subtitle && <p className="subtitle">{subtitle}</p>}
          </div>
          {badge && <span className="status-pill">{badge}</span>}
        </div>
        <div className="detail-grid">
          {meta.map((item) => (
            <div key={item.label} className="detail-item">
              <p>{item.label}</p>
              <h3>{item.value}</h3>
            </div>
          ))}
        </div>
        {notes && <p className="detail-notes">{notes}</p>}
      </div>
    </div>
  );
};

const Dashboard = ({
  view,
  setView,
  summary,
  dealers,
  skus,
  regions,
  health,
  selectedSku,
  setSelectedSku,
  selectedRegion,
  setSelectedRegion,
  selectedDealer,
  setSelectedDealer,
  forecast,
  rebalance,
  inventory,
  alerts,
  baseLoading,
  forecastLoading,
  rebalanceLoading,
  dealerLoading,
  whatIfLoading,
  baseError,
  forecastError,
  rebalanceError,
  dealerError,
  whatIfError,
  lastUpdated,
  reloadBase,
  reloadForecast,
  reloadRebalance,
  reloadDealer,
  timeHorizon,
  setTimeHorizon,
  whatIfPercent,
  setWhatIfPercent,
  whatIfEvent,
  setWhatIfEvent,
  whatIfForecast,
  runWhatIf,
  regionInventoryData,
  lineChartOptions,
  forecastChart,
  whatIfChart,
  demoMode
}) => {
  const navigate = useNavigate();
  const [activeNav, setActiveNav] = useState("Home");
  const [focusedSection, setFocusedSection] = useState(null);
  const [fullScreenSection, setFullScreenSection] = useState(null);
  const focusTimeoutRef = useRef(null);

  const topRef = useRef(null);
  const summaryRef = useRef(null);
  const forecastRef = useRef(null);
  const healthRef = useRef(null);
  const rebalanceRef = useRef(null);
  const inventoryRef = useRef(null);
  const alertsRef = useRef(null);
  const transferRef = useRef(null);
  const mixRef = useRef(null);
  const fullScreenRef = useRef(null);

  const healthList = Array.isArray(health) ? health : [];
  const rebalanceList = Array.isArray(rebalance) ? rebalance : [];
  const inventoryList = Array.isArray(inventory) ? inventory : [];
  const alertsList = Array.isArray(alerts) ? alerts : [];
  const dealerTransfers = selectedDealer
    ? rebalanceList.filter(
        (rec) =>
          rec.to_dealer_id === selectedDealer.id || rec.from_dealer_id === selectedDealer.id
      )
    : [];

  const handleNavigate = (path, payload) => {
    navigate(path, { state: payload });
  };

  useEffect(() => {
    return () => {
      if (focusTimeoutRef.current) {
        window.clearTimeout(focusTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setActiveNav("Home");
    setFocusedSection(null);
    setFullScreenSection(null);
  }, [view]);

  const handleNavClick = (item) => {
    setActiveNav(item);
    setFullScreenSection(item);
    const navTargets =
      view === "admin"
        ? {
            Home: topRef,
            Inventory: summaryRef,
            Signals: forecastRef,
            Risk: healthRef,
            Actions: rebalanceRef
          }
        : {
            Home: topRef,
            Inventory: inventoryRef,
            Signals: mixRef,
            Risk: alertsRef,
            Actions: transferRef
          };
    const target = navTargets[item]?.current;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setFocusedSection(item);
      if (focusTimeoutRef.current) {
        window.clearTimeout(focusTimeoutRef.current);
      }
      focusTimeoutRef.current = window.setTimeout(() => setFocusedSection(null), 700);
    }
  };

  const closeFullScreen = useCallback(() => setFullScreenSection(null), []);

  useEffect(() => {
    if (!fullScreenKey) {
      document.body.style.overflow = "";
      return;
    }
    document.body.style.overflow = "hidden";
    const node = fullScreenRef.current;
    const focusableSelectors =
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
    const focusable = node ? Array.from(node.querySelectorAll(focusableSelectors)) : [];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first) {
      first.focus();
    }
    const handleKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFullScreen();
      }
      if (event.key === "Tab" && focusable.length > 0) {
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKey);
    };
  }, [fullScreenKey, closeFullScreen]);

  const fullScreenKey = useMemo(() => {
    if (!fullScreenSection) return null;
    if (view === "admin") {
      if (fullScreenSection === "Home" || fullScreenSection === "Inventory") return "summary";
      if (fullScreenSection === "Signals") return "signals";
      if (fullScreenSection === "Risk") return "risk";
      if (fullScreenSection === "Actions") return "actions";
      return null;
    }
    if (view === "dealer") {
      if (fullScreenSection === "Home" || fullScreenSection === "Inventory") return "inventory";
      if (fullScreenSection === "Signals") return "signals";
      if (fullScreenSection === "Risk") return "risk";
      if (fullScreenSection === "Actions") return "actions";
      return null;
    }
    return null;
  }, [fullScreenSection, view]);

  const summaryCards = [
    {
      id: "inventory",
      label: "Total Inventory",
      value: summary ? formatNumber(summary.total_inventory_units) : "-",
      note: "Units across the network"
    },
    {
      id: "dealers",
      label: "Active Dealers",
      value: summary ? summary.total_dealers : "-",
      note: "Currently onboarded"
    },
    {
      id: "skus",
      label: "SKUs Monitored",
      value: summary ? summary.total_skus : "-",
      note: "Active catalogue"
    },
    {
      id: "stockout",
      label: "Stockout Risks",
      value: summary ? summary.stockout_risk_count : "-",
      note: "Immediate attention"
    },
    {
      id: "deadstock",
      label: "Dead Stock Risks",
      value: summary ? summary.dead_stock_risk_count : "-",
      note: "Slow movers"
    }
  ];

  const formatUpdated = (value) =>
    value
      ? value.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "—";

  const isUpdating = baseLoading || forecastLoading || rebalanceLoading || dealerLoading;

  const eventProfile = EVENT_PROFILES[whatIfEvent];
  const eventMeta = useMemo(() => describeEventProfile(eventProfile), [eventProfile]);
  const eventHasOverlap = useMemo(() => {
    const referencePoints = Array.isArray(whatIfForecast?.points)
      ? whatIfForecast.points
      : Array.isArray(forecast?.points)
      ? forecast.points
      : [];
    const dates = resolvePointDates(referencePoints);
    if (dates.length === 0) return true;
    const curve = buildEventMultiplier(whatIfEvent, dates, { dealer: selectedDealer });
    return curve.some((value) => Math.abs(value - 1) > 0.01);
  }, [whatIfEvent, whatIfForecast, forecast, selectedDealer]);

  const renderPanelState = (loading, errorMessage, onRetry, loadingLabel) => {
    if (loading) {
      return <div className="panel-loading">{loadingLabel}</div>;
    }
    if (errorMessage) {
      return (
        <div className="panel-error">
          <p>{errorMessage}</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      );
    }
    return null;
  };

  const horizonOptions = [7, 14, 30, 60, 90];
  const eventOptions = EVENT_OPTIONS;

  return (
    <div className="app-shell" ref={topRef}>
      {fullScreenKey && (
        <div className="fullscreen-overlay" onClick={closeFullScreen} role="presentation">
          <div
            className={`fullscreen-card ${
              fullScreenKey === "signals" && view === "admin" ? "fullscreen-card--stack" : ""
            }`}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            ref={fullScreenRef}
          >
            <button className="overlay-close" type="button" onClick={closeFullScreen}>
              Close
            </button>
            {fullScreenKey === "summary" && (
              <section className="panel panel--fullscreen">
                <div className="panel-header">
                  <h2>Network Summary</h2>
                  <span className="pill">Overview</span>
                </div>
                <div className="stats-row stats-row--fullscreen">
                  {summaryCards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className={`stat-card stat-card--${card.id}`}
                      onClick={() =>
                        handleNavigate(`/detail/summary/${card.id}`, {
                          title: card.label,
                          subtitle: "Network Pulse",
                          badge: "Summary",
                          meta: [
                            { label: "Value", value: card.value },
                            { label: "Description", value: card.note }
                          ],
                          notes: "Click through from the dashboard to inspect this metric in context."
                        })
                      }
                    >
                      <p>{card.label}</p>
                      <h3>{card.value}</h3>
                      <span>{card.note}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {fullScreenKey === "signals" && view === "admin" && (
              <>
                <section className="panel panel--fullscreen">
                <div className="panel-header">
                  <h2>Demand Forecast</h2>
                  <div className="panel-actions">
                    <span className="updated">Updated {formatUpdated(lastUpdated.forecast)}</span>
                    <span className="pill">Model: {forecast?.model || "-"}</span>
                    <select
                      className="period-select"
                      value={timeHorizon}
                      onChange={(event) => setTimeHorizon(Number(event.target.value))}
                      aria-label="Time period"
                    >
                      {horizonOptions.map((option) => (
                        <option key={option} value={option}>
                          {option} days
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                  {renderPanelState(forecastLoading, forecastError, reloadForecast, "Loading forecast…") ||
                    (forecastChart && (
                    <div className="chart-container chart-container--line">
                      <Line data={forecastChart} options={lineChartOptions} />
                    </div>
                  ))}
                  {forecast && <p className="explain">{forecast.explanation}</p>}
                </section>
                <section className="panel panel--fullscreen">
                <div className="panel-header">
                  <h2>What-if Scenario</h2>
                  <div className="panel-actions">
                    <span className="updated">Updated {formatUpdated(lastUpdated.whatIf)}</span>
                    <span className="pill">Signal-sensitive</span>
                    <select
                      className="period-select"
                      value={timeHorizon}
                      onChange={(event) => setTimeHorizon(Number(event.target.value))}
                      aria-label="Time period"
                    >
                      {horizonOptions.map((option) => (
                        <option key={option} value={option}>
                          {option} days
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                  <div className="whatif-controls">
                    <label>
                      Demand Change (%)
                      <input
                        type="range"
                        min="-30"
                        max="40"
                        value={whatIfPercent}
                        onChange={(event) => setWhatIfPercent(Number(event.target.value))}
                      />
                      <span>{whatIfPercent}%</span>
                    </label>
                    <label>
                      Event Tag
                      <select
                        value={whatIfEvent}
                        onChange={(event) => setWhatIfEvent(event.target.value)}
                      >
                        {eventOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button onClick={runWhatIf} type="button" disabled={whatIfLoading || isUpdating}>
                      Run Simulation
                    </button>
                  </div>
                  <div className="event-meta">
                    <span>Event window: {eventMeta.windowLabel}</span>
                    <span>Expected impact: {eventMeta.impactLabel}</span>
                    {!eventHasOverlap && (
                      <span className="event-warning">Outside selected horizon</span>
                    )}
                  </div>
                  {renderPanelState(whatIfLoading, whatIfError, runWhatIf, "Running simulation…") ||
                    (whatIfChart && (
                    <div className="chart-container chart-container--line">
                      <Line data={whatIfChart} options={lineChartOptions} />
                    </div>
                  ))}
                  {whatIfForecast && <p className="explain">{whatIfForecast.explanation}</p>}
                </section>
              </>
            )}

            {fullScreenKey === "risk" && view === "admin" && (
              <section className="panel panel--fullscreen">
                <div className="panel-header">
                  <h2>Dealer Health Map</h2>
                  <div className="panel-actions">
                    <span className="updated">Updated {formatUpdated(lastUpdated.base)}</span>
                    <span className="pill">Explainable score</span>
                  </div>
                </div>
                {renderPanelState(baseLoading, baseError, reloadBase, "Loading dealer health…") || (
                  <div className="health-grid">
                    {healthList.map((dealer) => (
                      <button
                        key={dealer.dealer_id}
                        type="button"
                        className={`health-card ${healthTone(dealer.category)}`}
                        onClick={() =>
                          handleNavigate(`/detail/health/${dealer.dealer_id}`, {
                            title: dealer.dealer_name,
                            subtitle: dealer.region,
                            badge: dealer.category,
                            meta: [
                              { label: "Health Score", value: dealer.health_score },
                              { label: "Turnover", value: formatDecimal(dealer.turnover_ratio) },
                              {
                                label: "Aging %",
                                value: `${formatDecimal(dealer.aging_percent * 100)}%`
                              },
                              {
                                label: "Stockouts",
                                value: `${formatDecimal(dealer.stockout_rate * 100)}%`
                              }
                            ],
                            notes:
                              "Dealer health blends turnover, aging inventory, and stockout performance."
                          })
                        }
                      >
                        <h4>{dealer.dealer_name}</h4>
                        <p>{dealer.region}</p>
                        <div className="health-score">{dealer.health_score}</div>
                        <div className="health-metrics">
                          <span>Turnover {formatDecimal(dealer.turnover_ratio)}</span>
                          <span>Aging {formatDecimal(dealer.aging_percent * 100)}%</span>
                          <span>Stockouts {formatDecimal(dealer.stockout_rate * 100)}%</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            {fullScreenKey === "actions" && view === "admin" && (
              <section className="panel panel--fullscreen">
                <div className="panel-header">
                  <h2>Rebalancing Recommendations</h2>
                  <div className="panel-actions">
                    <span className="updated">Updated {formatUpdated(lastUpdated.rebalance)}</span>
                    <span className="pill">Distance-aware</span>
                  </div>
                </div>
                <div className="table-container table-container--md">
                  {renderPanelState(
                    rebalanceLoading,
                    rebalanceError,
                    reloadRebalance,
                    "Loading recommendations…"
                  ) || (
                    <div className="table table-6">
                    <div className="table-row header">
                      <span className="cell-primary">From</span>
                      <span className="cell-to">To</span>
                      <span className="cell-center">Qty</span>
                      <span className="cell-center">Distance</span>
                      <span className="cell-right">Cost</span>
                      <span className="cell-right">Score</span>
                    </div>
                    {rebalanceList.slice(0, 6).map((rec, index) => (
                      <div
                        className="table-row clickable"
                        key={`${rec.from_dealer_id}-${index}`}
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          handleNavigate(`/detail/transfer/${rec.from_dealer_id}-${index}`, {
                            title: `${rec.from_dealer} → ${rec.to_dealer}`,
                            subtitle: rec.sku_name,
                            badge: "Transfer",
                            meta: [
                              { label: "Quantity", value: rec.quantity },
                              { label: "Distance", value: `${rec.distance_km} km` },
                              {
                                label: "Logistics Cost",
                                value: `₹${formatNumber(rec.logistics_cost)}`
                              },
                              { label: "Score", value: formatDecimal(rec.score) }
                            ],
                            notes: rec.explanation
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.click();
                          }
                        }}
                      >
                        <span className="cell-primary">{rec.from_dealer}</span>
                        <span className="cell-to">{rec.to_dealer}</span>
                        <span className="cell-center">{rec.quantity}</span>
                        <span className="cell-center">{rec.distance_km} km</span>
                        <span className="cell-right">₹{formatNumber(rec.logistics_cost)}</span>
                        <span className="cell-right">{formatDecimal(rec.score)}</span>
                      </div>
                    ))}
                    {rebalanceList.length === 0 && (
                      <div className="table-empty">
                        <div className="empty-icon" aria-hidden="true"></div>
                        <div>
                          <p className="empty-title">No rebalancing needed</p>
                          <p className="empty-subtitle">
                            Inventory cover looks balanced for this SKU.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  )}
                </div>
              </section>
            )}

            {fullScreenKey === "inventory" && view === "dealer" && (
              <section className="panel panel--fullscreen">
                <div className="panel-header">
                  <h2>Dealer Inventory</h2>
                  <div className="panel-actions">
                    <span className="updated">Updated {formatUpdated(lastUpdated.dealer)}</span>
                    <span className="pill">Selectable rows</span>
                  </div>
                </div>
                <div className="table-container table-container--sm">
                  {renderPanelState(dealerLoading, dealerError, reloadDealer, "Loading inventory…") || (
                    <div className="table table-3">
                    <div className="table-row header">
                      <span className="cell-primary">SKU</span>
                      <span className="cell-center">Quantity</span>
                      <span className="cell-muted">Last Received</span>
                    </div>
                    {inventoryList.map((item) => {
                      const sku = skus.find((s) => s.id === item.sku_id);
                      const lowStock = item.quantity <= 80;
                      return (
                        <div
                          className={`table-row clickable ${lowStock ? "low-stock" : ""}`}
                          key={item.id}
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            handleNavigate(`/detail/inventory/${item.id}`, {
                              title: sku?.name || "SKU",
                              subtitle: selectedDealer?.name || "Dealer",
                              badge: lowStock ? "Low stock" : "In stock",
                              meta: [
                                { label: "Quantity", value: item.quantity },
                                { label: "Last Received", value: item.last_received_date },
                                { label: "Dealer", value: selectedDealer?.name || "-" }
                              ],
                              notes: lowStock
                                ? "Low stock flagged. Consider transfer or reorder."
                                : "Inventory levels are within expected range."
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.click();
                            }
                          }}
                        >
                          <span className="cell-primary">{sku?.name || "SKU"}</span>
                          <span className="cell-center">{item.quantity}</span>
                          <span className="cell-muted">{item.last_received_date}</span>
                        </div>
                      );
                    })}
                  </div>
                  )}
                </div>
              </section>
            )}

            {fullScreenKey === "risk" && view === "dealer" && (
              <section className="panel alert-panel panel--fullscreen">
                <div className="panel-header">
                  <h2>Risk Alerts</h2>
                  <div className="panel-actions">
                    <span className="updated">Updated {formatUpdated(lastUpdated.dealer)}</span>
                    <span className="pill">Action required</span>
                  </div>
                </div>
                <div className="alerts">
                  {renderPanelState(dealerLoading, dealerError, reloadDealer, "Loading alerts…") || (
                    <>
                      {alertsList.map((alert, index) => (
                        <button
                          className={`alert-card ${alertTone(alert.alert_type)}`}
                          key={`${alert.sku_id}-${index}`}
                          type="button"
                          onClick={() =>
                            handleNavigate(`/detail/alert/${alert.sku_id}-${index}`, {
                              title: alert.alert_type,
                              subtitle: alert.sku_name,
                              badge: alertToneLabel(alert.alert_type),
                              meta: [
                                { label: "Action", value: alert.recommended_action },
                                { label: "Confidence", value: formatDecimal(alert.confidence) },
                                { label: "Dealer", value: alert.dealer_name }
                              ],
                              notes: alert.reasoning
                            })
                          }
                        >
                          <div className="alert-head">
                            <div>
                              <h4>{alert.alert_type}</h4>
                              <p className="alert-sku">{alert.sku_name}</p>
                            </div>
                            <span className={`alert-badge ${alertTone(alert.alert_type)}`}>
                              {alertToneLabel(alert.alert_type)}
                            </span>
                          </div>
                          <div className="alert-meta">
                            <span>
                              Action <strong>{alert.recommended_action}</strong>
                            </span>
                            <span>
                              Confidence <strong>{formatDecimal(alert.confidence)}</strong>
                            </span>
                          </div>
                          <p className="alert-reason">{alert.reasoning}</p>
                        </button>
                      ))}
                      {alertsList.length === 0 && (
                        <div className="empty-state">
                          <div className="empty-icon" aria-hidden="true"></div>
                          <div>
                            <p className="empty-title">No critical alerts</p>
                            <p className="empty-subtitle">
                              Inventory risk is within expected bounds.
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>
            )}

            {fullScreenKey === "actions" && view === "dealer" && (
              <section className="panel panel--fullscreen">
                <div className="panel-header">
                  <h2>Transfer Suggestions</h2>
                  <div className="panel-actions">
                    <span className="updated">Updated {formatUpdated(lastUpdated.rebalance)}</span>
                    <span className="pill">Selectable rows</span>
                  </div>
                </div>
                <div className="table-container table-container--md">
                  {renderPanelState(
                    rebalanceLoading,
                    rebalanceError,
                    reloadRebalance,
                    "Loading transfers…"
                  ) || (
                    <div className="table table-6">
                    <div className="table-row header">
                      <span className="cell-primary">From</span>
                      <span className="cell-to">To</span>
                      <span className="cell-center">Qty</span>
                      <span className="cell-center">Distance</span>
                      <span className="cell-right">Cost</span>
                      <span className="cell-right">Score</span>
                    </div>
                    {dealerTransfers.map((rec, index) => (
                      <div
                        className="table-row clickable"
                        key={`${rec.from_dealer_id}-${rec.to_dealer_id}-${index}`}
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          handleNavigate(
                            `/detail/transfer/${rec.from_dealer_id}-${rec.to_dealer_id}`,
                            {
                              title: `${rec.from_dealer} → ${rec.to_dealer}`,
                              subtitle: rec.sku_name,
                              badge: "Transfer",
                              meta: [
                                { label: "Quantity", value: rec.quantity },
                                { label: "Distance", value: `${rec.distance_km} km` },
                                {
                                  label: "Logistics Cost",
                                  value: `₹${formatNumber(rec.logistics_cost)}`
                                },
                                { label: "Score", value: formatDecimal(rec.score) }
                              ],
                              notes: rec.explanation
                            }
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.click();
                          }
                        }}
                      >
                        <span className="cell-primary">{rec.from_dealer}</span>
                        <span className="cell-to">{rec.to_dealer}</span>
                        <span className="cell-center">{rec.quantity}</span>
                        <span className="cell-center">{rec.distance_km} km</span>
                        <span className="cell-right">₹{formatNumber(rec.logistics_cost)}</span>
                        <span className="cell-right">{formatDecimal(rec.score)}</span>
                      </div>
                    ))}
                    {dealerTransfers.length === 0 && (
                      <div className="table-empty">
                        <div className="empty-icon" aria-hidden="true"></div>
                        <div>
                          <p className="empty-title">No transfer actions</p>
                          <p className="empty-subtitle">
                            This dealer is balanced for the selected SKU.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  )}
                </div>
              </section>
            )}

            {fullScreenKey === "signals" && view === "dealer" && (
              <section className="panel panel--fullscreen">
                <div className="panel-header">
                  <h2>Regional Inventory Mix</h2>
                  <div className="panel-actions">
                    <span className="updated">Updated {formatUpdated(lastUpdated.base)}</span>
                    <span className="pill">Fixed scale</span>
                  </div>
                </div>
                <div className="chart-container">
                  {renderPanelState(baseLoading, baseError, reloadBase, "Loading inventory mix…") || (
                    <Bar
                    data={{
                      labels: regionInventoryData.labels,
                      datasets: [
                        {
                          label: "Inventory Units",
                          data: regionInventoryData.values,
                          backgroundColor: [
                            "rgba(79, 70, 229, 0.65)",
                            "rgba(14, 165, 233, 0.65)",
                            "rgba(16, 185, 129, 0.65)",
                            "rgba(245, 158, 11, 0.65)",
                            "rgba(239, 68, 68, 0.65)"
                          ]
                        }
                      ]
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { position: "bottom", labels: { color: "#64748b" } }
                      },
                      scales: {
                        x: {
                          ticks: { color: "#64748b", font: { size: 11 } },
                          grid: { display: false }
                        },
                        y: {
                          ticks: {
                            color: "#64748b",
                            font: { size: 11 },
                            callback: (value) => formatNumber(value)
                          },
                          grid: { color: "rgba(148, 163, 184, 0.35)" }
                        }
                      }
                    }}
                  />
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <p className="eyebrow">Modern Colours Pvt. Ltd.</p>
          <h1>Supply Chain Decision Intelligence</h1>
          <p className="subtitle">Operational cockpit for seasonal, region-aware paint demand.</p>
        </div>
        <nav className="pill-nav">
          {navItems.map((item) => (
            <button
              key={item}
              type="button"
              className={`nav-pill ${activeNav === item ? "active" : ""}`}
              onClick={() => handleNavClick(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        <div className="view-toggle">
          <button
            className={view === "admin" ? "active" : ""}
            onClick={() => setView("admin")}
            type="button"
          >
            Admin
          </button>
          <button
            className={view === "dealer" ? "active" : ""}
            onClick={() => setView("dealer")}
            type="button"
          >
            Dealer
          </button>
          {demoMode && <span className="status-pill">Demo</span>}
        </div>
      </header>

      {baseError && (
        <div className="error">
          <span>{baseError}</span>
          <button type="button" onClick={reloadBase}>
            Retry loading data
          </button>
        </div>
      )}
      {baseLoading && !baseError && <div className="loading-banner">Loading live data…</div>}

      <section className="filters">
        <div>
          <label>SKU</label>
          <select
            value={selectedSku?.id || ""}
            disabled={baseLoading}
            onChange={(event) => {
              const next = skus.find((sku) => sku.id === Number(event.target.value));
              setSelectedSku(next || null);
            }}
          >
            {skus.map((sku) => (
              <option key={sku.id} value={sku.id}>
                {sku.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Region</label>
          <select
            value={selectedRegion || ""}
            disabled={baseLoading}
            onChange={(event) => setSelectedRegion(event.target.value)}
          >
            {regions.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Dealer</label>
          <select
            value={selectedDealer?.id || ""}
            disabled={baseLoading}
            onChange={(event) => {
              const next = dealers.find((dealer) => dealer.id === Number(event.target.value));
              setSelectedDealer(next || null);
            }}
          >
            {dealers.map((dealer) => (
              <option key={dealer.id} value={dealer.id}>
                {dealer.name}
              </option>
            ))}
          </select>
        </div>
      </section>
      {isUpdating && <div className="filter-status">Updating panels…</div>}

      {view === "admin" && (
        <section className="stats-row" ref={summaryRef} data-focus={focusedSection === "Inventory"}>
          {summaryCards.map((card) => (
            <button
              key={card.id}
              type="button"
              className={`stat-card stat-card--${card.id}`}
              disabled={baseLoading}
              onClick={() =>
                handleNavigate(`/detail/summary/${card.id}`, {
                  title: card.label,
                  subtitle: "Network Pulse",
                  badge: "Summary",
                  meta: [
                    { label: "Value", value: card.value },
                    { label: "Description", value: card.note }
                  ],
                  notes: "Click through from the dashboard to inspect this metric in context."
                })
              }
            >
              <p>{card.label}</p>
              <h3>{card.value}</h3>
              <span>{card.note}</span>
            </button>
          ))}
        </section>
      )}

      <div className="content">
        {view === "admin" && (
          <main className="grid grid-2x2">
            <section className="panel" ref={forecastRef} data-focus={focusedSection === "Signals"}>
              <div className="panel-header">
                <h2>Demand Forecast</h2>
                <div className="panel-actions">
                  <span className="updated">Updated {formatUpdated(lastUpdated.forecast)}</span>
                  <span className="pill">Model: {forecast?.model || "-"}</span>
                  <select
                    className="period-select"
                    value={timeHorizon}
                    onChange={(event) => setTimeHorizon(Number(event.target.value))}
                    aria-label="Time period"
                  >
                    {horizonOptions.map((option) => (
                      <option key={option} value={option}>
                        {option} days
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {renderPanelState(forecastLoading, forecastError, reloadForecast, "Loading forecast…") ||
                (forecastChart && (
                  <div className="chart-container chart-container--line">
                    <Line data={forecastChart} options={lineChartOptions} />
                  </div>
                ))}
              {forecast && <p className="explain">{forecast.explanation}</p>}
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2>What-if Scenario</h2>
                <div className="panel-actions">
                  <span className="updated">Updated {formatUpdated(lastUpdated.whatIf)}</span>
                  <span className="pill">Signal-sensitive</span>
                  <select
                    className="period-select"
                    value={timeHorizon}
                    onChange={(event) => setTimeHorizon(Number(event.target.value))}
                    aria-label="Time period"
                  >
                    {horizonOptions.map((option) => (
                      <option key={option} value={option}>
                        {option} days
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="whatif-controls">
                <label>
                  Demand Change (%)
                  <input
                    type="range"
                    min="-30"
                    max="40"
                    value={whatIfPercent}
                    onChange={(event) => setWhatIfPercent(Number(event.target.value))}
                  />
                  <span>{whatIfPercent}%</span>
                </label>
                <label>
                  Event Tag
                  <select
                    value={whatIfEvent}
                    onChange={(event) => setWhatIfEvent(event.target.value)}
                  >
                    {eventOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <button onClick={runWhatIf} type="button" disabled={whatIfLoading || isUpdating}>
                  Run Simulation
                </button>
              </div>
              <div className="event-meta">
                <span>Event window: {eventMeta.windowLabel}</span>
                <span>Expected impact: {eventMeta.impactLabel}</span>
                {!eventHasOverlap && (
                  <span className="event-warning">Outside selected horizon</span>
                )}
              </div>
              {renderPanelState(whatIfLoading, whatIfError, runWhatIf, "Running simulation…") ||
                (whatIfChart && (
                  <div className="chart-container chart-container--line">
                    <Line data={whatIfChart} options={lineChartOptions} />
                  </div>
                ))}
              {whatIfForecast && <p className="explain">{whatIfForecast.explanation}</p>}
            </section>

            <section className="panel" ref={healthRef} data-focus={focusedSection === "Risk"}>
              <div className="panel-header">
                <h2>Dealer Health Map</h2>
                <div className="panel-actions">
                  <span className="updated">Updated {formatUpdated(lastUpdated.base)}</span>
                  <span className="pill">Explainable score</span>
                </div>
              </div>
              {renderPanelState(baseLoading, baseError, reloadBase, "Loading dealer health…") || (
                <div className="health-grid">
                  {healthList.map((dealer) => (
                    <button
                      key={dealer.dealer_id}
                      type="button"
                      className={`health-card ${healthTone(dealer.category)}`}
                      onClick={() =>
                        handleNavigate(`/detail/health/${dealer.dealer_id}`, {
                          title: dealer.dealer_name,
                          subtitle: dealer.region,
                          badge: dealer.category,
                          meta: [
                            { label: "Health Score", value: dealer.health_score },
                            { label: "Turnover", value: formatDecimal(dealer.turnover_ratio) },
                            {
                              label: "Aging %",
                              value: `${formatDecimal(dealer.aging_percent * 100)}%`
                            },
                            {
                              label: "Stockouts",
                              value: `${formatDecimal(dealer.stockout_rate * 100)}%`
                            }
                          ],
                          notes:
                            "Dealer health blends turnover, aging inventory, and stockout performance."
                        })
                      }
                    >
                      <h4>{dealer.dealer_name}</h4>
                      <p>{dealer.region}</p>
                      <div className="health-score">{dealer.health_score}</div>
                      <div className="health-metrics">
                        <span>Turnover {formatDecimal(dealer.turnover_ratio)}</span>
                        <span>Aging {formatDecimal(dealer.aging_percent * 100)}%</span>
                        <span>Stockouts {formatDecimal(dealer.stockout_rate * 100)}%</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="panel" ref={rebalanceRef} data-focus={focusedSection === "Actions"}>
              <div className="panel-header">
                <h2>Rebalancing Recommendations</h2>
                <div className="panel-actions">
                  <span className="updated">Updated {formatUpdated(lastUpdated.rebalance)}</span>
                  <span className="pill">Distance-aware</span>
                </div>
              </div>
              <div className="table-container table-container--md">
                {renderPanelState(
                  rebalanceLoading,
                  rebalanceError,
                  reloadRebalance,
                  "Loading recommendations…"
                ) || (
                  <div className="table table-6">
                  <div className="table-row header">
                    <span className="cell-primary">From</span>
                    <span className="cell-to">To</span>
                    <span className="cell-center">Qty</span>
                    <span className="cell-center">Distance</span>
                    <span className="cell-right">Cost</span>
                    <span className="cell-right">Score</span>
                  </div>
                  {rebalanceList.slice(0, 6).map((rec, index) => (
                    <div
                      className="table-row clickable"
                      key={`${rec.from_dealer_id}-${index}`}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        handleNavigate(`/detail/transfer/${rec.from_dealer_id}-${index}`, {
                          title: `${rec.from_dealer} → ${rec.to_dealer}`,
                          subtitle: rec.sku_name,
                          badge: "Transfer",
                          meta: [
                            { label: "Quantity", value: rec.quantity },
                            { label: "Distance", value: `${rec.distance_km} km` },
                            { label: "Logistics Cost", value: `₹${formatNumber(rec.logistics_cost)}` },
                            { label: "Score", value: formatDecimal(rec.score) }
                          ],
                          notes: rec.explanation
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.click();
                        }
                      }}
                    >
                      <span className="cell-primary">{rec.from_dealer}</span>
                      <span className="cell-to">{rec.to_dealer}</span>
                      <span className="cell-center">{rec.quantity}</span>
                      <span className="cell-center">{rec.distance_km} km</span>
                      <span className="cell-right">₹{formatNumber(rec.logistics_cost)}</span>
                      <span className="cell-right">{formatDecimal(rec.score)}</span>
                    </div>
                  ))}
                  {rebalanceList.length === 0 && (
                    <div className="table-empty">
                      <div className="empty-icon" aria-hidden="true"></div>
                      <div>
                        <p className="empty-title">No rebalancing needed</p>
                        <p className="empty-subtitle">Inventory cover looks balanced for this SKU.</p>
                      </div>
                    </div>
                  )}
                </div>
                )}
              </div>
            </section>
          </main>
        )}

        {view === "dealer" && (
          <main className="grid grid-2x2">
            <section className="panel" ref={inventoryRef} data-focus={focusedSection === "Inventory"}>
              <div className="panel-header">
                <h2>Dealer Inventory</h2>
                <div className="panel-actions">
                  <span className="updated">Updated {formatUpdated(lastUpdated.dealer)}</span>
                  <span className="pill">Selectable rows</span>
                </div>
              </div>
              <div className="table-container table-container--sm">
                {renderPanelState(dealerLoading, dealerError, reloadDealer, "Loading inventory…") || (
                  <div className="table table-3">
                  <div className="table-row header">
                    <span className="cell-primary">SKU</span>
                    <span className="cell-center">Quantity</span>
                    <span className="cell-muted">Last Received</span>
                  </div>
                  {inventoryList.map((item) => {
                    const sku = skus.find((s) => s.id === item.sku_id);
                    const lowStock = item.quantity <= 80;
                    return (
                      <div
                        className={`table-row clickable ${lowStock ? "low-stock" : ""}`}
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          handleNavigate(`/detail/inventory/${item.id}`, {
                            title: sku?.name || "SKU",
                            subtitle: selectedDealer?.name || "Dealer",
                            badge: lowStock ? "Low stock" : "In stock",
                            meta: [
                              { label: "Quantity", value: item.quantity },
                              { label: "Last Received", value: item.last_received_date },
                              { label: "Dealer", value: selectedDealer?.name || "-" }
                            ],
                            notes: lowStock
                              ? "Low stock flagged. Consider transfer or reorder."
                              : "Inventory levels are within expected range."
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.click();
                          }
                        }}
                      >
                        <span className="cell-primary">{sku?.name || "SKU"}</span>
                        <span className="cell-center">{item.quantity}</span>
                        <span className="cell-muted">{item.last_received_date}</span>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            </section>

            <section
              className="panel alert-panel"
              ref={alertsRef}
              data-focus={focusedSection === "Risk"}
            >
              <div className="panel-header">
                <h2>Risk Alerts</h2>
                <div className="panel-actions">
                  <span className="updated">Updated {formatUpdated(lastUpdated.dealer)}</span>
                  <span className="pill">Action required</span>
                </div>
              </div>
              <div className="alerts">
                {renderPanelState(dealerLoading, dealerError, reloadDealer, "Loading alerts…") || (
                  <>
                    {alertsList.map((alert, index) => (
                      <button
                        className={`alert-card ${alertTone(alert.alert_type)}`}
                        key={`${alert.sku_id}-${index}`}
                        type="button"
                        onClick={() =>
                          handleNavigate(`/detail/alert/${alert.sku_id}-${index}`, {
                            title: alert.alert_type,
                            subtitle: alert.sku_name,
                            badge: alertToneLabel(alert.alert_type),
                            meta: [
                              { label: "Action", value: alert.recommended_action },
                              { label: "Confidence", value: formatDecimal(alert.confidence) },
                              { label: "Dealer", value: alert.dealer_name }
                            ],
                            notes: alert.reasoning
                          })
                        }
                      >
                        <div className="alert-head">
                          <div>
                            <h4>{alert.alert_type}</h4>
                            <p className="alert-sku">{alert.sku_name}</p>
                          </div>
                          <span className={`alert-badge ${alertTone(alert.alert_type)}`}>
                            {alertToneLabel(alert.alert_type)}
                          </span>
                        </div>
                        <div className="alert-meta">
                          <span>
                            Action <strong>{alert.recommended_action}</strong>
                          </span>
                          <span>
                            Confidence <strong>{formatDecimal(alert.confidence)}</strong>
                          </span>
                        </div>
                        <p className="alert-reason">{alert.reasoning}</p>
                      </button>
                    ))}
                    {alertsList.length === 0 && (
                      <div className="empty-state">
                        <div className="empty-icon" aria-hidden="true"></div>
                        <div>
                          <p className="empty-title">No critical alerts</p>
                          <p className="empty-subtitle">
                            Inventory risk is within expected bounds.
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

            <section className="panel" ref={transferRef} data-focus={focusedSection === "Actions"}>
              <div className="panel-header">
                <h2>Transfer Suggestions</h2>
                <div className="panel-actions">
                  <span className="updated">Updated {formatUpdated(lastUpdated.rebalance)}</span>
                  <span className="pill">Selectable rows</span>
                </div>
              </div>
              <div className="table-container table-container--md">
                {renderPanelState(
                  rebalanceLoading,
                  rebalanceError,
                  reloadRebalance,
                  "Loading transfers…"
                ) || (
                  <div className="table table-6">
                  <div className="table-row header">
                    <span className="cell-primary">From</span>
                    <span className="cell-to">To</span>
                    <span className="cell-center">Qty</span>
                    <span className="cell-center">Distance</span>
                    <span className="cell-right">Cost</span>
                    <span className="cell-right">Score</span>
                  </div>
                  {dealerTransfers.map((rec, index) => (
                    <div
                      className="table-row clickable"
                      key={`${rec.from_dealer_id}-${rec.to_dealer_id}-${index}`}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        handleNavigate(`/detail/transfer/${rec.from_dealer_id}-${rec.to_dealer_id}`, {
                          title: `${rec.from_dealer} → ${rec.to_dealer}`,
                          subtitle: rec.sku_name,
                          badge: "Transfer",
                          meta: [
                            { label: "Quantity", value: rec.quantity },
                            { label: "Distance", value: `${rec.distance_km} km` },
                            { label: "Logistics Cost", value: `₹${formatNumber(rec.logistics_cost)}` },
                            { label: "Score", value: formatDecimal(rec.score) }
                          ],
                          notes: rec.explanation
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.click();
                        }
                      }}
                    >
                      <span className="cell-primary">{rec.from_dealer}</span>
                      <span className="cell-to">{rec.to_dealer}</span>
                      <span className="cell-center">{rec.quantity}</span>
                      <span className="cell-center">{rec.distance_km} km</span>
                      <span className="cell-right">₹{formatNumber(rec.logistics_cost)}</span>
                      <span className="cell-right">{formatDecimal(rec.score)}</span>
                    </div>
                  ))}
                  {dealerTransfers.length === 0 && (
                    <div className="table-empty">
                      <div className="empty-icon" aria-hidden="true"></div>
                      <div>
                        <p className="empty-title">No transfer actions</p>
                        <p className="empty-subtitle">This dealer is balanced for the selected SKU.</p>
                      </div>
                    </div>
                  )}
                </div>
                )}
              </div>
            </section>

            <section className="panel" ref={mixRef} data-focus={focusedSection === "Signals"}>
              <div className="panel-header">
                <h2>Regional Inventory Mix</h2>
                <div className="panel-actions">
                  <span className="updated">Updated {formatUpdated(lastUpdated.base)}</span>
                  <span className="pill">Fixed scale</span>
                </div>
              </div>
              <div className="chart-container">
                {renderPanelState(baseLoading, baseError, reloadBase, "Loading inventory mix…") || (
                  <Bar
                  data={{
                    labels: regionInventoryData.labels,
                    datasets: [
        {
          label: "Inventory Units",
          data: regionInventoryData.values,
          backgroundColor: [
            "rgba(79, 70, 229, 0.65)",
            "rgba(14, 165, 233, 0.65)",
            "rgba(16, 185, 129, 0.65)",
            "rgba(245, 158, 11, 0.65)",
            "rgba(239, 68, 68, 0.65)"
          ]
        }
      ]
    }}
    options={{
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { color: "#64748b" } } },
      scales: {
        x: {
          ticks: { color: "#64748b", font: { size: 11 } },
          grid: { display: false }
        },
        y: {
          ticks: {
            color: "#64748b",
            font: { size: 11 },
            callback: (value) => formatNumber(value)
          },
          grid: { color: "rgba(148, 163, 184, 0.35)" }
        }
                    }
                  }}
                />
                )}
              </div>
            </section>
          </main>
        )}
      </div>
    </div>
  );
};

const AppContent = () => {
  const [view, setView] = useState("admin");
  const [summary, setSummary] = useState(null);
  const [dealers, setDealers] = useState([]);
  const [skus, setSkus] = useState([]);
  const [regions, setRegions] = useState([]);
  const [health, setHealth] = useState([]);
  const [networkInventory, setNetworkInventory] = useState([]);
  const [selectedSku, setSelectedSku] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [selectedDealer, setSelectedDealer] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [rebalance, setRebalance] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [baseLoading, setBaseLoading] = useState(true);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [rebalanceLoading, setRebalanceLoading] = useState(false);
  const [dealerLoading, setDealerLoading] = useState(false);
  const [whatIfLoading, setWhatIfLoading] = useState(false);
  const [baseError, setBaseError] = useState(null);
  const [forecastError, setForecastError] = useState(null);
  const [rebalanceError, setRebalanceError] = useState(null);
  const [dealerError, setDealerError] = useState(null);
  const [whatIfError, setWhatIfError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState({
    base: null,
    forecast: null,
    rebalance: null,
    dealer: null,
    whatIf: null
  });
  const [timeHorizon, setTimeHorizon] = useState(30);
  const [whatIfPercent, setWhatIfPercent] = useState(10);
  const [whatIfEvent, setWhatIfEvent] = useState("Monsoon Month (Jun-Sep)");
  const [whatIfForecast, setWhatIfForecast] = useState(null);
  const [error, setError] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const whatIfTimerRef = useRef(null);
  const [maxChartPoints, setMaxChartPoints] = useState(
    typeof window !== "undefined" && window.innerWidth < 900 ? 30 : 60
  );

  const markUpdated = useCallback((key) => {
    setLastUpdated((prev) => ({ ...prev, [key]: new Date() }));
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setMaxChartPoints(window.innerWidth < 900 ? 30 : 60);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const loadBase = useCallback(async () => {
    setBaseLoading(true);
    setBaseError(null);
    try {
      const [summaryRes, dealerRes, skuRes, regionRes, healthRes, inventoryRes] =
        await Promise.all([
          fetchJson("/api/summary"),
          fetchJson("/api/dealers"),
          fetchJson("/api/skus"),
          fetchJson("/api/regions"),
          fetchJson("/api/health/dealers"),
          fetchJson("/api/inventory")
        ]);

      const hasData = dealerRes.length > 0 && skuRes.length > 0;
      const useDemo = DEMO_MODE && !hasData;
      const baseSummary = useDemo ? demoFixtures.summary : summaryRes;
      const baseDealers = useDemo ? demoFixtures.dealers : dealerRes;
      const baseSkus = useDemo ? demoFixtures.skus : skuRes;
      const baseRegions = useDemo ? demoFixtures.regions : regionRes;
      const baseHealth = useDemo ? demoFixtures.health : healthRes;
      const baseInventory = useDemo ? demoFixtures.inventory : inventoryRes;

      setDemoMode(useDemo);
      setSummary(baseSummary);
      setDealers(baseDealers);
      setSkus(baseSkus);
      setRegions(baseRegions);
      setHealth(baseHealth);
      setNetworkInventory(baseInventory);

      if (baseSkus.length > 0) setSelectedSku(baseSkus[0]);
      if (baseRegions.length > 0) setSelectedRegion(baseRegions[0]);
      if (baseDealers.length > 0) setSelectedDealer(baseDealers[0]);

      markUpdated("base");
      setError(null);
    } catch (err) {
      if (DEMO_MODE) {
        setDemoMode(true);
        setSummary(demoFixtures.summary);
        setDealers(demoFixtures.dealers);
        setSkus(demoFixtures.skus);
        setRegions(demoFixtures.regions);
        setHealth(demoFixtures.health);
        setNetworkInventory(demoFixtures.inventory);
        setSelectedSku(demoFixtures.skus[0]);
        setSelectedRegion(demoFixtures.regions[0]);
        setSelectedDealer(demoFixtures.dealers[0]);
        markUpdated("base");
        setError(null);
      } else {
        setBaseError(err.message);
        setError(err.message);
      }
    } finally {
      setBaseLoading(false);
    }
  }, [markUpdated]);

  useEffect(() => {
    loadBase();
  }, [loadBase]);

  const loadForecast = useCallback(async () => {
    if (!selectedSku || !selectedRegion) return;
    setForecastLoading(true);
    setForecastError(null);
    if (demoMode) {
      setForecast(buildDemoForecast(selectedSku.id, selectedRegion, timeHorizon));
      markUpdated("forecast");
      setForecastLoading(false);
      return;
    }
    try {
      const data = await fetchJson(
        `/api/forecast?sku_id=${selectedSku.id}&region=${encodeURIComponent(
          selectedRegion
        )}&horizon=${timeHorizon}`
      );
      setForecast(data);
      markUpdated("forecast");
    } catch (err) {
      if (DEMO_MODE) {
        setForecast(buildDemoForecast(selectedSku.id, selectedRegion, timeHorizon));
        markUpdated("forecast");
        setError(null);
      } else {
        setForecastError(err.message);
      }
    } finally {
      setForecastLoading(false);
    }
  }, [selectedSku, selectedRegion, demoMode, timeHorizon, markUpdated]);

  useEffect(() => {
    loadForecast();
  }, [loadForecast]);

  const loadRebalance = useCallback(async () => {
    if (!selectedSku || !selectedRegion) return;
    setRebalanceLoading(true);
    setRebalanceError(null);
    if (demoMode) {
      setRebalance(demoFixtures.rebalance);
      markUpdated("rebalance");
      setRebalanceLoading(false);
      return;
    }
    try {
      const data = await fetchJson(
        `/api/rebalance?sku_id=${selectedSku.id}&region=${encodeURIComponent(selectedRegion)}`
      );
      setRebalance(data);
      markUpdated("rebalance");
    } catch (err) {
      if (DEMO_MODE) {
        setRebalance(demoFixtures.rebalance);
        markUpdated("rebalance");
        setError(null);
      } else {
        setRebalanceError(err.message);
      }
    } finally {
      setRebalanceLoading(false);
    }
  }, [selectedSku, selectedRegion, demoMode, markUpdated]);

  useEffect(() => {
    loadRebalance();
  }, [loadRebalance]);

  const loadDealerData = useCallback(async () => {
    if (!selectedDealer) return;
    setDealerLoading(true);
    setDealerError(null);
    if (demoMode) {
      setInventory(
        demoFixtures.inventory.filter((item) => item.dealer_id === selectedDealer.id)
      );
      setAlerts(demoFixtures.alerts.filter((alert) => alert.dealer_id === selectedDealer.id));
      markUpdated("dealer");
      setDealerLoading(false);
      return;
    }
    try {
      const [inventoryRes, alertsRes] = await Promise.all([
        fetchJson(`/api/inventory?dealer_id=${selectedDealer.id}`),
        fetchJson(`/api/alerts?dealer_id=${selectedDealer.id}`)
      ]);
      setInventory(inventoryRes);
      setAlerts(alertsRes);
      markUpdated("dealer");
    } catch (err) {
      if (DEMO_MODE) {
        setInventory(
          demoFixtures.inventory.filter((item) => item.dealer_id === selectedDealer.id)
        );
        setAlerts(demoFixtures.alerts.filter((alert) => alert.dealer_id === selectedDealer.id));
        markUpdated("dealer");
        setError(null);
      } else {
        setDealerError(err.message);
      }
    } finally {
      setDealerLoading(false);
    }
  }, [selectedDealer, demoMode, markUpdated]);

  useEffect(() => {
    loadDealerData();
  }, [loadDealerData]);

  const runWhatIf = async () => {
    if (!selectedSku || !selectedRegion) return;
    setWhatIfLoading(true);
    setWhatIfError(null);
    if (demoMode) {
      const base = buildDemoForecast(selectedSku.id, selectedRegion, timeHorizon, 120);
      const multiplier = 1 + whatIfPercent / 100;
      const baseDates = resolvePointDates(base.points);
      const eventCurve = buildEventMultiplier(whatIfEvent, baseDates, { dealer: selectedDealer });
      const round = (value) => Math.round(value * 10) / 10;
      const points = base.points.map((point, index) => {
        const eventMultiplier = eventCurve[index] ?? 1;
        const combined = multiplier * eventMultiplier;
        return {
          ...point,
          date: baseDates[index] ?? point.date,
          forecast: round(point.forecast * combined),
          lower: round(point.lower * combined),
          upper: round(point.upper * combined)
        };
      });
      const sign = whatIfPercent >= 0 ? "+" : "";
      const profile = EVENT_PROFILES[whatIfEvent];
      const eventImpact = profile
        ? `${formatImpact(profile.avgImpact)} avg, peak ${formatImpact(profile.peakImpact)}`
        : "custom";
      setWhatIfForecast({
        ...base,
        explanation: `Demo what-if: baseline ${sign}${Math.round(
          whatIfPercent
        )}% with ${whatIfEvent} profile (${eventImpact}).`,
        points
      });
      markUpdated("whatIf");
      setWhatIfLoading(false);
      return;
    }
    try {
      const data = await fetchJson("/api/simulate/whatif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku_id: selectedSku.id,
          region: selectedRegion,
          horizon: timeHorizon,
          percent_change: whatIfPercent,
          event_tag: whatIfEvent
        })
      });
      const profile = EVENT_PROFILES[whatIfEvent];
      if (profile && Array.isArray(data.points)) {
        const dates = resolvePointDates(data.points);
        const curve = buildEventMultiplier(whatIfEvent, dates, { dealer: selectedDealer });
        const avgCurve =
          curve.reduce((sum, value) => sum + value, 0) / Math.max(1, curve.length);
        const normalized = curve.map((value) => value / (avgCurve || 1));
        const round = (value) => Math.round(value * 10) / 10;
        const points = data.points.map((point, index) => {
          const multiplier = normalized[index] ?? 1;
          return {
            ...point,
            date: dates[index] ?? point.date,
            forecast: round(point.forecast * multiplier),
            lower: round(point.lower * multiplier),
            upper: round(point.upper * multiplier)
          };
        });
        setWhatIfForecast({
          ...data,
          points,
          explanation: `${data.explanation || "What-if forecast"} Event profile: ${whatIfEvent} (${formatImpact(
            profile.avgImpact
          )} avg, peak ${formatImpact(profile.peakImpact)}).`
        });
      } else {
        setWhatIfForecast(data);
      }
      markUpdated("whatIf");
    } catch (err) {
      if (DEMO_MODE) {
        const base = buildDemoForecast(selectedSku.id, selectedRegion, timeHorizon, 120);
        const multiplier = 1 + whatIfPercent / 100;
        const baseDates = resolvePointDates(base.points);
        const eventCurve = buildEventMultiplier(whatIfEvent, baseDates, { dealer: selectedDealer });
        const round = (value) => Math.round(value * 10) / 10;
        const points = base.points.map((point, index) => {
          const eventMultiplier = eventCurve[index] ?? 1;
          const combined = multiplier * eventMultiplier;
          return {
            ...point,
            date: baseDates[index] ?? point.date,
            forecast: round(point.forecast * combined),
            lower: round(point.lower * combined),
            upper: round(point.upper * combined)
          };
        });
        const sign = whatIfPercent >= 0 ? "+" : "";
        const profile = EVENT_PROFILES[whatIfEvent];
        const eventImpact = profile
          ? `${formatImpact(profile.avgImpact)} avg, peak ${formatImpact(profile.peakImpact)}`
          : "custom";
        setWhatIfForecast({
          ...base,
          explanation: `Demo what-if: baseline ${sign}${Math.round(
            whatIfPercent
          )}% with ${whatIfEvent} profile (${eventImpact}).`,
          points
        });
        markUpdated("whatIf");
        setError(null);
      } else {
        setWhatIfError(err.message);
      }
    } finally {
      setWhatIfLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedSku || !selectedRegion) return;
    if (baseLoading) return;
    if (whatIfTimerRef.current) {
      window.clearTimeout(whatIfTimerRef.current);
    }
    whatIfTimerRef.current = window.setTimeout(() => {
      runWhatIf();
    }, 250);
    return () => {
      if (whatIfTimerRef.current) {
        window.clearTimeout(whatIfTimerRef.current);
      }
    };
  }, [selectedSku, selectedRegion, whatIfPercent, whatIfEvent, demoMode, timeHorizon, baseLoading]);

  const regionInventoryData = useMemo(() => {
    const items = Array.isArray(networkInventory) ? networkInventory : [];
    const totals = new Map();
    items.forEach((item) => {
      const dealer = dealers.find((d) => d.id === item.dealer_id);
      if (!dealer) return;
      totals.set(dealer.region, (totals.get(dealer.region) || 0) + item.quantity);
    });
    return {
      labels: Array.from(totals.keys()),
      values: Array.from(totals.values())
    };
  }, [networkInventory, dealers]);

  const forecastChart = useMemo(() => {
    if (!forecast || !Array.isArray(forecast.points)) return null;
    const sampledPoints = downsamplePoints(forecast.points, maxChartPoints);
    const labels = resolvePointDates(sampledPoints);
    return {
      labels,
      datasets: [
        {
          label: "Forecast",
          data: sampledPoints.map((p) => p.forecast),
          borderColor: "rgba(79, 70, 229, 0.9)",
          backgroundColor: "rgba(79, 70, 229, 0.18)",
          tension: 0.35,
          fill: true,
          pointRadius: 2,
          pointHoverRadius: 5,
          pointBackgroundColor: "rgba(79, 70, 229, 0.85)",
          pointBorderColor: "#ffffff",
          pointHoverBackgroundColor: "rgba(14, 165, 233, 0.95)",
          pointHoverBorderColor: "#ffffff"
        },
        {
          label: "Lower",
          data: sampledPoints.map((p) => p.lower),
          borderColor: "rgba(14, 165, 233, 0.55)",
          borderDash: [6, 4],
          pointRadius: 0,
          pointHoverRadius: 3
        },
        {
          label: "Upper",
          data: sampledPoints.map((p) => p.upper),
          borderColor: "rgba(245, 158, 11, 0.55)",
          borderDash: [6, 4],
          pointRadius: 0,
          pointHoverRadius: 3
        }
      ]
    };
  }, [forecast, maxChartPoints]);

  const whatIfChart = useMemo(() => {
    if (!whatIfForecast || !Array.isArray(whatIfForecast.points)) return null;
    const sampledPoints = downsamplePoints(whatIfForecast.points, maxChartPoints);
    const labels = resolvePointDates(sampledPoints);
    return {
      labels,
      datasets: [
        {
          label: "What-if Forecast",
          data: sampledPoints.map((p) => p.forecast),
          borderColor: "rgba(14, 165, 233, 0.9)",
          backgroundColor: "rgba(14, 165, 233, 0.18)",
          tension: 0.35,
          fill: true,
          pointRadius: 2,
          pointHoverRadius: 5,
          pointBackgroundColor: "rgba(14, 165, 233, 0.85)",
          pointBorderColor: "#ffffff",
          pointHoverBackgroundColor: "rgba(79, 70, 229, 0.95)",
          pointHoverBorderColor: "#ffffff"
        }
      ]
    };
  }, [whatIfForecast, maxChartPoints]);

  const lineChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      elements: { point: { radius: 2, hoverRadius: 5 } },
      plugins: {
        legend: { position: "bottom", labels: { color: "#64748b", boxWidth: 10 } }
      },
      scales: {
        x: {
          ticks: {
            color: "#64748b",
            maxTicksLimit: Math.min(10, timeHorizon),
            autoSkipPadding: 14,
            callback: formatDateTick
          },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: "#64748b",
            callback: (value) => formatNumber(value)
          },
          grid: { color: "rgba(148, 163, 184, 0.35)" }
        }
      }
    }),
    [timeHorizon]
  );

  return (
    <Routes>
      <Route
        path="/"
        element={
          <Dashboard
            view={view}
            setView={setView}
            summary={summary}
            dealers={dealers}
            skus={skus}
            regions={regions}
            health={health}
            selectedSku={selectedSku}
            setSelectedSku={setSelectedSku}
            selectedRegion={selectedRegion}
            setSelectedRegion={setSelectedRegion}
            selectedDealer={selectedDealer}
            setSelectedDealer={setSelectedDealer}
            forecast={forecast}
            rebalance={rebalance}
            inventory={inventory}
            alerts={alerts}
            baseLoading={baseLoading}
            forecastLoading={forecastLoading}
            rebalanceLoading={rebalanceLoading}
            dealerLoading={dealerLoading}
            whatIfLoading={whatIfLoading}
            baseError={baseError}
            forecastError={forecastError}
            rebalanceError={rebalanceError}
            dealerError={dealerError}
            whatIfError={whatIfError}
            lastUpdated={lastUpdated}
            reloadBase={loadBase}
            reloadForecast={loadForecast}
            reloadRebalance={loadRebalance}
            reloadDealer={loadDealerData}
            timeHorizon={timeHorizon}
            setTimeHorizon={setTimeHorizon}
            whatIfPercent={whatIfPercent}
            setWhatIfPercent={setWhatIfPercent}
            whatIfEvent={whatIfEvent}
            setWhatIfEvent={setWhatIfEvent}
            whatIfForecast={whatIfForecast}
            runWhatIf={runWhatIf}
            regionInventoryData={regionInventoryData}
            lineChartOptions={lineChartOptions}
            forecastChart={forecastChart}
            whatIfChart={whatIfChart}
            demoMode={demoMode}
          />
        }
      />
      <Route path="/detail/:type/:id" element={<DetailPage />} />
    </Routes>
  );
};

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
