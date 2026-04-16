#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Train multi-target LSTM and export the same dashboard artifacts as train_dashboard_model.py.

Outputs (default: backend/data/model_outputs/):
  - dashboard_payload.json, forecast_24h.csv, forecast_7d_daily.csv, ...
  - dashboard_lstm.pt (weights + hyperparameters)
  - dashboard_lstm_scalers.joblib (sklearn MinMaxScalers)

Requires: torch (see model/requirements-lstm.txt)

Usage:
  python model/train_dashboard_lstm_model.py --csv ../weather_air_14days_full.csv
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Tuple

_MODEL_DIR = Path(__file__).resolve().parent
if str(_MODEL_DIR) not in sys.path:
    sys.path.insert(0, str(_MODEL_DIR))

import joblib
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.preprocessing import MinMaxScaler

from train_dashboard_model import export_dashboard_bundle, get_warning_level, load_and_prepare

FEATURE_COLS = [
    "PM25",
    "PM10",
    "NO2",
    "O3",
    "温度",
    "湿度",
    "气压",
    "风速",
    "降水量",
    "hour_sin",
    "hour_cos",
]
TARGET_COLS = ["AQI", "PM25", "PM10", "NO2", "O3"]
N_TARGETS = len(TARGET_COLS)


class MultiPollutantLSTM(nn.Module):
    def __init__(
        self,
        input_size: int,
        num_cities: int,
        emb_dim: int = 8,
        hidden_size: int = 128,
        num_layers: int = 2,
        output_len: int = 168,
        n_targets: int = N_TARGETS,
    ) -> None:
        super().__init__()
        self.output_len = output_len
        self.n_targets = n_targets
        self.embedding = nn.Embedding(num_cities, emb_dim)
        self.lstm = nn.LSTM(
            input_size + emb_dim,
            hidden_size,
            num_layers,
            batch_first=True,
            dropout=0.1 if num_layers > 1 else 0.0,
        )
        self.fc = nn.Linear(hidden_size, output_len * n_targets)

    def forward(self, x: torch.Tensor, city_ids: torch.Tensor) -> torch.Tensor:
        emb = self.embedding(city_ids)  # [B, emb_dim]
        emb = emb.unsqueeze(1).repeat(1, x.size(1), 1)
        x = torch.cat([x, emb], dim=2)
        out, _ = self.lstm(x)
        out = out[:, -1, :]
        out = self.fc(out)
        return out.view(-1, self.output_len, self.n_targets)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="LSTM dashboard model (same outputs as tree pipeline)")
    p.add_argument(
        "--csv",
        type=str,
        default=str(Path(__file__).resolve().parents[2] / "weather_air_14days_full.csv"),
    )
    p.add_argument("--target-city", type=str, default="北京")
    p.add_argument("--horizon", type=int, default=168, help="Forecast hours (matches tree model default)")
    p.add_argument("--input-len", type=int, default=24)
    p.add_argument("--hidden-size", type=int, default=128)
    p.add_argument("--city-emb-dim", type=int, default=8)
    p.add_argument("--num-layers", type=int, default=2)
    p.add_argument("--epochs", type=int, default=40)
    p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--lr", type=float, default=0.001)
    p.add_argument(
        "--metrics-horizon",
        type=int,
        default=24,
        help="用于 MAE/RMSE/R2 的边界测试步数（通常小于等于测试段长度）",
    )
    p.add_argument(
        "--output-dir",
        type=str,
        default=str(Path(__file__).resolve().parents[1] / "backend" / "data" / "model_outputs"),
    )
    return p.parse_args()


