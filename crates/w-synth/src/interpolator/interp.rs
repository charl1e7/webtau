pub trait Interpolator {
    // basic interpolator trait, uniform interpolation only
    fn sample(&self, x: f64) -> f64;
}

struct CubicCoefficients {
    // store coefficients for cubic equations
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
}

pub struct Akima<'a> {
    // Akima interpolator
    curve: &'a Vec<f64>,
    coeffs: Vec<CubicCoefficients>,
}

impl<'a> Akima<'a> {
    pub fn new(curve: &'a Vec<f64>) -> Akima<'a> {
        // Calculations based on scipy implementation https://github.com/scipy/scipy/blob/v1.14.0/scipy/interpolate/_cubic.py#L395-L581
        // and Wikipedia article https://en.wikipedia.org/wiki/Akima_spline
        let n = curve.len() - 1;
        let mut coeffs: Vec<CubicCoefficients> = Vec::with_capacity(n);
        let mut m: Vec<f64> = Vec::with_capacity(n + 4);
        let mut s: Vec<f64> = Vec::with_capacity(n + 1);

        for i in 0..n {
            m.push(curve[i + 1] - curve[i]);
        }

        // Derivatives for first and last points are set to zero, the only modification to Akima spline made here
        m.insert(0, 0.);
        m.insert(0, 0.);
        m.push(0.);
        m.push(0.);

        for i in 0..n + 1 {
            let i = i + 2;
            let weight_1 = (m[i + 1] - m[i]).abs();
            let weight_2 = (m[i - 1] - m[i - 2]).abs();
            let tally = weight_1 + weight_2;
            s.push(if tally == 0. {
                (m[i - 1] + m[i]) / 2.
            } else {
                (weight_1 * m[i - 1] + weight_2 * m[i]) / tally
            });
        }

        for i in 0..n {
            coeffs.push(CubicCoefficients {
                a: curve[i],
                b: s[i],
                c: 3. * m[i + 2] - 2. * s[i] - s[i + 1],
                d: s[i] + s[i + 1] - 2. * m[i + 2],
            })
        }

        Self { curve, coeffs }
    }
}

impl Interpolator for Akima<'_> {
    fn sample(&self, x: f64) -> f64 {
        let x = x.clamp(0., self.curve.len() as f64 - 1.);
        if x == self.curve.len() as f64 - 1. {
            return self.curve[self.curve.len() - 1];
        }
        if x == 0. {
            return self.curve[0];
        }
        let index = x.floor() as usize;
        let r = x.fract();
        let coeff = &self.coeffs[index];

        coeff.a + coeff.b * r + coeff.c * r * r + coeff.d * r * r * r
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_through_its_knots() {
        let curve = vec![0.0, 2.0, 1.0, 5.0, 5.0, 3.0];
        let spline = Akima::new(&curve);
        for (i, v) in curve.iter().enumerate() {
            assert!((spline.sample(i as f64) - v).abs() < 1e-9, "knot {i}");
        }
    }

    #[test]
    fn a_straight_line_stays_straight_away_from_the_ends() {
        // The end slopes are set to zero on purpose (as in the original engine), so only the interior is straight.
        let curve: Vec<f64> = (0..10).map(|i| 3.0 + 2.0 * i as f64).collect();
        let spline = Akima::new(&curve);
        for k in 30..60 {
            let x = k as f64 / 10.0;
            assert!((spline.sample(x) - (3.0 + 2.0 * x)).abs() < 1e-9, "x = {x}");
        }
    }

    #[test]
    fn does_not_overshoot_a_step() {
        let curve = vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let spline = Akima::new(&curve);
        for k in 0..50 {
            let v = spline.sample(k as f64 / 10.0);
            assert!((-0.05..=1.05).contains(&v), "overshoot {v}");
        }
    }

    #[test]
    fn positions_outside_the_curve_hold_the_end_values() {
        let curve = vec![4.0, 5.0, 9.0];
        let spline = Akima::new(&curve);
        assert_eq!(spline.sample(-100.0), 4.0);
        assert_eq!(spline.sample(100.0), 9.0);
        assert_eq!(spline.sample(f64::INFINITY), 9.0);
    }

    #[test]
    fn short_curves() {
        let one = vec![7.0];
        assert_eq!(Akima::new(&one).sample(0.0), 7.0);
        assert_eq!(Akima::new(&one).sample(3.0), 7.0);
        let two = vec![1.0, 3.0];
        let s = Akima::new(&two);
        assert!((s.sample(0.5) - 2.0).abs() < 1e-9);
        let three = vec![1.0, 3.0, 2.0];
        let s = Akima::new(&three);
        assert!(s.sample(1.5).is_finite());
    }

    #[test]
    fn values_stay_within_a_sane_range_for_random_curves() {
        let mut seed = 99u64;
        for _ in 0..200 {
            let n = 2 + (seed % 40) as usize;
            let curve: Vec<f64> = (0..n)
                .map(|_| {
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                    ((seed >> 40) as f64 / (1u64 << 24) as f64) * 20.0 - 10.0
                })
                .collect();
            let (lo, hi) = curve.iter().fold((f64::MAX, f64::MIN), |(a, b), v| (a.min(*v), b.max(*v)));
            let spline = Akima::new(&curve);
            for k in 0..(n * 4) {
                let v = spline.sample(k as f64 / 4.0);
                assert!(v.is_finite());
                assert!(v >= lo - 0.5 * (hi - lo) - 1e-9 && v <= hi + 0.5 * (hi - lo) + 1e-9, "{v} outside [{lo}, {hi}]");
            }
        }
    }
}
