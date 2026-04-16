#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Train AQI model and export dashboard linkage files.

Usage:
  python model/train_dashboard_model.py --csv ../weather_air_14days_full.csv
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

try:
    from xgboost import XGBRegressor

    HAS_XGBOOST = True
except Exception:
    HAS_XGBOOST = False


WARNING_LEVELS = [
    (50, "优", "绿色", "无预警"),
    (100, "良", "黄色", "无预警"),
    (150, "轻度污染", "橙色", "三级预警（建议减少户外活动）"),
    (200, "中度污染", "红色", "二级预警（建议佩戴口罩，减少户外停留）"),
    (9999, "重度及以上污染", "紫色", "一级预警（避免户外活动，关闭门窗）"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train AQI model for dashboard linkage")
    parser.add_argument(
        "--csv",
        type=str,
        default=str(Path(__file__).resolve().parents[2] / "weather_air_14days_full.csv"),
        help="Input CSV path",
    )
    parser.add_argument("--target-city", type=str, default="北京", help="Forecast city")
    parser.add_argument("--horizon", type=int, default=168, help="Forecast horizon hours")
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(Path(__file__).resolve().parents[1] / "backend" / "data" / "model_outputs"),
        help="Output folder for dashboard files",
    )
    return parser.parse_args()


def get_warning_level(aqi: float) -> Dict[str, str]:
    for threshold, level, color, tip in WARNING_LEVELS:
        if aqi <= threshold:
            return {"污染等级": level, "预警颜色": color, "预警提示": tip}
    return {"污染等级": "未知", "预警颜色": "灰色", "预警提示": "无"}


def risk_level_from_score(score: float) -> str:
    if score >= 80:
        return "高风险"
    if score >= 60:
        return "较高风险"
    if score >= 40:
        return "中风险"
    if score >= 20:
        return "较低风险"
    return "低风险"


def load_and_prepare(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path, encoding="utf-8-sig")
    df["时间"] = pd.to_datetime(df["时间"])

    numeric_cols = ["AQI", "PM25", "PM10", "NO2", "SO2", "O3", "CO", "温度", "湿度", "气压", "风速", "降水量"]
    for c in numeric_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    df = df.dropna(subset=["城市", "时间", "AQI", "PM25", "PM10", "NO2", "O3", "温度", "湿度", "气压", "风速", "降水量"])
    df = df[(df["AQI"] >= 0) & (df["PM25"] >= 0)]
    df = df.sort_values(["城市", "时间"]).reset_index(drop=True)

    # Time cyclic encoding.
    hour = df["小时"].astype(float)
    df["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)

    # Lag and rolling features by city.
    g = df.groupby("城市")
    df["AQI_lag_1"] = g["AQI"].shift(1)
    df["AQI_lag_2"] = g["AQI"].shift(2)
    df["AQI_roll_mean_3"] = g["AQI"].shift(1).rolling(3).mean().reset_index(level=0, drop=True)
    df["AQI_roll_mean_6"] = g["AQI"].shift(1).rolling(6).mean().reset_index(level=0, drop=True)

    for col in ["PM25", "PM10", "NO2", "O3"]:
        df[f"{col}_lag_1"] = g[col].shift(1)
        df[f"{col}_lag_2"] = g[col].shift(2)
        df[f"{col}_roll_mean_3"] = g[col].shift(1).rolling(3).mean().reset_index(level=0, drop=True)

    return df.dropna().reset_index(drop=True)


def build_pipeline(cat_features: List[str], num_features: List[str]) -> Pipeline:
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", "passthrough", num_features),
            ("cat", OneHotEncoder(handle_unknown="ignore"), cat_features),
        ]
    )
    if HAS_XGBOOST:
        reg = XGBRegressor(
            n_estimators=220,
            learning_rate=0.05,
            max_depth=6,
            subsample=0.85,
            colsample_bytree=0.85,
            random_state=42,
            objective="reg:squarederror",
        )
    else:
        reg = GradientBoostingRegressor(random_state=42)

    return Pipeline([("preprocessor", preprocessor), ("model", reg)])


