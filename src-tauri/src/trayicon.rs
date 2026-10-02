//! Tray icon: the company logo (or a candle glyph) in a rounded square,
//! with a small up/down/closed badge in the bottom-right corner.

use image::imageops::FilterType;

/// Pixel size of the icon. The macOS menu bar draws it 18pt tall, which is
/// 36 px on Retina; a 32 px icon would be upscaled and blurry there.
#[cfg(target_os = "macos")]
pub const SIZE: u32 = 36;
#[cfg(not(target_os = "macos"))]
pub const SIZE: u32 = 32;
/// The shapes below are drawn on a 32-unit grid and scaled to SIZE.
const GRID: f64 = 32.0;
const RADIUS: f64 = 7.0;
const BADGE_R: f64 = 7.0;
const BADGE_C: (f64, f64) = (24.5, 24.5);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Badge {
    Up,
    Down,
    Closed,
    None,
}

const UP: [u8; 3] = [52, 199, 89];
const DOWN: [u8; 3] = [255, 69, 58];
const GRAY: [u8; 3] = [142, 142, 147];
const BG: [u8; 3] = [28, 28, 30];

/// Signed distance to a rounded square covering the whole icon.
fn rounded_sq(x: f64, y: f64) -> f64 {
    let q = |v: f64| (v - GRID / 2.0).abs() - (GRID / 2.0 - RADIUS);
    let (qx, qy) = (q(x), q(y));
    let outside = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt();
    outside + qx.max(qy).min(0.0) - RADIUS
}

/// The 4x4 subsample points of a pixel, in grid units.
fn samples(px: u32, py: u32) -> impl Iterator<Item = (f64, f64)> {
    let k = GRID / SIZE as f64;
    (0..16).map(move |i| {
        let (sx, sy) = ((i % 4) as f64, (i / 4) as f64);
        ((px as f64 + (sx + 0.5) / 4.0) * k, (py as f64 + (sy + 0.5) / 4.0) * k)
    })
}

/// Supersampled coverage (0..1) of a shape given as an inside test.
fn coverage(px: u32, py: u32, inside: impl Fn(f64, f64) -> bool) -> f64 {
    samples(px, py).filter(|&(x, y)| inside(x, y)).count() as f64 / 16.0
}

/// Source-over blend of an RGB color at `a` onto a premultiplied-free RGBA pixel.
fn blend(px: &mut [u8], rgb: [u8; 3], a: f64) {
    if a <= 0.0 {
        return;
    }
    let da = px[3] as f64 / 255.0;
    let oa = a + da * (1.0 - a);
    for i in 0..3 {
        let c = (rgb[i] as f64 * a + px[i] as f64 * da * (1.0 - a)) / oa;
        px[i] = c.round() as u8;
    }
    px[3] = (oa * 255.0).round() as u8;
}

/// Three small candles, used when no logo is available.
fn glyph(x: f64, y: f64) -> Option<[u8; 3]> {
    // (center x, wick top, body top, body bottom, wick bottom, color)
    let candles = [(9.0, 12.0, 15.0, 22.0, 25.0, DOWN), (16.0, 7.0, 10.0, 18.0, 21.0, UP), (23.0, 5.0, 7.0, 14.0, 17.0, UP)];
    for (cx, wt, bt, bb, wb, col) in candles {
        let body = (x - cx).abs() <= 2.5 && y >= bt && y <= bb;
        let wick = (x - cx).abs() <= 0.6 && y >= wt && y <= wb;
        if body || wick {
            return Some(col);
        }
    }
    None
}

fn in_triangle(x: f64, y: f64, up: bool) -> bool {
    let (cx, cy) = BADGE_C;
    let (w, h) = (4.2, 3.8);
    let dy = if up { y - (cy - h / 2.0) } else { (cy + h / 2.0) - y };
    if !(0.0..=h).contains(&dy) {
        return false;
    }
    (x - cx).abs() <= w * dy / h
}

