export const PATTERN_KINDS = [
  "doji",
  "hammer",
  "inverted_hammer",
  "hanging_man",
  "shooting_star",
  "bullish_engulfing",
  "bearish_engulfing",
  "bullish_harami",
  "bearish_harami",
  "piercing_line",
  "dark_cloud_cover",
  "morning_star",
  "evening_star",
  "three_white_soldiers",
  "three_black_crows",
  "bullish_marubozu",
  "bearish_marubozu",
  "tweezer_top",
  "tweezer_bottom",
  "spinning_top",
  "three_inside_up",
  "three_inside_down",
  "bullish_kicker",
  "bearish_kicker",
  "bullish_abandoned_baby",
  "bearish_abandoned_baby",
  "inside_bar",
  "bullish_outside_bar",
  "bearish_outside_bar",
  "dragonfly_doji",
  "gravestone_doji",
  "three_outside_up",
  "three_outside_down",
  "rising_three_methods",
  "falling_three_methods",
] as const;

export type PatternKind = (typeof PATTERN_KINDS)[number];
export type Bias = "bullish" | "bearish" | "neutral";

export interface PatternInfo {
  name: string;
  bias: Bias;
  text: string;
}

export const PATTERN_INFO: Record<PatternKind, PatternInfo> = {
  doji: { name: "Doji", bias: "neutral", text: "Open and close are almost equal, so neither buyers nor sellers won the bar. After a trend it warns the move is losing steam." },
  hammer: { name: "Hammer", bias: "bullish", text: "A small body with a long lower shadow after a decline. Sellers pushed price down but buyers took it back, which hints at a bottom." },
  inverted_hammer: { name: "Inverted hammer", bias: "bullish", text: "A small body with a long upper shadow after a decline. Buyers tried to lift price; a strong next candle would confirm a reversal up." },
  hanging_man: { name: "Hanging man", bias: "bearish", text: "A hammer-shaped candle after a rally. Sellers showed up despite the close near the high, a warning that the uptrend may be tiring." },
  shooting_star: { name: "Shooting star", bias: "bearish", text: "A small body with a long upper shadow after a rally. Buyers were rejected at the highs, which hints at a top." },
  bullish_engulfing: { name: "Bullish engulfing", bias: "bullish", text: "A large up candle whose body covers the prior down candle's body. Buyers have taken control from sellers, suggesting a move up." },
  bearish_engulfing: { name: "Bearish engulfing", bias: "bearish", text: "A large down candle whose body covers the prior up candle's body. Sellers have taken control from buyers, suggesting a move down." },
  bullish_harami: { name: "Bullish harami", bias: "bullish", text: "A small candle held inside the body of a large down candle. Selling momentum is fading, which can precede a bounce." },
  bearish_harami: { name: "Bearish harami", bias: "bearish", text: "A small candle held inside the body of a large up candle. Buying momentum is fading, which can precede a pullback." },
  piercing_line: { name: "Piercing line", bias: "bullish", text: "After a long down candle, price opens lower but closes above its midpoint. Buyers reversed most of the loss, suggesting a bottom." },
  dark_cloud_cover: { name: "Dark cloud cover", bias: "bearish", text: "After a long up candle, price opens higher but closes below its midpoint. Sellers reversed most of the gain, suggesting a top." },
  morning_star: { name: "Morning star", bias: "bullish", text: "A long down candle, a small indecisive candle, then a long up candle closing past the first's midpoint. A classic three-bar bottom." },
  evening_star: { name: "Evening star", bias: "bearish", text: "A long up candle, a small indecisive candle, then a long down candle closing past the first's midpoint. A classic three-bar top." },
  three_white_soldiers: { name: "Three white soldiers", bias: "bullish", text: "Three consecutive long up candles, each opening inside the last body and closing higher. Steady buying that suggests a strong advance." },
  three_black_crows: { name: "Three black crows", bias: "bearish", text: "Three consecutive long down candles, each opening inside the last body and closing lower. Steady selling that suggests a strong decline." },
  bullish_marubozu: { name: "Bullish marubozu", bias: "bullish", text: "A long up candle with almost no shadows: buyers controlled the whole bar from open to close. It suggests strong buying pressure." },
  bearish_marubozu: { name: "Bearish marubozu", bias: "bearish", text: "A long down candle with almost no shadows: sellers controlled the whole bar from open to close. It suggests strong selling pressure." },
  tweezer_top: { name: "Tweezer top", bias: "bearish", text: "An up candle followed by a down candle with matching highs. Price failed twice at the same level, which hints at resistance and a top." },
  tweezer_bottom: { name: "Tweezer bottom", bias: "bullish", text: "A down candle followed by an up candle with matching lows. Price held twice at the same level, which hints at support and a bottom." },
  spinning_top: { name: "Spinning top", bias: "neutral", text: "A small body with shadows on both sides. Buyers and sellers pushed both ways and ended near even; it signals indecision, not direction." },
  three_inside_up: { name: "Three inside up", bias: "bullish", text: "A bullish harami confirmed by a third up candle that closes above the first candle's open. Suggests the downtrend has turned." },
  three_inside_down: { name: "Three inside down", bias: "bearish", text: "A bearish harami confirmed by a third down candle that closes below the first candle's open. Suggests the uptrend has turned." },
  bullish_kicker: { name: "Bullish kicker", bias: "bullish", text: "A long down candle followed by a long up candle that opens above the prior open. An abrupt change in sentiment that suggests a sharp move up." },
  bearish_kicker: { name: "Bearish kicker", bias: "bearish", text: "A long up candle followed by a long down candle that opens below the prior open. An abrupt change in sentiment that suggests a sharp move down." },
  bullish_abandoned_baby: { name: "Bullish abandoned baby", bias: "bullish", text: "A doji gapped fully below a down candle and above the next up candle, isolated by gaps. A rare, strong bottom signal." },
  bearish_abandoned_baby: { name: "Bearish abandoned baby", bias: "bearish", text: "A doji gapped fully above an up candle and below the next down candle, isolated by gaps. A rare, strong top signal." },
  inside_bar: { name: "Inside bar", bias: "neutral", text: "A candle whose high and low sit inside the prior candle's range. The market is pausing; a break of the prior candle's high or low often starts the next move." },
  bullish_outside_bar: { name: "Bullish outside bar", bias: "bullish", text: "An up candle whose range covers the prior candle's high and low. Sellers were tested and buyers closed it strong, which hints at a turn up." },
  bearish_outside_bar: { name: "Bearish outside bar", bias: "bearish", text: "A down candle whose range covers the prior candle's high and low. Buyers were tested and sellers closed it weak, which hints at a turn down." },
  dragonfly_doji: { name: "Dragonfly doji", bias: "bullish", text: "Open, high and close at nearly the same price with a long lower shadow, after a decline. Sellers pushed down and buyers took it all back, hinting at a bottom." },
  gravestone_doji: { name: "Gravestone doji", bias: "bearish", text: "Open, low and close at nearly the same price with a long upper shadow, after a rally. Buyers pushed up and sellers took it all back, hinting at a top." },
  three_outside_up: { name: "Three outside up", bias: "bullish", text: "A bullish engulfing pair confirmed by a third up candle that closes higher still. Suggests the downtrend has turned." },
  three_outside_down: { name: "Three outside down", bias: "bearish", text: "A bearish engulfing pair confirmed by a third down candle that closes lower still. Suggests the uptrend has turned." },
  rising_three_methods: { name: "Rising three methods", bias: "bullish", text: "A long up candle, three small candles drifting down inside its range, then a long up candle closing at a new high. A pause in an uptrend that resumes." },
  falling_three_methods: { name: "Falling three methods", bias: "bearish", text: "A long down candle, three small candles drifting up inside its range, then a long down candle closing at a new low. A pause in a downtrend that resumes." },
};

