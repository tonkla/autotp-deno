#property copyright "Stradeji"
#property link      "https://www.stradeji.com"
#property version   "1.0"
#property strict

#include <Trade\Trade.mqh>
CTrade ctrade;

ulong MY_ACCOUNT_ID = 61119160;

input int magic_ = 1;
double lots_ = 0.01;
double mos_entry = 0.2;
double mos_open = 0.2;
double gap_atr = 0.15;
double sl_atr = 1;
double tp_atr = 0.2;
int max_orders = 4;
int max_spread = Symbol() == "XAUUSD" ? 20 : 10;

double d_ma_h_0, d_ma_l_0, d_ma_c_0, d_ma_c_1, d_csl_0, d_atr;
int d_macd, d_macd_hst;
double h_ma_h_0, h_ma_l_0, h_ma_c_0, h_ma_c_1, h_csl_0, h_atr;
int h_macd, h_macd_hst;
double m_ma_h_0, m_ma_l_0, m_ma_c_0, m_ma_c_1, m_csl_0, m_atr;
int m_macd, m_macd_hst;

ulong buy_orders[], sell_orders[], buy_positions[], sell_positions[];
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
	open_buy();
	open_sell();
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

	double Ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
	double Bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);

	ulong ticket;
	for (int i = OrdersTotal() - 1; i >= 0; i--) {
		ticket = OrderGetTicket(i);
		if (ticket == 0) continue;
		if (OrderGetString(ORDER_SYMBOL) != Symbol() ||
				OrderGetInteger(ORDER_MAGIC) != magic_) continue;
		open_price = OrderGetDouble(ORDER_PRICE_OPEN);
		if (OrderGetInteger(ORDER_TYPE) == ORDER_TYPE_BUY_LIMIT) {
			size = ArraySize(buy_orders);
			ArrayResize(buy_orders, size + 1);
			buy_orders[size] = ticket;
			if (buy_nearest_price == 0 || MathAbs(open_price - Bid) < MathAbs(buy_nearest_price - Bid)) {
				buy_nearest_price = open_price;
			}
		} else if (OrderGetInteger(ORDER_TYPE) == ORDER_TYPE_SELL_LIMIT) {
			size = ArraySize(sell_orders);
			ArrayResize(sell_orders, size + 1);
			sell_orders[size] = ticket;
			if (sell_nearest_price == 0 || MathAbs(open_price - Ask) < MathAbs(sell_nearest_price - Ask)) {
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

	double Ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
	double Bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);

	ulong ticket;
	for (int i = PositionsTotal() - 1; i >= 0; i--) {
		ticket = PositionGetTicket(i);
		if (ticket == 0) continue;
		if (PositionGetString(POSITION_SYMBOL) != Symbol() ||
				PositionGetInteger(POSITION_MAGIC) != magic_) continue;
		open_price = PositionGetDouble(POSITION_PRICE_OPEN);
		if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) {
			size = ArraySize(buy_positions);
			ArrayResize(buy_positions, size + 1);
			buy_positions[size] = ticket;
			if (buy_nearest_price == 0 || MathAbs(open_price - Bid) < MathAbs(buy_nearest_price - Bid)) {
				buy_nearest_price = open_price;
			}
		} else if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL) {
			size = ArraySize(sell_positions);
			ArrayResize(sell_positions, size + 1);
			sell_positions[size] = ticket;
			if (sell_nearest_price == 0 || MathAbs(open_price - Ask) < MathAbs(sell_nearest_price - Ask)) {
				sell_nearest_price = open_price;
			}
		}
	}
}

void open_buy() {
	// Rest on Friday, 21:00:00 UTC
	MqlDateTime time;
	TimeGMT(time);
	if (time.hour >= 21 && time.day_of_week == 5) return;

	if (SymbolInfoInteger(Symbol(), SYMBOL_SPREAD) > max_spread) return;

	bool is_up	= d_macd > 0 && d_macd_hst > 0 && d_csl_0 > 0 &&
								h_macd > 0 && h_macd_hst > 0 && h_csl_0 > 0 &&
								m_macd > 0 && m_macd_hst > 0 && m_csl_0 > 0;
	if (!is_up) return;

	double Bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
	if (Bid - d_ma_c_0 > mos_entry * d_atr) return;
	if (Bid > h_ma_h_0) return;
	if (Bid > m_ma_h_0) return;

	double Open = iOpen(Symbol(), PERIOD_D1, 0);
	if (Open - d_ma_c_0 > mos_open * d_atr) return;

	if (ArraySize(buy_orders) + ArraySize(buy_positions) >= max_orders) return;
	if (buy_nearest_price > 0 && MathAbs(Bid - buy_nearest_price) < gap_atr * d_atr) return;

	MqlTradeRequest request = {};
	MqlTradeResult result = {};
	request.symbol = Symbol();
	request.action = TRADE_ACTION_PENDING;
	request.type = ORDER_TYPE_BUY_LIMIT;
	request.price = Bid;
	request.volume = lots_;
	request.magic = magic_;
	request.expiration = TimeCurrent() + 10 * 60;
	if (OrderSend(request, result)) return;
}

