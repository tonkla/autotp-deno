#property copyright "Stradeji"
#property link      "https://www.stradeji.com"
#property version   "1.0"
#property strict

int MY_ACCOUNT_ID = 61119160;

input int magic	= 1;
double lots	= 0.01;
double mos_entry = 0.5;
double mos_open = 0.5;
double gap = 0.15;
double sl = 1;
double tp = 0.1;
int max_orders = 4;
int max_spread = 20;

double d_ma_h_0, d_ma_l_0, d_ma_c_0, d_ma_c_1, d_csl_0, d_atr;
int d_macd, d_macd_hst;
double h_ma_h_0, h_ma_l_0, h_ma_c_0, h_ma_c_1, h_csl_0, h_atr;
int h_macd, h_macd_hst;
double m_ma_h_0, m_ma_l_0, m_ma_c_0, m_ma_c_1, m_csl_0, m_atr;
int m_macd, m_macd_hst;

long buy_orders[], sell_orders[], buy_positions[], sell_positions[];
double buy_nearest_price, sell_nearest_price;

int OnInit() {
	return AccountInfoInteger(ACCOUNT_LOGIN) == MY_ACCOUNT_ID ? INIT_SUCCEEDED : INIT_FAILED;
}

void OnTick() {
	get_ta_d();
	get_ta_h();
	get_ta_m();
	get_orders();
	get_positions();
	open_buys();
	open_sells();
	close_buys();
	close_sells();
}

void get_ta_d() {
	int handle_ma_h = iMA(Symbol(), PERIOD_D1, 5, 0, MODE_LWMA, PRICE_HIGH);
	int handle_ma_l = iMA(Symbol(), PERIOD_D1, 5, 0, MODE_LWMA, PRICE_LOW);
	int handle_ma_c = iMA(Symbol(), PERIOD_D1, 5, 0, MODE_LWMA, PRICE_CLOSE);

	double buff_ma_h[];
	CopyBuffer(handle_ma_h, 0, 0, 1, buff_ma_h);
	d_ma_h_0 = buff_ma_h[0];

	double buff_ma_l[];
	CopyBuffer(handle_ma_l, 0, 0, 1, buff_ma_l);
	d_ma_l_0 = buff_ma_l[0];

	double buff_ma_c[];
	CopyBuffer(handle_ma_c, 0, 0, 2, buff_ma_c);
	d_ma_c_0 = buff_ma_c[1];
	d_ma_c_1 = buff_ma_c[0];

	d_atr = d_ma_h_0 - d_ma_l_0;
	d_csl_0 = (d_ma_c_0 - d_ma_c_1) / d_atr * 100;

	int handle_macd = iMACD(Symbol(), PERIOD_D1, 12, 26, 9, PRICE_CLOSE);

	double buff_macd[];
	double buff_macd_sig[];
	CopyBuffer(handle_macd, 0, 0, 2, buff_macd);
	CopyBuffer(handle_macd, 1, 0, 2, buff_macd_sig);

	double macd_0 = buff_macd[1];
	double macd_1 = buff_macd[0];
	double macd_sig_0 = buff_macd_sig[1];
	double macd_sig_1 = buff_macd_sig[0];
	double macd_hst_0 = macd_0 - macd_sig_0;
	double macd_hst_1 = macd_1 - macd_sig_1;
	d_macd = macd_0 > macd_1 ? 1 : -1;
	d_macd_hst = macd_hst_0 > macd_hst_1 ? 1 : -1;
}

