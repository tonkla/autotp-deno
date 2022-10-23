// Credits: https://github.com/markcheno/go-talib

import { testing } from '../deps.ts'

import { EMA, MACD, WMA } from './talib.ts'

const testClose = [
  201.28, 197.64, 195.78, 198.22, 201.74, 200.12, 198.55, 197.99, 196.8, 195.0, 197.55, 197.97,
  198.97, 201.93, 200.83, 201.3, 198.64, 196.09, 197.91, 195.42, 197.84, 200.7, 199.93, 201.95,
  201.39, 200.49, 202.63, 202.75, 204.7, 205.54, 205.86, 205.88, 205.73, 206.97, 206.94, 207.53,
  207.35, 207.11, 206.4, 207.7, 206.85, 205.98, 206.2, 203.3, 204.15, 200.84, 200.37, 202.91,
  201.67, 204.36, 203.76, 206.2, 205.26, 207.08, 206.67, 205.51, 202.5, 202.02, 202.48, 204.95,
  203.16, 202.44, 203.17, 204.54, 204.0, 204.68, 205.59, 206.71, 205.78, 206.17, 207.1, 207.04,
  204.66, 206.52, 206.28, 207.29, 207.81, 208.3, 207.43, 208.09, 207.23, 205.16, 207.38, 207.97,
  205.59, 204.74, 205.56, 208.27, 207.27, 206.65, 206.69, 208.85, 209.07, 209.72, 209.65, 209.51,
  210.12, 209.62, 207.36, 209.33, 209.09, 207.79, 208.22, 208.01, 208.56, 206.8, 206.45, 205.18,
  205.15, 207.62, 208.28, 206.68, 205.79, 206.92, 207.25, 209.41, 208.48, 209.55, 209.71, 208.18,
  207.54, 207.5, 203.15, 203.57, 205.21, 205.03, 204.43, 205.71, 202.27, 202.63, 205.19, 207.44,
  208.35, 208.28, 209.95, 210.12, 210.24, 209.42, 209.03, 207.86, 205.7, 204.5, 207.02, 208.44,
  208.49, 208.17, 207.47, 207.06, 207.75, 206.05, 205.65, 208.24, 206.35, 206.61, 206.35, 207.1,
  208.26, 207.66, 206.02, 201.71, 195.64, 187.4, 185.2, 192.31, 197.07, 197.08, 195.48, 189.65,
  193.25, 193.39, 190.46, 195.25, 192.64, 193.68, 194.56, 193.84, 196.26, 197.97, 197.52, 194.29,
  195.3, 192.75, 192.45, 191.76, 191.73, 186.9, 187.01, 190.5, 190.99, 193.85, 197.3, 196.62,
  198.23, 200.02, 200.14, 200.33, 199.07, 198.11, 201.15, 202.07, 202.17, 201.91, 200.66, 204.05,
  206.28, 205.78, 205.38, 207.71, 207.59, 206.7, 209.15, 209.75, 209.12, 208.91, 208.8, 206.85,
  207.33, 206.51, 203.63, 201.34, 204.4, 204.25, 207.5, 207.32, 208.07, 207.83, 208.11, 208.08,
  208.32, 207.46, 209.43, 207.3, 204.39, 208.38, 207.12, 205.73, 204.13, 204.65, 200.69, 201.7,
  203.82, 206.8, 203.65, 200.02, 201.67, 203.5, 206.02, 205.68, 205.21, 207.4, 205.93, 203.87,
]

Deno.test('EMA', () => {
  const results = EMA(testClose, 10)
  const expects = [
    204.61489102021537, 203.77945628926713, 203.39591878212764, 203.41484263992263,
    203.88850761448214, 204.2142335027581, 204.39528195680208, 204.9415943282926,
    205.12130445042123, 204.89379455034464,
  ]
  testing.assertEquals(results.slice(-10, results.length), expects)
})

Deno.test('WMA', () => {
  const results = WMA(testClose, 10)
  const expects = [
    204.07054545455156, 203.2256363636425, 202.83272727273348, 202.87163636364264,
    203.40927272727905, 203.85072727273365, 204.1880000000064, 204.8412727272792, 205.1236363636429,
    204.9930909090975,
  ]
  testing.assertEquals(results.slice(-10, results.length), expects)
})

Deno.test('MACD', () => {
  const [macd, signal, hist] = MACD(testClose, 12, 26, 9)

  const macdExpects = [
    -0.4194046093567465, -0.7691229987700865, -0.9027300218287451, -0.8511374612982934,
    -0.5999907262809927, -0.4235083472642316, -0.31790524863555447, -0.056844071662823126,
    0.031073876924494925, -0.06472914201052049,
  ]
  const signalExpects = [
    -0.016114129480144304, -0.16671590333813274, -0.31391872703625523, -0.4213624738886629,
    -0.45708812436712887, -0.4503721689465494, -0.42387878488435043, -0.35047184224004496,
    -0.274162698407137, -0.23227598712781367,
  ]
  const histExpects = [
    -0.4032904798766022, -0.6024070954319538, -0.5888112947924898, -0.4297749874096305,
    -0.14290260191386384, 0.026863821682317823, 0.10597353624879596, 0.29362777057722184,
    0.3052365753316319, 0.16754684511729317,
  ]

  testing.assertEquals(macd.slice(-10, macd.length), macdExpects)
  testing.assertEquals(signal.slice(-10, signal.length), signalExpects)
  testing.assertEquals(hist.slice(-10, hist.length), histExpects)
})