/// Composes the icon as SIZE x SIZE RGBA.
pub fn compose(logo_png: Option<&[u8]>, badge: Badge) -> Vec<u8> {
    let s = SIZE as usize;
    let logo = logo_png
        .and_then(|b| image::load_from_memory(b).ok())
        .map(|img| image::imageops::resize(&img.to_rgba8(), SIZE, SIZE, FilterType::Lanczos3));

    let mut out = vec![0u8; s * s * 4];
    for py in 0..SIZE {
        for px in 0..SIZE {
            let i = (py as usize * s + px as usize) * 4;
            let mask = coverage(px, py, |x, y| rounded_sq(x, y) <= 0.0);
            let p = &mut out[i..i + 4];
            match &logo {
                Some(l) => {
                    // White underlay so transparent logos stay visible on dark taskbars.
                    blend(p, [255, 255, 255], mask);
                    let lp = l.get_pixel(px, py).0;
                    blend(p, [lp[0], lp[1], lp[2]], mask * lp[3] as f64 / 255.0);
                }
                None => {
                    blend(p, BG, mask);
                    let mut acc = [0.0f64; 3];
                    let mut n = 0.0;
                    for (x, y) in samples(px, py) {
                        if let Some(c) = glyph(x, y) {
                            for k in 0..3 {
                                acc[k] += c[k] as f64;
                            }
                            n += 1.0;
                        }
                    }
                    if n > 0.0 {
                        let c = [(acc[0] / n) as u8, (acc[1] / n) as u8, (acc[2] / n) as u8];
                        blend(p, c, mask * n / 16.0);
                    }
                }
            }

            let color = match badge {
                Badge::Up => UP,
                Badge::Down => DOWN,
                Badge::Closed => GRAY,
                Badge::None => continue,
            };
            let (cx, cy) = BADGE_C;
            let d = |x: f64, y: f64| ((x - cx).powi(2) + (y - cy).powi(2)).sqrt();
            // Dark ring separates the badge from the logo.
            blend(p, BG, coverage(px, py, |x, y| d(x, y) <= BADGE_R + 1.5));
            blend(p, color, coverage(px, py, |x, y| d(x, y) <= BADGE_R));
            let tri = match badge {
                Badge::Up => coverage(px, py, |x, y| in_triangle(x, y, true)),
                Badge::Down => coverage(px, py, |x, y| in_triangle(x, y, false)),
                _ => 0.0,
            };
            blend(p, [255, 255, 255], tri);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOGO: &[u8] = include_bytes!("../../fixtures/logo-aapl.png");

    fn px(img: &[u8], x: usize, y: usize) -> [u8; 4] {
        let i = (y * SIZE as usize + x) * 4;
        [img[i], img[i + 1], img[i + 2], img[i + 3]]
    }

    #[test]
    fn size_and_corners() {
        let img = compose(None, Badge::None);
        assert_eq!(img.len(), (SIZE * SIZE * 4) as usize);
        assert_eq!(px(&img, 0, 0)[3], 0, "rounded corner is transparent");
        assert_eq!(px(&img, 16, 2)[3], 255, "inside is opaque");
    }

    #[test]
    fn badge_colors() {
        let (cx, cy) = (BADGE_C.0 as usize, (BADGE_C.1 + 5.0) as usize);
        let up = compose(None, Badge::Up);
        let down = compose(None, Badge::Down);
        assert_eq!(&px(&up, cx, cy)[..3], &UP);
        assert_eq!(&px(&down, cx, cy - 10)[..3], &DOWN);
        // Triangle center is white.
        assert_eq!(&px(&up, cx, BADGE_C.1 as usize)[..3], &[255, 255, 255]);
    }

    #[test]
    fn logo_is_used() {
        let with = compose(Some(LOGO), Badge::None);
        let without = compose(None, Badge::None);
        assert_ne!(with, without);
        // Garbage bytes fall back to the glyph.
        assert_eq!(compose(Some(b"nope"), Badge::None), without);
    }
}
