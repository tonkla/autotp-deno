-- orders

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(20) PRIMARY KEY,
  ref_id VARCHAR(20) NOT NULL,
  exchange VARCHAR(20) NOT NULL,
  symbol VARCHAR(15) NOT NULL,
  bot_id VARCHAR(15) NOT NULL,
  side VARCHAR(5) NOT NULL,
  position_side VARCHAR(5),
  type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  qty NUMERIC(20, 8) NOT NULL DEFAULT 0,
  zone_price NUMERIC(15, 8) NOT NULL DEFAULT 0,
  open_price NUMERIC(15, 8) NOT NULL DEFAULT 0,
  close_price NUMERIC(15, 8) NOT NULL DEFAULT 0,
  commission NUMERIC(10, 5) NOT NULL DEFAULT 0,
  pl NUMERIC(15, 8) NOT NULL DEFAULT 0,
  max_profit NUMERIC(15, 8) NOT NULL DEFAULT 0,
  max_pip NUMERIC(15, 8) NOT NULL DEFAULT 0,
  open_order_id VARCHAR(20),
  close_order_id VARCHAR(20),
  open_time TIMESTAMP,
  close_time TIMESTAMP,
  update_time TIMESTAMP
);

CREATE INDEX orders_ref_id_idx ON orders(ref_id);
CREATE INDEX orders_exchange_idx ON orders(exchange);
CREATE INDEX orders_symbol_idx ON orders(symbol);
CREATE INDEX orders_bot_id_idx ON orders(bot_id);
CREATE INDEX orders_side_idx ON orders(side);
CREATE INDEX orders_position_side_idx ON orders(position_side);
CREATE INDEX orders_type_idx ON orders(type);
CREATE INDEX orders_status_idx ON orders(status);
CREATE INDEX orders_open_order_idx ON orders(open_order_id);
CREATE INDEX orders_close_time_idx ON orders(close_time);

-- bforders

CREATE TABLE IF NOT EXISTS bforders (
  id VARCHAR(20) PRIMARY KEY,
  ref_id VARCHAR(20) NOT NULL,
  symbol VARCHAR(15) NOT NULL,
  bot_id VARCHAR(15) NOT NULL,
  side VARCHAR(5) NOT NULL,
  position_side VARCHAR(5),
  type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  qty NUMERIC(20, 8) NOT NULL DEFAULT 0,
  open_price NUMERIC(15, 8) NOT NULL DEFAULT 0,
  close_price NUMERIC(15, 8) NOT NULL DEFAULT 0,
  commission NUMERIC(10, 5) NOT NULL DEFAULT 0,
  pl NUMERIC(15, 8) NOT NULL DEFAULT 0,
  max_profit NUMERIC(15, 8) NOT NULL DEFAULT 0,
  max_pip NUMERIC(15, 8) NOT NULL DEFAULT 0,
  note JSONB,
  open_order_id VARCHAR(20),
  close_order_id VARCHAR(20),
  open_time TIMESTAMP,
  close_time TIMESTAMP,
  update_time TIMESTAMP
);

CREATE INDEX bforders_ref_id_idx ON bforders(ref_id);
CREATE INDEX bforders_symbol_idx ON bforders(symbol);
CREATE INDEX bforders_bot_id_idx ON bforders(bot_id);
CREATE INDEX bforders_side_idx ON bforders(side);
CREATE INDEX bforders_position_side_idx ON bforders(position_side);
CREATE INDEX bforders_type_idx ON bforders(type);
CREATE INDEX bforders_status_idx ON bforders(status);
CREATE INDEX bforders_open_order_idx ON bforders(open_order_id);
CREATE INDEX bforders_close_time_idx ON bforders(close_time);

-- kv

CREATE TABLE IF NOT EXISTS kv (
  k VARCHAR(50) PRIMARY KEY,
  v TEXT
);

INSERT INTO kv(k) VALUES('LATEST_STOP');