def sequences_for_city(
    city_df: pd.DataFrame,
    split_ts: pd.Timestamp,
    scaler_X: MinMaxScaler,
    scaler_y: MinMaxScaler,
    city_id: int,
    input_len: int,
    output_len: int,
    mode: str,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    city_df = city_df.sort_values("时间").reset_index(drop=True)
    n = len(city_df)
    if n < input_len + output_len:
        return np.array([]), np.array([]), np.array([])
    Xf = scaler_X.transform(city_df[FEATURE_COLS].values.astype(np.float64))
    Yf = scaler_y.transform(city_df[TARGET_COLS].values.astype(np.float64))
    X_list: List[np.ndarray] = []
    Y_list: List[np.ndarray] = []
    C_list: List[int] = []
    split_ts = pd.Timestamp(split_ts)
    for i in range(n - input_len - output_len + 1):
        t_pred0 = pd.Timestamp(city_df.iloc[i + input_len]["时间"])
        t_pred_end = pd.Timestamp(city_df.iloc[i + input_len + output_len - 1]["时间"])
        if mode == "train" and t_pred_end <= split_ts:
            X_list.append(Xf[i : i + input_len])
            Y_list.append(Yf[i + input_len : i + input_len + output_len])
            C_list.append(city_id)
    if not X_list:
        return np.array([]), np.array([]), np.array([])
    return np.stack(X_list, axis=0), np.stack(Y_list, axis=0), np.array(C_list, dtype=np.int64)


def collect_train_sequences(
    df: pd.DataFrame,
    split_ts: pd.Timestamp,
    scaler_X: MinMaxScaler,
    scaler_y: MinMaxScaler,
    city2id: Dict[str, int],
    input_len: int,
    output_len: int,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    parts_x: List[np.ndarray] = []
    parts_y: List[np.ndarray] = []
    parts_c: List[np.ndarray] = []
    for city in df["城市"].dropna().astype(str).unique():
        cdf = df[df["城市"] == city]
        Xs, Ys, Cs = sequences_for_city(cdf, split_ts, scaler_X, scaler_y, city2id[city], input_len, output_len, "train")
        if len(Xs):
            parts_x.append(Xs)
            parts_y.append(Ys)
            parts_c.append(Cs)
    if not parts_x:
        return np.array([]), np.array([]), np.array([])
    return np.concatenate(parts_x, axis=0), np.concatenate(parts_y, axis=0), np.concatenate(parts_c, axis=0)


def collect_boundary_test_sequences(
    df: pd.DataFrame,
    split_ts: pd.Timestamp,
    scaler_X: MinMaxScaler,
    scaler_y: MinMaxScaler,
    city2id: Dict[str, int],
    input_len: int,
    eval_len: int,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """每城市至多一条：在训练/测试边界上，用较短 eval_len 步计算指标（测试段往往不足完整 horizon）。"""
    split_ts = pd.Timestamp(split_ts)
    parts_x: List[np.ndarray] = []
    parts_y: List[np.ndarray] = []
    parts_c: List[np.ndarray] = []
    for city in df["城市"].dropna().astype(str).unique():
        cdf = df[df["城市"] == city].sort_values("时间").reset_index(drop=True)
        n = len(cdf)
        if n < input_len + eval_len:
            continue
        times = pd.to_datetime(cdf["时间"])
        mask = (times > split_ts).values
        if not np.any(mask):
            continue
        j = int(np.argmax(mask))
        if j < input_len:
            continue
        i = j - input_len
        if j + eval_len > n:
            continue
        t_last_in = pd.Timestamp(cdf.iloc[i + input_len - 1]["时间"])
        t_pred0 = pd.Timestamp(cdf.iloc[i + input_len]["时间"])
        if t_last_in > split_ts or t_pred0 <= split_ts:
            continue
        Xf = scaler_X.transform(cdf[FEATURE_COLS].values.astype(np.float64))
        Yf = scaler_y.transform(cdf[TARGET_COLS].values.astype(np.float64))
        parts_x.append(Xf[i : i + input_len])
        parts_y.append(Yf[i + input_len : i + input_len + eval_len])
        parts_c.append(np.array([city2id[city]], dtype=np.int64))
    if not parts_x:
        return np.array([]), np.array([]), np.array([])
    return np.stack(parts_x, axis=0), np.stack(parts_y, axis=0), np.concatenate(parts_c, axis=0)


def main() -> None:
    args = parse_args()
    csv_path = Path(args.csv).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    horizon = int(args.horizon)
    input_len = int(args.input_len)

    print(f"[LSTM] 读取数据: {csv_path}", flush=True)
    df = load_and_prepare(csv_path)
    print(f"[LSTM] 数据准备完成, 样本数: {len(df)}", flush=True)
    cities = sorted(df["城市"].dropna().astype(str).unique().tolist())
    city2id = {c: i for i, c in enumerate(cities)}

    split_ts = df["时间"].quantile(0.8)
    train_df = df[df["时间"] <= split_ts].copy()
    test_df = df[df["时间"] > split_ts].copy()
    if len(train_df) < 100 or len(test_df) < 20:
        raise ValueError("样本过少，无法完成稳定训练，请检查输入数据。")

    scaler_X = MinMaxScaler()
    scaler_y = MinMaxScaler()
    scaler_X.fit(train_df[FEATURE_COLS].values.astype(np.float64))
    scaler_y.fit(train_df[TARGET_COLS].values.astype(np.float64))

    eval_len = min(int(args.metrics_horizon), horizon)
    X_train, y_train, c_train = collect_train_sequences(df, split_ts, scaler_X, scaler_y, city2id, input_len, horizon)
    X_test, y_test, c_test = collect_boundary_test_sequences(df, split_ts, scaler_X, scaler_y, city2id, input_len, eval_len)
    if len(X_train) < 32:
        raise ValueError("训练序列过少，请增大数据量或减小 horizon / input_len。")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = MultiPollutantLSTM(
        input_size=len(FEATURE_COLS),
        num_cities=len(cities),
        emb_dim=args.city_emb_dim,
        hidden_size=args.hidden_size,
        num_layers=args.num_layers,
        output_len=horizon,
        n_targets=N_TARGETS,
    ).to(device)

    Xt = torch.tensor(X_train, dtype=torch.float32, device=device)
    yt = torch.tensor(y_train, dtype=torch.float32, device=device)
    ct = torch.tensor(c_train, dtype=torch.long, device=device)
    dataset = torch.utils.data.TensorDataset(Xt, yt, ct)
    loader = torch.utils.data.DataLoader(dataset, batch_size=args.batch_size, shuffle=True, drop_last=False)

    criterion = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)

    print("[LSTM] 开始训练...", flush=True)
    for epoch in range(args.epochs):
        model.train()
        total_loss = 0.0
        for xb, yb, cb in loader:
            optimizer.zero_grad()
            pred = model(xb, cb)
            loss = criterion(pred, yb)
            loss.backward()
            optimizer.step()
            total_loss += float(loss.item()) * xb.size(0)
        avg = total_loss / len(loader.dataset)
        if (epoch + 1) % 5 == 0 or epoch == 0:
            print(f"[LSTM] Epoch {epoch + 1}/{args.epochs}  train_loss={avg:.6f}", flush=True)

    # Test metrics on AQI channel (index 0)
    metrics = {
        "train_rows": int(len(train_df)),
        "test_rows": int(len(test_df)),
        "train_sequences": int(len(X_train)),
        "test_sequences": int(len(X_test)),
        "model": "MultiPollutantLSTM",
        "model_version": "v2-city-embedding",
        "split_time": str(pd.to_datetime(split_ts)),
        "horizon": horizon,
        "input_len": input_len,
        "metrics_eval_hours": eval_len,
    }

    model.eval()
    if len(X_test) > 0:
        with torch.no_grad():
            pred_full = model(
                torch.tensor(X_test, dtype=torch.float32, device=device),
                torch.tensor(c_test, dtype=torch.long, device=device),
            ).cpu().numpy()
        pred_t = pred_full[:, :eval_len, :]
        # Inverse scale AQI predictions and true y (all steps, mean over time for stability)
        pred_flat = pred_t.reshape(-1, N_TARGETS)
        y_flat = y_test.reshape(-1, N_TARGETS)
        pred_aqi = scaler_y.inverse_transform(pred_flat)[:, 0]
        true_aqi = scaler_y.inverse_transform(y_flat)[:, 0]
        metrics["mae"] = round(float(mean_absolute_error(true_aqi, pred_aqi)), 3)
        metrics["rmse"] = round(float(mean_squared_error(true_aqi, pred_aqi) ** 0.5), 3)
        metrics["r2"] = round(float(r2_score(true_aqi, pred_aqi)), 4)
    else:
        metrics["mae"] = None
        metrics["rmse"] = None
        metrics["r2"] = None

    # ----- 各城市未来 horizon 小时预测 -----
    all_cities = sorted(df["城市"].dropna().astype(str).unique().tolist())
    forecast_rows: List[dict] = []
    for city_name in all_cities:
        city_df = df[df["城市"] == city_name].sort_values("时间").copy()
        if len(city_df) < input_len:
            continue
        Xf = scaler_X.transform(city_df[FEATURE_COLS].values.astype(np.float64))
        last = Xf[-input_len:]
        x_tensor = torch.tensor(last, dtype=torch.float32, device=device).unsqueeze(0)
        city_tensor = torch.tensor([city2id[city_name]], dtype=torch.long, device=device)
        with torch.no_grad():
            pred_scaled = model(x_tensor, city_tensor).cpu().numpy()[0]
        pred_real = scaler_y.inverse_transform(pred_scaled.reshape(-1, N_TARGETS))
        pred_real = np.clip(pred_real, 0.0, None)
        start_ts = pd.to_datetime(city_df["时间"].max()) + pd.Timedelta(hours=1)
        for step in range(horizon):
            ts = start_ts + pd.Timedelta(hours=step)
            aqi_hat, pm25_hat, pm10_hat, no2_hat, o3_hat = pred_real[step]
            row_out = {
                "预测时间": ts.strftime("%Y-%m-%d %H:%M:%S"),
                "城市": city_name,
                "预测AQI": round(float(aqi_hat), 1),
                "预测PM25": round(float(pm25_hat), 1),
                "预测PM10": round(float(pm10_hat), 1),
                "预测O3": round(float(o3_hat), 1),
                "预测NO2": round(float(no2_hat), 1),
            }
            row_out.update(get_warning_level(float(aqi_hat)))
            forecast_rows.append(row_out)

    forecast_df = pd.DataFrame(forecast_rows)
    if forecast_df.empty:
        raise ValueError("未生成任何预测行：请检查各城市是否有足够历史行数。")

    # 计算 LSTM 梯度敏感度重要性（按城市）：用于替代统一的相关性特征，体现模型差异
    update_time = pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S")
    top_features_rows: List[dict] = []
    top_features_by_city: Dict[str, List[dict]] = {}
    model.eval()
    for city_name in all_cities:
        city_df = df[df["城市"] == city_name].sort_values("时间").copy()
        if len(city_df) < input_len:
            continue
        Xf = scaler_X.transform(city_df[FEATURE_COLS].values.astype(np.float64))
        last = Xf[-input_len:]
        x_tensor = torch.tensor(last, dtype=torch.float32, device=device).unsqueeze(0)
        x_tensor.requires_grad_(True)
        city_tensor = torch.tensor([city2id[city_name]], dtype=torch.long, device=device)
        model.zero_grad(set_to_none=True)
        pred = model(x_tensor, city_tensor)
        score = pred[:, :, 0].mean()
        score.backward()
        grad = x_tensor.grad.detach().abs().mean(dim=1).squeeze(0).cpu().numpy()
        grad_sum = float(np.sum(grad))
        if grad_sum <= 0:
            continue
        weights = grad / grad_sum
        idxs = np.argsort(-weights)[:8]
        rows: List[dict] = []
        for i in idxs:
            item = {
                "城市": city_name,
                "特征": str(FEATURE_COLS[int(i)]),
                "重要性": round(float(weights[int(i)]), 4),
                "更新时间": update_time,
            }
            rows.append(item)
            top_features_rows.append(item)
        top_features_by_city[city_name] = rows

    # 持久化权重与 scaler，供后续仅推理或替换流水线
    ckpt_path = output_dir / "dashboard_lstm.pt"
    torch.save(
        {
            "state_dict": model.state_dict(),
            "input_size": len(FEATURE_COLS),
            "num_cities": len(cities),
            "city_emb_dim": int(args.city_emb_dim),
            "hidden_size": int(args.hidden_size),
            "num_layers": int(args.num_layers),
            "output_len": horizon,
            "n_targets": N_TARGETS,
            "feature_cols": FEATURE_COLS,
            "target_cols": TARGET_COLS,
            "input_len": input_len,
            "city2id": city2id,
        },
        ckpt_path,
    )
    joblib.dump(
        {"scaler_X": scaler_X, "scaler_y": scaler_y},
        output_dir / "dashboard_lstm_scalers.joblib",
    )
    meta = {
        "weights": str(ckpt_path.name),
        "scalers": "dashboard_lstm_scalers.joblib",
        "metrics": metrics,
    }
    (output_dir / "dashboard_lstm_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[LSTM] 已保存: {ckpt_path.name}, dashboard_lstm_scalers.joblib", flush=True)

    export_dashboard_bundle(
        df=df,
        train_df=train_df,
        forecast_df=forecast_df,
        metrics=metrics,
        output_dir=output_dir,
        target_city=args.target_city,
        payload_filename="dashboard_lstm_payload.json",
        variant_id="lstm",
        variant_label="LSTM 多目标序列",
        mirror_default_payload=False,
        top_features_rows_override=top_features_rows,
        top_features_by_city_override=top_features_by_city,
    )


if __name__ == "__main__":
    main()