void get_ta_h() {
	int handle_ma_h = iMA(Symbol(), PERIOD_H1, 5, 0, MODE_LWMA, PRICE_HIGH);
	int handle_ma_l = iMA(Symbol(), PERIOD_H1, 5, 0, MODE_LWMA, PRICE_LOW);
	int handle_ma_c = iMA(Symbol(), PERIOD_H1, 5, 0, MODE_LWMA, PRICE_CLOSE);

	double buff_ma_h[];
	CopyBuffer(handle_ma_h, 0, 0, 1, buff_ma_h);
	h_ma_h_0 = buff_ma_h[0];

	double buff_ma_l[];
	CopyBuffer(handle_ma_l, 0, 0, 1, buff_ma_l);
	h_ma_l_0 = buff_ma_l[0];

	double buff_ma_c[];
	CopyBuffer(handle_ma_c, 0, 0, 2, buff_ma_c);
	h_ma_c_0 = buff_ma_c[1];
	h_ma_c_1 = buff_ma_c[0];

	h_atr = h_ma_h_0 - h_ma_l_0;
	h_csl_0 = (h_ma_c_0 - h_ma_c_1) / h_atr * 100;

	int handle_macd = iMACD(Symbol(), PERIOD_H1, 12, 26, 9, PRICE_CLOSE);

	double buff_macd[];
	double buff_macd_sig[];
	CopyBuffer(handle_macd, 0, 0, 2, buff_macd);
	CopyBuffer(handle_macd, 1, 0, 2, buff_macd_sig);

	double macd_0 = buff_macd[1];
	double macd_1 = buff_macd[0];
	double macd_sig_0 = buff_macd_sig[1];
	double macd_sig_1 = buff_macd_sig[0];
	double macd_hst_0 = macd_0 - macd_sig_0;
	double macd_hst_1 = macd_1 - macd_sig_1;
	h_macd = macd_0 > macd_1 ? 1 : -1;
	h_macd_hst = macd_hst_0 > macd_hst_1 ? 1 : -1;
}

void get_ta_m() {
	int handle_ma_h = iMA(Symbol(), PERIOD_M15, 5, 0, MODE_LWMA, PRICE_HIGH);
	int handle_ma_l = iMA(Symbol(), PERIOD_M15, 5, 0, MODE_LWMA, PRICE_LOW);
	int handle_ma_c = iMA(Symbol(), PERIOD_M15, 5, 0, MODE_LWMA, PRICE_CLOSE);

	double buff_ma_h[];
	CopyBuffer(handle_ma_h, 0, 0, 1, buff_ma_h);
	m_ma_h_0 = buff_ma_h[0];

	double buff_ma_l[];
	CopyBuffer(handle_ma_l, 0, 0, 1, buff_ma_l);
	m_ma_l_0 = buff_ma_l[0];

	double buff_ma_c[];
	CopyBuffer(handle_ma_c, 0, 0, 2, buff_ma_c);
	m_ma_c_0 = buff_ma_c[1];
	m_ma_c_1 = buff_ma_c[0];

	m_atr = m_ma_h_0 - m_ma_l_0;
	m_csl_0 = (m_ma_c_0 - m_ma_c_1) / m_atr * 100;

	int handle_macd = iMACD(Symbol(), PERIOD_M15, 12, 26, 9, PRICE_CLOSE);

	double buff_macd[];
	double buff_macd_sig[];
	CopyBuffer(handle_macd, 0, 0, 2, buff_macd);
	CopyBuffer(handle_macd, 1, 0, 2, buff_macd_sig);

	double macd_0 = buff_macd[1];
	double macd_1 = buff_macd[0];
	double macd_sig_0 = buff_macd_sig[1];
	double macd_sig_1 = buff_macd_sig[0];
	double macd_hst_0 = macd_0 - macd_sig_0;
	double macd_hst_1 = macd_1 - macd_sig_1;
	m_macd = macd_0 > macd_1 ? 1 : -1;
	m_macd_hst = macd_hst_0 > macd_hst_1 ? 1 : -1;
}

