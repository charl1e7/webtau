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
