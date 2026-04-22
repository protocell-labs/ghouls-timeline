// Shared GLSL for palette quantization + Bayer dithering.
// Consumers (postprocessing.js, skull.js) must declare these uniforms
// with matching names before including PALETTE_DITHER_GLSL:
//   uniform vec3 palette[MAX_COLORS];
//   uniform int  paletteSize;

export const MAX_COLORS = 32;

export const PALETTE_DITHER_GLSL = `
// 4x4 Bayer matrix (normalized to 0..1)
float bayer4x4(vec2 pos) {
  int x = int(mod(pos.x, 4.0));
  int y = int(mod(pos.y, 4.0));
  int index = x + y * 4;
  if (index == 0)  return  0.0/16.0;
  if (index == 1)  return  8.0/16.0;
  if (index == 2)  return  2.0/16.0;
  if (index == 3)  return 10.0/16.0;
  if (index == 4)  return 12.0/16.0;
  if (index == 5)  return  4.0/16.0;
  if (index == 6)  return 14.0/16.0;
  if (index == 7)  return  6.0/16.0;
  if (index == 8)  return  3.0/16.0;
  if (index == 9)  return 11.0/16.0;
  if (index == 10) return  1.0/16.0;
  if (index == 11) return  9.0/16.0;
  if (index == 12) return 15.0/16.0;
  if (index == 13) return  7.0/16.0;
  if (index == 14) return 13.0/16.0;
  if (index == 15) return  5.0/16.0;
  return 0.0;
}

void findTwoNearest(in vec3 c, out int iBest, out int iSecond, out float dBest, out float dSecond) {
  dBest = 1e9; iBest = 0; dSecond = 1e9; iSecond = 0;
  for (int i = 0; i < ${MAX_COLORS}; i++) {
    if (i >= paletteSize) break;
    vec3 p = palette[i];
    vec3 d = c - p;
    float dist = dot(d, d);
    if (dist < dBest) { dSecond = dBest; iSecond = iBest; dBest = dist; iBest = i; }
    else if (dist < dSecond) { dSecond = dist; iSecond = i; }
  }
}

// Pick between the two nearest palette colors using a Bayer threshold.
// bayer01 ∈ [0,1], ditherStrength ∈ [0,1] (0 = pure nearest, 1 = full dither).
vec3 palettePick(vec3 c, float bayer01, float ditherStrength) {
  int iBest, iSecond; float dBest, dSecond;
  findTwoNearest(c, iBest, iSecond, dBest, dSecond);
  vec3 pBest = palette[iBest];
  vec3 pSecond = palette[iSecond];

  float a = sqrt(max(dBest,   0.0));
  float b = sqrt(max(dSecond, 0.0));
  float total = max(a + b, 1e-6);
  float probSecond = mix(0.0, a / total, clamp(ditherStrength, 0.0, 1.0));

  return (bayer01 < probSecond) ? pSecond : pBest;
}
`;