export const CHART_PATTERN_KINDS = [
  "head_and_shoulders",
  "inverse_head_and_shoulders",
  "double_top",
  "double_bottom",
  "triple_top",
  "triple_bottom",
  "ascending_triangle",
  "descending_triangle",
  "symmetrical_triangle",
  "bull_flag",
  "bear_flag",
  "rising_wedge",
  "falling_wedge",
  "bull_pennant",
  "bear_pennant",
  "rectangle",
  "rising_channel",
  "falling_channel",
  "cup_and_handle",
  "bullish_fvg",
  "bearish_fvg",
  "bullish_sweep",
  "bearish_sweep",
] as const;

export type ChartPatternKind = (typeof CHART_PATTERN_KINDS)[number];

export const CHART_PATTERN_INFO: Record<ChartPatternKind, PatternInfo> = {
  head_and_shoulders: { name: "Head and shoulders", bias: "bearish", text: "Three peaks with the middle one highest, resting on a neckline through the two troughs. A close below the neckline completes a top." },
  inverse_head_and_shoulders: { name: "Inverse head and shoulders", bias: "bullish", text: "Three troughs with the middle one lowest, under a neckline through the two peaks. A close above the neckline completes a bottom." },
  double_top: { name: "Double top", bias: "bearish", text: "Two peaks at about the same price with a trough between. Buyers failed twice; a close below the trough confirms the top." },
  double_bottom: { name: "Double bottom", bias: "bullish", text: "Two troughs at about the same price with a peak between. Sellers failed twice; a close above the peak confirms the bottom." },
  triple_top: { name: "Triple top", bias: "bearish", text: "Three peaks at about the same price. Resistance held three times; a close below the troughs between them confirms the top." },
  triple_bottom: { name: "Triple bottom", bias: "bullish", text: "Three troughs at about the same price. Support held three times; a close above the peaks between them confirms the bottom." },
  ascending_triangle: { name: "Ascending triangle", bias: "bullish", text: "Flat highs and rising lows squeeze price against resistance. Buyers are getting more eager; a close above the highs is the usual breakout." },
  descending_triangle: { name: "Descending triangle", bias: "bearish", text: "Flat lows and falling highs squeeze price against support. Sellers are getting more eager; a close below the lows is the usual breakdown." },
  symmetrical_triangle: { name: "Symmetrical triangle", bias: "neutral", text: "Falling highs and rising lows converge as the range tightens. Neither side leads; the breakout direction sets the next move." },
  bull_flag: { name: "Bull flag", bias: "bullish", text: "A sharp rise (the pole) followed by a small, flat or downward-sloping channel. A close above the channel suggests the rise resumes." },
  bear_flag: { name: "Bear flag", bias: "bearish", text: "A sharp drop (the pole) followed by a small, flat or upward-sloping channel. A close below the channel suggests the drop resumes." },
  rising_wedge: { name: "Rising wedge", bias: "bearish", text: "Highs and lows both rise but the lows rise faster, so the range narrows. Buying is losing steam; it usually breaks down." },
  falling_wedge: { name: "Falling wedge", bias: "bullish", text: "Highs and lows both fall but the highs fall faster, so the range narrows. Selling is losing steam; it usually breaks up." },
  bull_pennant: { name: "Bull pennant", bias: "bullish", text: "A sharp rise (the pole) followed by a small triangle of falling highs and rising lows. A close above the triangle suggests the rise resumes." },
  bear_pennant: { name: "Bear pennant", bias: "bearish", text: "A sharp drop (the pole) followed by a small triangle of falling highs and rising lows. A close below the triangle suggests the drop resumes." },
  rectangle: { name: "Rectangle", bias: "neutral", text: "Flat highs and flat lows box price into a range. Neither side leads; a close outside the box sets the next move." },
  rising_channel: { name: "Rising channel", bias: "bullish", text: "Highs and lows rise along two parallel lines. Buyers are in control while price stays inside; a close below the channel warns the trend is fading." },
  falling_channel: { name: "Falling channel", bias: "bearish", text: "Highs and lows fall along two parallel lines. Sellers are in control while price stays inside; a close above the channel warns the trend is fading." },
  cup_and_handle: { name: "Cup and handle", bias: "bullish", text: "A rounded bottom between two similar highs, then a shallow pullback (the handle). A close above the rim confirms the breakout." },
  bullish_fvg: { name: "Bullish fair value gap", bias: "bullish", text: "A fast rise leaves a gap between one candle's high and the low two candles later. Price often comes back to the gap, and buyers tend to defend it." },
  bearish_fvg: { name: "Bearish fair value gap", bias: "bearish", text: "A fast drop leaves a gap between one candle's low and the high two candles later. Price often comes back to the gap, and sellers tend to defend it." },
  bullish_sweep: { name: "Bullish liquidity sweep", bias: "bullish", text: "Price dips below a prior swing low, then closes back above it. Sellers who broke the low got trapped, which often fuels a move up." },
  bearish_sweep: { name: "Bearish liquidity sweep", bias: "bearish", text: "Price pokes above a prior swing high, then closes back below it. Buyers who chased the breakout got trapped, which often fuels a move down." },
};

export function isPatternKind(kind: string): kind is PatternKind {
  return (PATTERN_KINDS as readonly string[]).includes(kind);
}

export function isChartPatternKind(kind: string): kind is ChartPatternKind {
  return (CHART_PATTERN_KINDS as readonly string[]).includes(kind);
}

export function patternInfo(kind: string): PatternInfo | null {
  return isPatternKind(kind) ? PATTERN_INFO[kind] : isChartPatternKind(kind) ? CHART_PATTERN_INFO[kind] : null;
}