void get_orders() {
	int size = 0;
	double open_price = 0;
	ArrayFree(buy_orders);
	ArrayFree(sell_orders);
	buy_nearest_price = 0;
	sell_nearest_price = 0;

	MqlTick tick;
	if (!SymbolInfoTick(Symbol(), tick)) return;
	if (tick.ask == 0 || tick.bid == 0) return;
	double Ask = tick.ask;
	double Bid = tick.bid;

	for (int i = OrdersTotal() - 1; i >= 0; i--) {
		if (OrderGetTicket(i) == 0) continue;
		if (OrderGetString(ORDER_SYMBOL) != Symbol() ||
				OrderGetInteger(ORDER_MAGIC) != magic) continue;

		if (OrderGetInteger(ORDER_TYPE) == ORDER_TYPE_BUY_LIMIT) {
			size = ArraySize(buy_orders);
			ArrayResize(buy_orders, size + 1);
			buy_orders[size] = OrderGetInteger(ORDER_TICKET);
			open_price = OrderGetDouble(ORDER_PRICE_OPEN);
			if (buy_nearest_price == 0 || MathAbs(open_price - Ask) < MathAbs(buy_nearest_price - Ask)) {
				buy_nearest_price = open_price;
			}
		} else if (OrderGetInteger(ORDER_TYPE) == ORDER_TYPE_SELL_LIMIT) {
			size = ArraySize(sell_orders);
			ArrayResize(sell_orders, size + 1);
			sell_orders[size] = OrderGetInteger(ORDER_TICKET);
			open_price = OrderGetDouble(ORDER_PRICE_OPEN);
			if (sell_nearest_price == 0 || MathAbs(open_price - Bid) < MathAbs(sell_nearest_price - Bid)) {
				sell_nearest_price = open_price;
			}
		}
	}
}

void get_positions() {
	int size = 0;
	double open_price = 0;
	ArrayFree(buy_positions);
	ArrayFree(sell_positions);

	MqlTick tick;
	if (!SymbolInfoTick(Symbol(), tick)) return;
	if (tick.ask == 0 || tick.bid == 0) return;
	double Ask = tick.ask;
	double Bid = tick.bid;

	for (int i = PositionsTotal() - 1; i >= 0; i--) {
		if (PositionGetTicket(i) == 0) continue;
		if (PositionGetString(POSITION_SYMBOL) != Symbol() ||
				PositionGetInteger(POSITION_MAGIC) != magic) continue;

		if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) {
			size = ArraySize(buy_positions);
			ArrayResize(buy_positions, size + 1);
			buy_positions[size] = PositionGetInteger(POSITION_TICKET);
			open_price = PositionGetDouble(POSITION_PRICE_OPEN);
			if (buy_nearest_price == 0 || MathAbs(open_price - Ask) < MathAbs(buy_nearest_price - Ask)) {
				buy_nearest_price = open_price;
			}
		} else if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL) {
			size = ArraySize(sell_positions);
			ArrayResize(sell_positions, size + 1);
			sell_positions[size] = PositionGetInteger(POSITION_TICKET);
			open_price = PositionGetDouble(POSITION_PRICE_OPEN);
			if (sell_nearest_price == 0 || MathAbs(open_price - Bid) < MathAbs(sell_nearest_price - Bid)) {
				sell_nearest_price = open_price;
			}
		}
	}
}

void open_buys() {
	// Rest on Friday, 21:00:00 UTC
	MqlDateTime time;
	TimeGMT(time);
	if (time.hour >= 21 && time.day_of_week == 5) return;

	if (SymbolInfoInteger(Symbol(), SYMBOL_SPREAD) > max_spread) return;

	bool is_up	= d_macd > 0 && d_macd_hst > 0 && d_csl_0 > 0 &&
								h_macd > 0 && h_macd_hst > 0 && h_csl_0 > 0 &&
								m_macd > 0 && m_macd_hst > 0 && m_csl_0 > 0;
	if (!is_up) return;

	MqlTick tick;
	if (!SymbolInfoTick(Symbol(), tick)) return;
	if (tick.ask == 0) return;

	double Ask = tick.ask;
	if (Ask - d_ma_c_0 > mos_entry * d_atr) return;
	if (Ask > h_ma_h_0) return;
	if (Ask > m_ma_h_0) return;

	double Open = iOpen(Symbol(), PERIOD_D1, 0);
	if (Open - d_ma_c_0 > mos_open * d_atr) return;

	if (ArraySize(buy_orders) + ArraySize(buy_positions) >= max_orders) return;
	if (buy_nearest_price > 0 && MathAbs(Ask - buy_nearest_price) < gap * d_atr) return;

	MqlTradeRequest request = {};
	MqlTradeResult result = {};
	request.symbol = Symbol();
	request.action = TRADE_ACTION_PENDING;
	request.type = ORDER_TYPE_BUY_LIMIT;
	request.magic = magic;
	request.price = Ask;
	request.volume = lots;
	// request.sl = sl > 0 ? NormalizeDouble(Ask - sl * d_atr, Digits()) : 0;
	// request.tp = tp > 0 ? NormalizeDouble(Ask + tp * d_atr, Digits()) : 0;
	request.expiration = TimeCurrent() + 20 * 60;
	if (OrderSend(request, result)) return;
}

