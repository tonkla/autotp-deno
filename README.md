# AutoTP (Deno)

AutoTP aims to be an automated trading platform that supports various exchanges, with a primary focus on Binance. It draws inspiration from MetaTrader and [MQL5](https://www.mql5.com/en/docs).

This version serves as a successor to [AutoTP-Go](https://github.com/tonkla/autotp-go-v1). After encountering some issues with Binance APIs in v1, such as rate limits on data feed, order/position status tracking, etc., I needed to address these problems within a shorter R&D cycle. To achieve this, I opted for TypeScript and [Deno](https://github.com/denoland/deno) while using Redis and PostgreSQL instead of SQLite for remote database access, avoiding the need to sync SQLite database file (SQLite's performance is excellent for this application).

The platform functions as well as I had hoped, but the pluggable robots do not, primarily due to the market sentiment, a lack of volatility and volume in the cryptocurrency market, and, admittedly, my own trading strategies.

I'm rewriting v3 with [Bun](https://github.com/oven-sh/bun) v1.0, which shows a significant improvement in terms of performance and resource consumption, closely resembling the Go implementation, while still maintaining the excellent pace of TypeScript in R&D productivity.
