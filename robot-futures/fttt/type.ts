export interface TaValues {
  t_0: number
  h_0: number
  h_1: number
  h_2: number
  l_0: number
  l_1: number
  l_2: number
  c_0: number
  c_1: number
  hma_0: number
  hma_1: number
  lma_0: number
  lma_1: number
  cma_0: number
  cma_1: number
  atr: number
  slope: number
}

export interface TaValues_v2 {
  hma_0: number
  hma_1: number
  lma_0: number
  lma_1: number
  cma_0: number
  cma_1: number
  atr: number
}

export interface TaMA {
  c: number
  hma_0: number
  hma_1: number
  lma_0: number
  lma_1: number
  cma_0: number
  cma_1: number
  atr: number
  slope: number
}

export interface TaPC {
  o: number
  h: number
  l: number
  c: number
  hl: number
  hc: number
  cl: number
  co: number
}

export interface TaValues_v3 {
  w: TaMA & TaPC
  d: TaMA & TaPC
  h: TaMA & TaPC
}

export interface TaValuesX {
  t_0: number
  o_0: number
  h_0: number
  l_0: number
  c_0: number
  hl: number
  hc: number
  cl: number
  co: number
  hma_0: number
  hma_1: number
  lma_0: number
  lma_1: number
  cma_0: number
  cma_1: number
  atr: number
  x_9: number
  x_8: number
  x_7: number
  x_6: number
  x_5: number
  x_4: number
  x_3: number
  x_2: number
  x_1: number
}

export interface TaValuesOHLC {
  o_0: number
  h_0: number
  l_0: number
  c_0: number

  o_1: number
  h_1: number
  l_1: number
  c_1: number

  o_2: number
  h_2: number
  l_2: number
  c_2: number

  hma_0: number
  hma_1: number
  lma_0: number
  lma_1: number
  cma_0: number
  cma_1: number
  mma_0: number
  mma_1: number

  atr: number

  slope: number
  // pc_0: number
  // pc_1: number
  // pc_2: number
}

export interface TaValuesOHLC_v2 {
  o_0: number
  h_0: number
  l_0: number
  c_0: number
  hl: number
  hc: number
  cl: number
  co: number
  hma_0: number
  lma_0: number
  cma_0: number
  atr: number
}