void open_sells() {
	// Rest on Friday, 21:00:00 UTC
	MqlDateTime time;
	TimeGMT(time);
	if (time.hour >= 21 && time.day_of_week == 5) return;

	if (SymbolInfoInteger(Symbol(), SYMBOL_SPREAD) > max_spread) return;

	bool is_down 	= d_macd < 0 && d_macd_hst < 0 && d_csl_0 < 0 &&
									h_macd < 0 && h_macd_hst < 0 && h_csl_0 < 0 &&
									m_macd < 0 && m_macd_hst < 0 && m_csl_0 < 0;
	if (!is_down) return;

	MqlTick tick;
	if (!SymbolInfoTick(Symbol(), tick)) return;
	if (tick.bid == 0) return;

	double Bid = tick.bid;
	if (d_ma_c_0 - Bid > mos_entry * d_atr) return;
	if (Bid < h_ma_l_0) return;
	if (Bid < m_ma_l_0) return;

	double Open = iOpen(Symbol(), PERIOD_D1, 0);
	if (d_ma_c_0 - Open > mos_open * d_atr) return;

	if (ArraySize(sell_orders) + ArraySize(sell_positions) >= max_orders) return;
	if (sell_nearest_price > 0 && MathAbs(Bid - sell_nearest_price) < gap * d_atr) return;

	MqlTradeRequest request = {};
	MqlTradeResult result = {};
	request.symbol = Symbol();
	request.action = TRADE_ACTION_PENDING;
	request.type = ORDER_TYPE_SELL_LIMIT;
	request.magic = magic;
	request.price = Bid;
	request.volume = lots;
	// request.sl = sl > 0 ? NormalizeDouble(Bid + sl * d_atr, Digits()) : 0;
	// request.tp = tp > 0 ? NormalizeDouble(Bid - tp * d_atr, Digits()) : 0;
	request.expiration = TimeCurrent() + 20 * 60;
	if (OrderSend(request, result)) return;
}

void close_buys() {
	// Close all orders and positions on Friday, 21:00:00 UTC
	MqlDateTime time;
	TimeGMT(time);
	if (time.hour >= 21 && time.day_of_week == 5) {
		_close_buy_orders();
		_close_buy_positions();
		return;
	}

	MqlTick tick;
	long open_time;
	double open_price;
	bool should_close;

	for (int i = 0; i < ArraySize(buy_positions); i++) {
		if (!PositionSelectByTicket(buy_positions[i])) continue;

		if (!SymbolInfoTick(Symbol(), tick)) continue;
		if (tick.bid == 0) continue;

		open_time = PositionGetInteger(POSITION_TIME);
		open_price = PositionGetDouble(POSITION_PRICE_OPEN);

		should_close = (open_time < iTime(Symbol(), PERIOD_D1, 0) && open_price < tick.bid) ||
									 (open_time + 20 * 60 < TimeCurrent() && d_macd_hst < 0 && d_csl_0 < 0);
		if (should_close) {
			// _close_buy_position();
		}
		if (sl > 0 && open_price - tick.bid > sl * d_atr) {
			_close_buy_position();
		}
		if (tp > 0 && tick.bid - open_price > tp * d_atr) {
			_close_buy_position();
		}
	}
}