def export_dashboard_bundle(
    *,
    df: pd.DataFrame,
    train_df: pd.DataFrame,
    forecast_df: pd.DataFrame,
    metrics: Dict,
    output_dir: Path,
    target_city: str,
    payload_filename: str = "dashboard_payload.json",
    variant_id: str = "",
    variant_label: str = "",
    mirror_default_payload: bool = False,
    top_features_rows_override: List[Dict] | None = None,
    top_features_by_city_override: Dict[str, List[Dict]] | None = None,
) -> None:
    """Write CSV/JSON artifacts consumed by the backend `/api/model/dashboard` route."""
    all_cities = sorted(df["城市"].dropna().astype(str).unique().tolist())
    forecast_24h_parts = []
    forecast_7d_daily_rows = []
    for city_name, g in forecast_df.groupby("城市"):
        city_sorted = g.sort_values("预测时间").copy()
        city_24h = city_sorted.head(24).copy()
        forecast_24h_parts.append(city_24h)

        city_sorted["日期"] = pd.to_datetime(city_sorted["预测时间"]).dt.strftime("%Y-%m-%d")
        daily = (
            city_sorted.groupby("日期", as_index=False)
            .agg(平均AQI=("预测AQI", "mean"), 峰值AQI=("预测AQI", "max"))
            .sort_values("日期")
            .head(7)
        )
        for _, row in daily.iterrows():
            warning = get_warning_level(float(row["峰值AQI"]))
            forecast_7d_daily_rows.append(
                {
                    "城市": city_name,
                    "日期": row["日期"],
                    "平均AQI": round(float(row["平均AQI"]), 1),
                    "峰值AQI": round(float(row["峰值AQI"]), 1),
                    "污染等级": warning["污染等级"],
                    "预警颜色": warning["预警颜色"],
                    "预警提示": warning["预警提示"],
                }
            )
    forecast_24h_df = pd.concat(forecast_24h_parts, ignore_index=True).sort_values(["城市", "预测时间"]).reset_index(
        drop=True
    )
    forecast_7d_daily_df = pd.DataFrame(forecast_7d_daily_rows)

    risk_rows = []
    for city_name, g in forecast_df.groupby("城市"):
        arr = g["预测AQI"].astype(float).values
        max_aqi = float(np.max(arr))
        mean_aqi = float(np.mean(arr))
        exceed_hours = int(np.sum(arr > 100))
        severe_hours = int(np.sum(arr > 150))
        score = (
            min(60.0, max_aqi * 0.22)
            + min(25.0, mean_aqi * 0.12)
            + min(10.0, exceed_hours * 0.9)
            + min(5.0, severe_hours * 1.2)
        )
        score = float(max(0.0, min(100.0, score)))
        risk_rows.append(
            {
                "城市": city_name,
                "riskScore": round(score, 1),
                "riskLevel": risk_level_from_score(score),
                "maxAQI24h": round(max_aqi, 1),
                "meanAQI24h": round(mean_aqi, 1),
                "exceedHours": exceed_hours,
                "severeHours": severe_hours,
            }
        )
    risk_df = pd.DataFrame(risk_rows).sort_values("riskScore", ascending=False)
    risk_by_city = {
        str(r["城市"]): {
            "riskScore": float(r["riskScore"]),
            "riskLevel": str(r["riskLevel"]),
            "maxAQI24h": float(r["maxAQI24h"]),
            "meanAQI24h": float(r["meanAQI24h"]),
            "exceedHours": int(r["exceedHours"]),
            "severeHours": int(r["severeHours"]),
        }
        for _, r in risk_df.iterrows()
    }

    update_time = pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S")
    if top_features_rows_override is not None and top_features_by_city_override is not None:
        reason_df = pd.DataFrame(top_features_rows_override)
        top_features_by_city = top_features_by_city_override
    else:
        corr_cols = [
            "温度",
            "湿度",
            "气压",
            "风速",
            "降水量",
            "小时",
            "工作日",
            "AQI_lag_1",
            "AQI_lag_2",
            "AQI_roll_mean_3",
        ]
        reason_rows = []
        top_features_by_city = {}
        for city_name in all_cities:
            city_train = train_df[train_df["城市"] == city_name]
            if len(city_train) < 24:
                continue
            city_corr = city_train[corr_cols + ["AQI"]].corr(numeric_only=True)["AQI"].drop("AQI")
            rows = []
            for name, v in city_corr.abs().sort_values(ascending=False).head(8).items():
                item = {
                    "城市": city_name,
                    "特征": str(name),
                    "重要性": round(float(v), 4),
                    "更新时间": update_time,
                }
                rows.append(item)
                reason_rows.append(item)
            top_features_by_city[city_name] = rows
        reason_df = pd.DataFrame(reason_rows)

    latest_date = pd.to_datetime(df["时间"]).dt.date.max()
    rank_df = (
        df[pd.to_datetime(df["时间"]).dt.date == latest_date]
        .groupby("城市", as_index=False)["AQI"]
        .mean()
        .sort_values("AQI", ascending=False)
        .rename(columns={"AQI": "平均AQI"})
    )
    rank_df["日期"] = str(latest_date)
    rank_df["排名"] = np.arange(1, len(rank_df) + 1)
    rank_df = rank_df[["日期", "城市", "平均AQI", "排名"]]

    forecast_24h_df.to_csv(output_dir / "forecast_24h.csv", index=False, encoding="utf-8-sig")
    forecast_7d_daily_df.to_csv(output_dir / "forecast_7d_daily.csv", index=False, encoding="utf-8-sig")
    reason_df.to_csv(output_dir / "reason_top_features.csv", index=False, encoding="utf-8-sig")
    rank_df.to_csv(output_dir / "city_rank.csv", index=False, encoding="utf-8-sig")
    risk_df.to_csv(output_dir / "city_risk_score.csv", index=False, encoding="utf-8-sig")

    payload = {
        "ok": True,
        "updatedAt": update_time,
        "targetCity": target_city,
        "variantId": variant_id or None,
        "variantLabel": variant_label or None,
        "metrics": metrics,
        "forecast24h": forecast_24h_df.to_dict(orient="records"),
        "forecast7dDaily": forecast_7d_daily_df.to_dict(orient="records"),
        "riskByCity": risk_by_city,
        "cityRiskTop10": risk_df.head(10).to_dict(orient="records"),
        "topFeatures": reason_df.to_dict(orient="records"),
        "topFeaturesByCity": top_features_by_city,
        "cityRankTop10": rank_df.head(10).to_dict(orient="records"),
    }
    payload_text = json.dumps(payload, ensure_ascii=False, indent=2)
    (output_dir / payload_filename).write_text(payload_text, encoding="utf-8")
    if mirror_default_payload and payload_filename != "dashboard_payload.json":
        (output_dir / "dashboard_payload.json").write_text(payload_text, encoding="utf-8")

    print(f"[模型] 模型训练与大屏数据导出完成 -> {output_dir}", flush=True)
    print(json.dumps(metrics, ensure_ascii=False), flush=True)


