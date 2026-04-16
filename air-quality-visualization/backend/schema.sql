CREATE DATABASE IF NOT EXISTS air_quality DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE air_quality;

CREATE TABLE IF NOT EXISTS city (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  adcode    VARCHAR(12) NOT NULL,
  name      VARCHAR(64) NOT NULL,
  province  VARCHAR(64) NOT NULL,
  qweather_location_id VARCHAR(32) NULL,
  lon       DECIMAL(10,6) NULL,
  lat       DECIMAL(10,6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_city_adcode (adcode),
  KEY idx_city_qweather_location_id (qweather_location_id),
  KEY idx_city_province (province)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 历史序列：业务上按「整点一小时一条」写入（主键 city_id + ts）；表名保留 minute 以兼容现有代码
CREATE TABLE IF NOT EXISTS city_observation_minute (
  city_id      BIGINT UNSIGNED NOT NULL,
  ts           DATETIME NOT NULL,
  source       VARCHAR(16) NOT NULL DEFAULT 'api',

  csv_city     VARCHAR(64) NULL,
  csv_province VARCHAR(64) NULL,
  obs_lat      DECIMAL(10,6) NULL,
  obs_lon      DECIMAL(10,6) NULL,
  feels_like_c FLOAT NULL,
  pressure_hpa FLOAT NULL,
  wind_direction VARCHAR(16) NULL,
  precip_mm    FLOAT NULL,
  obs_hour       TINYINT NULL,
  calendar_month TINYINT NULL,
  weekday        TINYINT NULL,
  is_workday     TINYINT NULL,

  temp_c       FLOAT NULL,
  humidity     FLOAT NULL,
  wind_speed   FLOAT NULL,
  weather_code VARCHAR(32) NULL,

  aqi          INT NULL,
  pm25         FLOAT NULL,
  pm10         FLOAT NULL,
  no2          FLOAT NULL,
  so2          FLOAT NULL,
  o3           FLOAT NULL,
  co           FLOAT NULL,

  PRIMARY KEY (city_id, ts),
  KEY idx_ts (ts),
  KEY idx_city_ts (city_id, ts),
  CONSTRAINT fk_obs_city FOREIGN KEY (city_id) REFERENCES city(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS city_observation_latest (
  city_id      BIGINT UNSIGNED NOT NULL,
  ts           DATETIME NOT NULL,

  csv_city     VARCHAR(64) NULL,
  csv_province VARCHAR(64) NULL,
  obs_lat      DECIMAL(10,6) NULL,
  obs_lon      DECIMAL(10,6) NULL,
  feels_like_c FLOAT NULL,
  pressure_hpa FLOAT NULL,
  wind_direction VARCHAR(16) NULL,
  precip_mm    FLOAT NULL,
  obs_hour       TINYINT NULL,
  calendar_month TINYINT NULL,
  weekday        TINYINT NULL,
  is_workday     TINYINT NULL,

  temp_c       FLOAT NULL,
  humidity     FLOAT NULL,
  wind_speed   FLOAT NULL,
  weather_code VARCHAR(32) NULL,

  aqi          INT NULL,
  pm25         FLOAT NULL,
  pm10         FLOAT NULL,
  no2          FLOAT NULL,
  so2          FLOAT NULL,
  o3           FLOAT NULL,
  co           FLOAT NULL,

  PRIMARY KEY (city_id),
  KEY idx_latest_ts (ts),
  CONSTRAINT fk_latest_city FOREIGN KEY (city_id) REFERENCES city(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