void close_sells() {
	// Close all orders and positions on Friday, 21:00:00 UTC
	MqlDateTime time;
	TimeGMT(time);
	if (time.hour >= 21 && time.day_of_week == 5) {
		_close_sell_orders();
		_close_sell_positions();
		return;
	}

	MqlTick tick;
	long open_time;
	double open_price;
	bool should_close;

	for (int i = 0; i < ArraySize(sell_positions); i++) {
		if (!PositionSelectByTicket(sell_positions[i])) continue;

		if (!SymbolInfoTick(Symbol(), tick)) continue;
		if (tick.ask == 0) continue;

		open_time = PositionGetInteger(POSITION_TIME);
		open_price = PositionGetDouble(POSITION_PRICE_OPEN);

		should_close = (open_time < iTime(Symbol(), PERIOD_D1, 0) && open_price > tick.ask) ||
									 (open_time + 20 * 60 < TimeCurrent() && d_macd_hst > 0 && d_csl_0 > 0);
		if (should_close) {
			// _close_sell_position();
		}
		if (sl > 0 && tick.ask - open_price > sl * d_atr) {
			_close_sell_position();
		}
		if (tp > 0 && open_price - tick.ask > tp * d_atr) {
			_close_sell_position();
		}
	}
}

void _close_buy_orders() {
	for (int i = 0; i < ArraySize(buy_orders); i++) {
		if (!OrderSelect(buy_orders[i])) continue;
		MqlTradeRequest request = {};
		MqlTradeResult result = {};
		request.action = TRADE_ACTION_REMOVE;
		request.order = buy_orders[i];
		if (OrderSend(request, result)) continue;
	}
}

void _close_sell_orders() {
	for (int i = 0; i < ArraySize(sell_orders); i++) {
		if (!OrderSelect(sell_orders[i])) continue;
		MqlTradeRequest request = {};
		MqlTradeResult result = {};
		request.action = TRADE_ACTION_REMOVE;
		request.order = sell_orders[i];
		if (OrderSend(request, result)) continue;
	}
}

void _close_buy_positions() {
	for (int i = 0; i < ArraySize(buy_positions); i++) {
		if (!PositionSelectByTicket(buy_positions[i])) continue;
		_close_buy_position();
	}
}

void _close_sell_positions() {
	for (int i = 0; i < ArraySize(sell_positions); i++) {
		if (!PositionSelectByTicket(sell_positions[i])) continue;
		_close_sell_position();
	}
}

void _close_buy_position() {
	MqlTick tick;
	if (!SymbolInfoTick(Symbol(), tick)) return;
	if (tick.bid == 0) return;
	MqlTradeRequest request = {};
	MqlTradeResult result = {};
	request.action = TRADE_ACTION_DEAL;
	request.type = ORDER_TYPE_SELL;
	request.position = PositionGetInteger(POSITION_TICKET);
	request.symbol = PositionGetString(POSITION_SYMBOL);
	request.magic = PositionGetInteger(POSITION_MAGIC);
	request.price = tick.bid;
	request.volume = PositionGetDouble(POSITION_VOLUME);
	if (OrderSend(request, result)) return;
}

void _close_sell_position() {
	MqlTick tick;
	if (!SymbolInfoTick(Symbol(), tick)) return;
	if (tick.ask == 0) return;
	MqlTradeRequest request = {};
	MqlTradeResult result = {};
	request.action = TRADE_ACTION_DEAL;
	request.type = ORDER_TYPE_BUY;
	request.position = PositionGetInteger(POSITION_TICKET);
	request.symbol = PositionGetString(POSITION_SYMBOL);
	request.magic = PositionGetInteger(POSITION_MAGIC);
	request.price = tick.ask;
	request.volume = PositionGetDouble(POSITION_VOLUME);
	if (OrderSend(request, result)) return;
}
