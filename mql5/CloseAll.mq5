#include <Trade\PositionInfo.mqh>
#include <Trade\Trade.mqh>

CPositionInfo  m_position;
CTrade         m_trade;

void OnStart() {
	for (int i = 0; i < PositionsTotal(); i++) {
		if (!m_position.SelectByIndex(i)) continue;
		if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
		m_trade.PositionClose(m_position.Ticket());
	}
}