void open_sell() {
	// Rest on Friday, 21:00:00 UTC
	MqlDateTime time;
	TimeGMT(time);
	if (time.hour >= 21 && time.day_of_week == 5) return;

	if (SymbolInfoInteger(Symbol(), SYMBOL_SPREAD) > max_spread) return;

	bool is_down 	= d_macd < 0 && d_macd_hst < 0 && d_csl_0 < 0 &&
									h_macd < 0 && h_macd_hst < 0 && h_csl_0 < 0 &&
									m_macd < 0 && m_macd_hst < 0 && m_csl_0 < 0;
	if (!is_down) return;

	double Ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
	if (d_ma_c_0 - Ask > mos_entry * d_atr) return;
	if (Ask < h_ma_l_0) return;
	if (Ask < m_ma_l_0) return;

	double Open = iOpen(Symbol(), PERIOD_D1, 0);
	if (d_ma_c_0 - Open > mos_open * d_atr) return;

	if (ArraySize(sell_orders) + ArraySize(sell_positions) >= max_orders) return;
	if (sell_nearest_price > 0 && MathAbs(Ask - sell_nearest_price) < gap_atr * d_atr) return;

	MqlTradeRequest request = {};
	MqlTradeResult result = {};
	request.symbol = Symbol();
	request.action = TRADE_ACTION_PENDING;
	request.type = ORDER_TYPE_SELL_LIMIT;
	request.price = Ask;
	request.volume = lots_;
	request.magic = magic_;
	request.expiration = TimeCurrent() + 10 * 60;
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

	double Bid;
	ulong ticket;
	long open_time;
	double open_price;
	bool should_close;

	for (int i = 0; i < ArraySize(buy_positions); i++) {
		if (!PositionSelectByTicket(buy_positions[i])) continue;

		Bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
		ticket = PositionGetInteger(POSITION_TICKET);
		open_time = PositionGetInteger(POSITION_TIME);
		open_price = PositionGetDouble(POSITION_PRICE_OPEN);

		should_close = (open_time < iTime(Symbol(), PERIOD_D1, 0) && open_price < Bid) ||
									 (open_time + 20 * 60 < TimeCurrent() && d_macd_hst < 0 && d_csl_0 < 0);
		if (should_close) {
			ctrade.PositionClose(ticket);
		}
		if (sl_atr > 0 && open_price - Bid > sl_atr * d_atr) {
			ctrade.PositionClose(ticket);
		}
		if (tp_atr > 0 && Bid - open_price > tp_atr * d_atr) {
			ctrade.PositionClose(ticket);
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

	double Ask;
	ulong ticket;
	long open_time;
	double open_price;
	bool should_close;

	for (int i = 0; i < ArraySize(sell_positions); i++) {
		if (!PositionSelectByTicket(sell_positions[i])) continue;

		Ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
		ticket = PositionGetInteger(POSITION_TICKET);
		open_time = PositionGetInteger(POSITION_TIME);
		open_price = PositionGetDouble(POSITION_PRICE_OPEN);

		should_close = (open_time < iTime(Symbol(), PERIOD_D1, 0) && open_price > Ask) ||
									 (open_time + 20 * 60 < TimeCurrent() && d_macd_hst > 0 && d_csl_0 > 0);
		if (should_close) {
			ctrade.PositionClose(ticket);
		}
		if (sl_atr > 0 && Ask - open_price > sl_atr * d_atr) {
			ctrade.PositionClose(ticket);
		}
		if (tp_atr > 0 && open_price - Ask > tp_atr * d_atr) {
			ctrade.PositionClose(ticket);
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
		ctrade.PositionClose(PositionGetInteger(POSITION_TICKET));
	}
}

void _close_sell_positions() {
	for (int i = 0; i < ArraySize(sell_positions); i++) {
		if (!PositionSelectByTicket(sell_positions[i])) continue;
		ctrade.PositionClose(PositionGetInteger(POSITION_TICKET));
	}
}
