#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Rule-based extreme-weather payload generator (for dashboard).

What it outputs:
- backend/data/model_outputs/weather_extreme_hourly_payload.json
  {
    "ok": true,
    "updatedAt": "...",
    "cities": {
      "北京": {
        "horizonHours": 168,
        "points": [
          {
            "ts": "2026-03-26T10:00:00Z",
            "time": "10:00",
            "temp_c": 12.3,
            "humidity": 55,
            "wind_speed": 3.4,
            "pressure_hpa": 1012,
            "precip_mm": 0.7
          },
          ...
        ]
      }
    }
  }

Notes:
- It uses the latest available "time" from the CSV as historical data.
- For each future hour, if CSV already has that hour, it uses it directly.
  Otherwise it extrapolates using last-7-days hour-of-day means for each city.
- Extreme type classification/strength is computed in frontend (WeatherAlertPanel.vue)
  based on meteo points. This script only forecasts meteo variables per hour.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd


VARS = ["温度", "湿度", "风速", "气压", "降水量"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate extreme-weather hourly payload for dashboard")
    parser.add_argument(
        "--csv",
        type=str,
        default=str(Path(__file__).resolve().parents[2] / "weather_air_14days_full.csv"),
        help="Input weather CSV path",
    )
    parser.add_argument("--cities", type=str, default="", help="Optional comma-separated city names")
    parser.add_argument("--horizon-hours", type=int, default=168, help="Forecast horizon hours (24~168)")
    parser.add_argument(
        "--output",
        type=str,
        default=str(Path(__file__).resolve().parents[1] / "backend" / "data" / "model_outputs" / "weather_extreme_hourly_payload.json"),
        help="Output JSON file path",
    )
    return parser.parse_args()


def floor_to_hour(ts: pd.Timestamp) -> pd.Timestamp:
    return ts.replace(minute=0, second=0, microsecond=0)


def ensure_numeric(df: pd.DataFrame) -> pd.DataFrame:
    for c in VARS:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def build_future_points_for_city(df_city: pd.DataFrame, anchor_floor: pd.Timestamp, horizon_hours: int) -> list[dict]:
    # Historical window for fallback extrapolation
    hist_start = anchor_floor - pd.Timedelta(days=7)
    df_hist = df_city[(df_city["时间"] >= hist_start) & (df_city["时间"] < anchor_floor)].copy()
    if df_hist.empty:
        df_hist = df_city[df_city["时间"] < anchor_floor].copy()
    if df_hist.empty:
        # last-resort: use whatever we have
        df_hist = df_city.copy()

    df_hist_means = df_hist.groupby(df_hist["时间"].dt.hour)[VARS].mean(numeric_only=True)
    overall_means = df_hist[VARS].mean(numeric_only=True)

    # Build quick index for direct usage when CSV already contains that hour
    # We floor CSV "时间" to hour to avoid mismatch.
    df_city_hour = df_city.copy()
    df_city_hour["time_floor"] = df_city_hour["时间"].dt.floor("h")
    by_hour = {int(t.hour): t for t in []}  # unused, kept for clarity
    rows_by_ts = {pd.Timestamp(t): r for t, r in df_city_hour.set_index("time_floor").iterrows()}

    points: list[dict] = []
    for i in range(horizon_hours):
        t = anchor_floor + pd.Timedelta(hours=i + 1)
        t_floor = floor_to_hour(t)

        time_txt = f"{t_floor.hour:02d}:00"

        if t_floor in rows_by_ts:
            r = rows_by_ts[t_floor]
            temp_c = r.get("温度")
            humidity = r.get("湿度")
            wind_speed = r.get("风速")
            pressure_hpa = r.get("气压")
            precip_mm = r.get("降水量")
        else:
            hour = int(t_floor.hour)
            if hour in df_hist_means.index:
                mr = df_hist_means.loc[hour]
            else:
                mr = overall_means
            temp_c = mr.get("温度")
            humidity = mr.get("湿度")
            wind_speed = mr.get("风速")
            pressure_hpa = mr.get("气压")
            precip_mm = mr.get("降水量")

        # Normalize types for frontend
        def to_optional_float(x):
            if x is None or (isinstance(x, float) and np.isnan(x)):
                return None
            return float(x)

        points.append(
            {
                "ts": t_floor.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "time": time_txt,
                "temp_c": to_optional_float(temp_c),
                "humidity": None if humidity is None or (isinstance(humidity, float) and np.isnan(humidity)) else float(humidity),
                "wind_speed": to_optional_float(wind_speed),
                "pressure_hpa": to_optional_float(pressure_hpa),
                "precip_mm": to_optional_float(precip_mm),
            }
        )
    return points


def main() -> None:
    args = parse_args()
    csv_path = Path(args.csv).resolve()
    horizon_hours = max(24, min(168, int(args.horizon_hours)))
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(csv_path, encoding="utf-8-sig")
    # Required columns
    need_cols = ["城市", "时间", *VARS]
    missing = [c for c in need_cols if c not in df.columns]
    if missing:
        raise ValueError(f"CSV missing columns: {missing}")

    df["时间"] = pd.to_datetime(df["时间"], errors="coerce")
    df = ensure_numeric(df)
    # 数据库/导出数据可能存在“部分气象因子缺失”的情况：
    # - 只要求城市/时间可用，缺失的因子保留为 NaN
    # - 后续按小时均值/回退时会自然忽略 NaN
    df = df.dropna(subset=["城市", "时间"])
    if df.empty:
        raise ValueError("No usable rows in CSV after cleaning.")

    df["城市"] = df["城市"].astype(str).str.strip()

    def norm_city(s: str) -> str:
        return str(s or "").replace(" ", "").strip()

    def city_variants(input_city: str) -> set[str]:
        base = norm_city(input_city)
        if not base:
            return set()
        # 常见尾缀互转：北京 <-> 北京市
        if base.endswith("市") and len(base) > 1:
            base_no_suffix = base[:-1]
        else:
            base_no_suffix = base
        return set([base, base_no_suffix, f"{base_no_suffix}市"])

    if args.cities.strip():
        wanted = set()
        for tok in [x.strip() for x in args.cities.split(",") if x.strip()]:
            wanted |= city_variants(tok)

        selected = []
        for city_val in sorted(df["城市"].unique().tolist()):
            cv = norm_city(city_val)
            cv_base = cv[:-1] if cv.endswith("市") and len(cv) > 1 else cv
            if cv in wanted or cv_base in wanted:
                selected.append(city_val)
        city_list = selected
    else:
        city_list = sorted(df["城市"].unique().tolist())

    anchor_floor = floor_to_hour(pd.Timestamp.now())

    cities_out: dict[str, dict] = {}
    for city in city_list:
        df_city = df[df["城市"] == city].copy()
        if df_city.empty:
            continue
        df_city = df_city.sort_values("时间")
        points = build_future_points_for_city(df_city, anchor_floor, horizon_hours)
        cities_out[city] = {"horizonHours": horizon_hours, "points": points}

    payload = {
        "ok": True,
        "updatedAt": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S"),
        "horizonHours": horizon_hours,
        "anchor": anchor_floor.strftime("%Y-%m-%d %H:%M:%S"),
        "cities": cities_out,
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[weather_extreme_predict_payload] wrote -> {output_path}", flush=True)


if __name__ == "__main__":
    main()

