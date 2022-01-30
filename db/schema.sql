CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(20) PRIMARY KEY,
  ref_id VARCHAR(20) NOT NULL,
  exchange VARCHAR(20) NOT NULL,
  symbol VARCHAR(15) NOT NULL,
  bot_id VARCHAR(4) NOT NULL,
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
CREATE INDEX orders_exchange_symbol_botid_idx ON orders(exchange, symbol, bot_id);
CREATE INDEX orders_exchange_symbol_botid_side_idx ON orders(exchange, symbol, bot_id, side);
CREATE INDEX orders_exchange_symbol_botid_posside_idx ON orders(exchange, symbol, bot_id, position_side);
CREATE INDEX orders_exchange_symbol_botid_status_idx ON orders(exchange, symbol, bot_id, status);
CREATE INDEX orders_exchange_symbol_botid_type_idx ON orders(exchange, symbol, bot_id, type);
