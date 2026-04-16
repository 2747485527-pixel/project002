-- 在已有「扩展观测列」的库上补齐：CSV 城市/省份原文 + 行级经纬度（若列已存在会报错，可忽略对应语句）

ALTER TABLE city_observation_minute
  ADD COLUMN csv_city VARCHAR(64) NULL COMMENT 'CSV 城市原文',
  ADD COLUMN csv_province VARCHAR(64) NULL COMMENT 'CSV 省份原文',
  ADD COLUMN obs_lat DECIMAL(10,6) NULL COMMENT '观测点纬度',
  ADD COLUMN obs_lon DECIMAL(10,6) NULL COMMENT '观测点经度';

ALTER TABLE city_observation_latest
  ADD COLUMN csv_city VARCHAR(64) NULL COMMENT 'CSV 城市原文',
  ADD COLUMN csv_province VARCHAR(64) NULL COMMENT 'CSV 省份原文',
  ADD COLUMN obs_lat DECIMAL(10,6) NULL COMMENT '观测点纬度',
  ADD COLUMN obs_lon DECIMAL(10,6) NULL COMMENT '观测点经度';