def main() -> None:
    args = parse_args()
    csv_path = Path(args.csv).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"[模型] 读取数据: {csv_path}", flush=True)

    df = load_and_prepare(csv_path)
    print(f"[模型] 数据准备完成, 样本数: {len(df)}", flush=True)
    cat_features = ["城市", "风向", "天气"]
    num_features = [
        "温度",
        "湿度",
        "气压",
        "风速",
        "降水量",
        "小时",
        "工作日",
        "月份",
        "星期",
        "hour_sin",
        "hour_cos",
        "AQI_lag_1",
        "AQI_lag_2",
        "AQI_roll_mean_3",
        "AQI_roll_mean_6",
        "PM25_lag_1",
        "PM25_lag_2",
        "PM25_roll_mean_3",
        "PM10_lag_1",
        "PM10_lag_2",
        "PM10_roll_mean_3",
        "NO2_lag_1",
        "NO2_lag_2",
        "NO2_roll_mean_3",
        "O3_lag_1",
        "O3_lag_2",
        "O3_roll_mean_3",
    ]
    feature_cols = num_features + cat_features

    # Time split to avoid leakage.
    split_ts = df["时间"].quantile(0.8)
    train_df = df[df["时间"] <= split_ts].copy()
    test_df = df[df["时间"] > split_ts].copy()
    if len(train_df) < 100 or len(test_df) < 50:
        raise ValueError("样本过少，无法完成稳定训练，请检查输入数据。")

    # 训练多污染物回归模型（同一特征集，分别预测：AQI / PM2.5 / PM10 / NO2 / O3）
    model_targets = ["AQI", "PM25", "PM10", "NO2", "O3"]
    models = {}
    print("[模型] 开始训练回归模型...", flush=True)
    for t in model_targets:
        reg = build_pipeline(cat_features=cat_features, num_features=num_features)
        reg.fit(train_df[feature_cols], train_df[t])
        models[t] = reg
    print("[模型] 训练完成, 开始生成各城市预测...", flush=True)

    pred_aqi = models["AQI"].predict(test_df[feature_cols])
    metrics = {
        "mae": round(float(mean_absolute_error(test_df["AQI"], pred_aqi)), 3),
        "rmse": round(float(mean_squared_error(test_df["AQI"], pred_aqi) ** 0.5), 3),
        "r2": round(float(r2_score(test_df["AQI"], pred_aqi)), 4),
        "train_rows": int(len(train_df)),
        "test_rows": int(len(test_df)),
        "model": "XGBoost" if HAS_XGBOOST else "GradientBoostingRegressor",
        "split_time": str(pd.to_datetime(split_ts)),
    }

    target_city = args.target_city
    horizon = int(args.horizon)
    all_cities = sorted(df["城市"].dropna().astype(str).unique().tolist())
    forecast_rows = []

    total_cities = len(all_cities)
    for idx, city_name in enumerate(all_cities, start=1):
        city_df = df[df["城市"] == city_name].sort_values("时间").copy()
        if len(city_df) < 12:
            continue

        latest = city_df.iloc[-1].copy()
        # 初始化：用于递归预测时的滞后/滚动统计
        lag1_aqi = float(latest["AQI_lag_1"])
        lag2_aqi = float(latest["AQI_lag_2"])
        roll3_aqi = float(latest["AQI_roll_mean_3"])
        roll6_aqi = float(latest["AQI_roll_mean_6"])

        lag1_pm25 = float(latest["PM25_lag_1"])
        lag2_pm25 = float(latest["PM25_lag_2"])
        roll3_pm25 = float(latest["PM25_roll_mean_3"])

        lag1_pm10 = float(latest["PM10_lag_1"])
        lag2_pm10 = float(latest["PM10_lag_2"])
        roll3_pm10 = float(latest["PM10_roll_mean_3"])

        lag1_no2 = float(latest["NO2_lag_1"])
        lag2_no2 = float(latest["NO2_lag_2"])
        roll3_no2 = float(latest["NO2_roll_mean_3"])

        lag1_o3 = float(latest["O3_lag_1"])
        lag2_o3 = float(latest["O3_lag_2"])
        roll3_o3 = float(latest["O3_roll_mean_3"])

        city_meteo = city_df[["温度", "湿度", "气压", "风速", "降水量", "风向", "天气"]].tail(72)
        meteo_mean = {
            "温度": float(city_meteo["温度"].mean()),
            "湿度": float(city_meteo["湿度"].mean()),
            "气压": float(city_meteo["气压"].mean()),
            "风速": float(city_meteo["风速"].mean()),
            "降水量": float(city_meteo["降水量"].mean()),
            "风向": str(city_meteo["风向"].mode().iloc[0]),
            "天气": str(city_meteo["天气"].mode().iloc[0]),
        }

        start_ts = pd.to_datetime(city_df["时间"].max()) + pd.Timedelta(hours=1)
        for step in range(horizon):
            ts = start_ts + pd.Timedelta(hours=step)
            hour = ts.hour
            weekday = ts.dayofweek
            month = ts.month
            row = {
                "城市": city_name,
                "温度": meteo_mean["温度"],
                "湿度": meteo_mean["湿度"],
                "气压": meteo_mean["气压"],
                "风速": meteo_mean["风速"],
                "降水量": meteo_mean["降水量"],
                "小时": hour,
                "工作日": 1 if weekday < 5 else 0,
                "月份": month,
                "星期": weekday,
                "hour_sin": float(np.sin(2 * np.pi * hour / 24.0)),
                "hour_cos": float(np.cos(2 * np.pi * hour / 24.0)),
                "AQI_lag_1": lag1_aqi,
                "AQI_lag_2": lag2_aqi,
                "AQI_roll_mean_3": roll3_aqi,
                "AQI_roll_mean_6": roll6_aqi,
                "PM25_lag_1": lag1_pm25,
                "PM25_lag_2": lag2_pm25,
                "PM25_roll_mean_3": roll3_pm25,
                "PM10_lag_1": lag1_pm10,
                "PM10_lag_2": lag2_pm10,
                "PM10_roll_mean_3": roll3_pm10,
                "NO2_lag_1": lag1_no2,
                "NO2_lag_2": lag2_no2,
                "NO2_roll_mean_3": roll3_no2,
                "O3_lag_1": lag1_o3,
                "O3_lag_2": lag2_o3,
                "O3_roll_mean_3": roll3_o3,
                "风向": meteo_mean["风向"],
                "天气": meteo_mean["天气"],
            }
            input_df = pd.DataFrame([row])[feature_cols]

            aqi_hat = float(models["AQI"].predict(input_df)[0])
            pm25_hat = float(models["PM25"].predict(input_df)[0])
            pm10_hat = float(models["PM10"].predict(input_df)[0])
            no2_hat = float(models["NO2"].predict(input_df)[0])
            o3_hat = float(models["O3"].predict(input_df)[0])

            # 浓度/指数一般不应为负
            aqi_hat = max(0.0, aqi_hat)
            pm25_hat = max(0.0, pm25_hat)
            pm10_hat = max(0.0, pm10_hat)
            no2_hat = max(0.0, no2_hat)
            o3_hat = max(0.0, o3_hat)

            row_out = {
                "预测时间": ts.strftime("%Y-%m-%d %H:%M:%S"),
                "城市": city_name,
                "预测AQI": round(aqi_hat, 1),
                "预测PM25": round(pm25_hat, 1),
                "预测PM10": round(pm10_hat, 1),
                "预测O3": round(o3_hat, 1),
                "预测NO2": round(no2_hat, 1),
            }
            row_out.update(get_warning_level(aqi_hat))
            forecast_rows.append(row_out)

            # 更新递归状态
            lag2_aqi = lag1_aqi
            lag1_aqi = aqi_hat
            roll3_aqi = (roll3_aqi * 2 + aqi_hat) / 3
            roll6_aqi = (roll6_aqi * 5 + aqi_hat) / 6

            lag2_pm25 = lag1_pm25
            lag1_pm25 = pm25_hat
            roll3_pm25 = (roll3_pm25 * 2 + pm25_hat) / 3

            lag2_pm10 = lag1_pm10
            lag1_pm10 = pm10_hat
            roll3_pm10 = (roll3_pm10 * 2 + pm10_hat) / 3

            lag2_no2 = lag1_no2
            lag1_no2 = no2_hat
            roll3_no2 = (roll3_no2 * 2 + no2_hat) / 3

            lag2_o3 = lag1_o3
            lag1_o3 = o3_hat
            roll3_o3 = (roll3_o3 * 2 + o3_hat) / 3
        if idx % 20 == 0 or idx == total_cities:
            print(f"[模型] 预测进度: {idx}/{total_cities} 城市", flush=True)

    forecast_df = pd.DataFrame(forecast_rows)
    export_dashboard_bundle(
        df=df,
        train_df=train_df,
        forecast_df=forecast_df,
        metrics=metrics,
        output_dir=output_dir,
        target_city=target_city,
        payload_filename="dashboard_tree_payload.json",
        variant_id="tree",
        variant_label="梯度提升树（XGBoost / sklearn）",
        mirror_default_payload=True,
    )


if __name__ == "__main__":
    main()

