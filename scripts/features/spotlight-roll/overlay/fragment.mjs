/**
 * Spotlight Roll · Monolith — the backdrop fragment (GLSL ES 1.00).
 *
 * The backdrop host (../backdrop.mjs) prepends its PRELUDE (uniforms, the
 * shared noise and the shared glass fracture from core/fx-glsl.mjs). Three
 * branches share one program: the single stele, the colonnade (uDiceN > 1,
 * one compact stele per die in uDiceA/uDiceB) and the duel (a single die
 * stood left of centre; the defender is found 5.2 R to its right).
 * Every slab is re-derived from its die with geometry.mjs's formulas.
 */
/* ── the backdrop fragment ─────────────────────────────────────────────── */

export const FRAGMENT = `
uniform float uSpin; uniform float uFillY; uniform float uFillK; uniform float uIgnite; uniform float uCold;
uniform float uFall; uniform float uOutDur; uniform float uLit; uniform vec3 uGold; uniform vec3 uCrimson;
uniform vec3 uPalS; uniform vec3 uPalF; uniform vec4 uGrpNat[2]; uniform float uGrpOut;
uniform vec3 uDefCol; uniform float uDefK; uniform float uDefCrackT; uniform float uDefFall; uniform float uDefFlare;
float raysOn(){ return 1.0 - step(0.5, uShed); }   // SHED_ORDER "rays": the first thing to go under load
float sdBox(vec2 p, vec2 b){ vec2 d=abs(p)-b; return length(max(d,0.0))+min(max(d.x,d.y),0.0); }
float grpNat(int i){
  vec4 v = i < 4 ? uGrpNat[0] : uGrpNat[1]; int k = i < 4 ? i : i - 4;
  return k == 0 ? v.x : k == 1 ? v.y : k == 2 ? v.z : v.w;
}

/* The colonnade: one compact stele per die, re-derived from uDiceA exactly as
   geom({compact}) lays it out (86u head, 26u gap, the die, the gauge below). */
vec4 colonnade(vec2 p){
  vec2 uv = p/uRes; vec2 cv = (uv - vec2(0.5, 0.5))*vec2(uRes.x/uRes.y, 1.0);
  float veil = mix(0.68, 0.955, smoothstep(0.15, 0.95, length(cv)));
  vec3 pale = mix(uAccent, vec3(1.0), 0.28);
  float gout = uT >= 0.0 ? uGrpOut : 0.0;   // custom uniforms only arrive with a throw
  float present = smoothstep(0.0, 0.4, uArrive)*(1.0 - smoothstep(0.0, 1.0, gout));
  float rp = clamp(uArrive*1400.0/760.0, 0.0, 1.0);
  float drop = uRes.y*0.62*pow(1.0 - rp, 4.0) + uRes.y*0.4*gout*gout;
  vec3 em = vec3(0.0);
  vec2 mid = vec2(0.0); float cnt = 0.0, R0 = 1.0, foot = 0.0, cold = 0.0;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uDiceN) break;
    vec4 A = uDiceA[i]; vec4 B = uDiceB[i];
    vec2 c = A.xy; float R = max(A.z, 1.0); float degT = A.w;
    float deg = B.x, natT = B.y, landT = B.z, spin = sqrt(clamp(B.w, 0.0, 1.0));
    mid += c; cnt += 1.0; R0 = R;
    float uu = R/106.0, gap = 10.0*uu, ppu = (2.0*R + 2.0*gap)/10.0;
    float top = c.y + R + 112.0*uu - drop, bot = c.y - R - gap - 10.5*ppu - drop;
    float hw = 1.75*R, ph = max(84.0*uu, 78.0*uDpr);
    foot = bot - ph;
    float sd = sdBox(p - vec2(c.x, 0.5*(top + bot)), vec2(hw, 0.5*(top - bot)));
    float body = min(sd, sdBox(p - vec2(c.x, bot - 0.5*ph), vec2(hw, 0.5*ph)));
    vec2 d = (p - c)/R; float r = length(d);
    float has = (deg > -0.5 && degT >= 0.0) ? 1.0 : 0.0;
    vec3 dcol = deg > 2.5 ? uGold : deg > 1.5 ? uPalS : deg > 0.5 ? uPalF : uCrimson;
    vec3 lc = mix(pale, dcol, has*smoothstep(0.0, 0.5, degT));
    float isF = has*step(0.5, deg)*step(deg, 1.5)*smoothstep(0.0, 1.5, max(degT, 0.0));
    cold += isF;
    float bleed = exp(-max(body, 0.0)/(0.42*R));
    em += lc*bleed*(0.07 + 0.12*step(0.0, landT))*present*(1.0 - 0.7*isF);
    em += pale*(bleed*0.1 + smoothstep(0.8, 1.2, r)*exp(-(r - 1.0)/1.6)*0.3)*spin*present;
    if (landT >= 0.0) em += pale*exp(-pow((r - 1.0 - landT*6.0)*1.6, 2.0))*exp(-landT*2.6)*0.45;
    if (natT >= 0.0) {
      float nat = grpNat(i);
      if (nat > 0.5) em += uGold*(exp(-pow((r - 1.0 - natT*5.0)*1.2, 2.0))*0.6 + exp(-r*1.3)*0.6)*exp(-natT*1.8);
      else if (nat < -0.5) em += uCrimson*(exp(-pow((r - 1.0 - 4.0*(1.0 - smoothstep(0.0, 0.55, natT)))*1.4, 2.0))*0.7 + exp(-r*0.9)*0.4)*exp(-natT*1.5);
    }
    if (has > 0.5) {
      if (deg > 2.5) {
        vec2 q = (p - c - vec2(0.0, 0.3*R))/R; float qa = atan(q.x, q.y), ql = length(q);
        float n = raysOn() > 0.5 ? 0.62*gluVNoise(vec2(qa*7.0 + float(i)*3.1, 1.3)) + 0.38*gluVNoise(vec2(qa*17.0, 4.7 + float(i))) : 0.0;
        float rays = smoothstep(0.5, 0.93, n); rays *= rays;
        float front = smoothstep(degT*9.0 + 0.5, degT*9.0 - 1.5, ql);
        em += uGold*rays*smoothstep(2.6, 0.2, abs(qa))*exp(-ql/3.8)*smoothstep(0.6, 1.5, ql)*front*1.2*present;
        em += uGold*exp(-r*0.9)*(0.9*exp(-degT*1.6) + 0.2)*present;
      } else if (deg > 1.5) {
        em += uPalS*exp(-r*0.8)*0.24*smoothstep(0.0, 0.9, degT)*present;
      } else if (deg < 0.5 && sd < 3.0*uDpr) {
        float S = 3.2*R;
        vec4 br = gluBreakField((p - c)/S, vec2(0.0), degT, 0.03, 1.0/S, 1.0, 0.95);
        float keep = (1.0 - smoothstep(1.4, 2.9, degT))*present*(1.0 - smoothstep(-2.0, 2.0, sd));
        vec3 hot = mix(uCrimson, vec3(1.0, 0.75, 0.7), 0.55);
        em += (uCrimson*(br.x*1.4 + br.y*2.2) + hot*(br.z*1.5 + br.w*1.2))*keep;
      }
      if (deg < 0.5) em += uCrimson*(bleed*0.3 + exp(-r*0.6)*0.45*exp(-degT*1.5))*present;
    }
  }
  mid /= max(cnt, 1.0);
  // one standing fan of rays behind the whole colonnade
  vec2 q = (p - mid - vec2(0.0, 1.5*R0))/(2.2*R0); float qa = atan(q.x, q.y), ql = length(q);
  float n = raysOn() > 0.5 ? 0.62*gluVNoise(vec2(qa*9.0 + uTime*0.1, 1.3)) + 0.38*gluVNoise(vec2(qa*21.0 - uTime*0.17, 4.7)) : 0.0;
  float rays = smoothstep(0.5, 0.93, n); rays *= rays;
  em += pale*rays*smoothstep(2.2, 0.3, abs(qa))*exp(-ql/4.0)*smoothstep(0.4, 1.4, ql)*0.18*present;
  float hz = gluFbm(vec2(p.x/(3.5*R0) + uTime*0.03, p.y/(1.4*R0)));
  em += pale*hz*exp(-pow((p.y - foot)/(1.4*R0), 2.0))*0.14*present;
  veil = mix(veil, 0.975, min(cold, 3.0)*0.04);
  veil *= smoothstep(0.0, 0.45, uArrive)*(1.0 - smoothstep(0.3, 1.0, gout));
  em *= smoothstep(0.0, 0.5, uArrive);
  return vec4(em, veil);
}

void main(){
  vec2 p = gl_FragCoord.xy;
  if (uDiceN > 1.5) { gl_FragColor = colonnade(p); return; }
  float R = max(uDieR, 1.0);
  float thrown = step(0.0, uT);
  // ── the slab, re-derived from the die exactly as geom() lays it out ──
  float sz = 2.0*R, uu = sz/212.0, gap = 10.0*uu, ppu = (sz+2.0*gap)/10.0;
  float rp = clamp(uArrive*1400.0/760.0, 0.0, 1.0);
  float drop = uRes.y*0.62*pow(1.0-rp, 4.0);
  float sinkT = uOutT >= 0.0 ? clamp(uOutT/max(uOutDur, 0.1), 0.0, 1.0) : 0.0;
  drop += uRes.y*0.55*sinkT*sinkT*sinkT;
  float top = uRes.y*0.96 - drop;
  float bot = uDie.y - R - gap - 10.5*ppu - drop;
  float hw = min(2.3*R, 0.5*uRes.x - 16.0*uDpr);
  float sd = sdBox(p - vec2(uDie.x, 0.5*(top+bot)), vec2(hw, 0.5*(top-bot)));
  float opp = uDie.x < 0.5*uRes.x - R ? 1.0 : 0.0;   // single always centres its die; opposed stands it left
  float ph = 150.0*uu, pw = opp > 0.5 ? hw*1.2 : min(hw*1.36, 0.5*uRes.x - 12.0*uDpr);
  float pd = sdBox(p - vec2(uDie.x, bot - 0.5*ph), vec2(pw, 0.5*ph));
  float body = min(sd, pd);
  float present = smoothstep(0.0, 0.4, uArrive)*(1.0 - smoothstep(0.15, 1.0, sinkT));

  // ── state ──
  float degT = uDegT;
  float isCS = step(2.5, uDegree)*step(0.0, degT);
  float isS  = step(1.5, uDegree)*step(uDegree, 2.5)*step(0.0, degT);
  float isF  = step(0.5, uDegree)*step(uDegree, 1.5)*step(0.0, degT);
  float isCF = step(-0.5, uDegree)*step(uDegree, 0.5)*step(0.0, degT);
  float degK = step(0.0, degT)*smoothstep(0.0, 0.5, degT);
  vec3 pale = mix(uAccent, vec3(1.0), 0.28);
  vec3 degC = mix(uDegColor, uGold, isCS);
  vec3 lc = mix(pale, degC, degK);
  float cold = thrown*uCold;

  vec2 d = (p - uDie)/R; float r = length(d); float ang = atan(d.y, d.x);

  // ── the veil: a deep vignette that closes in on the stele ──
  vec2 uv = p/uRes; vec2 cv = (uv - vec2(0.5, 0.52))*vec2(uRes.x/uRes.y, 1.0);
  float vig = smoothstep(0.12, 0.92, length(cv));
  float veil = mix(0.66, 0.955, vig);
  veil = mix(veil, 0.97, 0.35*cold + 0.4*isCF*smoothstep(0.0, 0.6, degT));
  float natT = uNatT;
  if (natT >= 0.0 && uNatural < 5.0) veil = mix(veil, 0.98, 0.5*exp(-natT*1.4));   // a natural 1 closes the dark in
  veil *= smoothstep(0.0, 0.45, uArrive);
  if (uOutT >= 0.0) veil *= 1.0 - smoothstep(0.25, 1.0, sinkT);

  vec3 em = vec3(0.0);

  // ── the slab's light bleeding into the air around it ──
  float lit = thrown*step(p.y, uFillY);
  float bleedW = 0.42*R;
  float bleed = exp(-max(body, 0.0)/bleedW);
  float inner = 1.0 - smoothstep(-0.2*R, 0.0, sd);
  em += lc*bleed*(0.08 + (0.22 - 0.1*isS)*lit*uFillK)*present*(1.0 - 0.7*cold);
  em += lc*inner*0.035*present;

  // ── god rays from behind the stele: angular noise × falloff, no blur ──
  vec2 src = uDie + vec2(0.0, 0.35*R);
  vec2 q = (p - src)/R; float qa = atan(q.x, q.y); float ql = length(q);
  float drift = uTime*0.035 + 0.25*uIgnite;
  float n = raysOn() > 0.5 ? 0.62*gluVNoise(vec2(qa*7.0 + drift*3.0, 1.3)) + 0.38*gluVNoise(vec2(qa*17.0 - drift*5.0, 4.7)) : 0.0;
  float rays = smoothstep(0.5, 0.93, n); rays *= rays;
  float fan = smoothstep(2.6, 0.2, abs(qa));                         // they fan upward and out, not down into the floor
  float fall = exp(-ql/5.5)*smoothstep(0.6, 1.6, ql);
  float rayAmt = 0.22*present*(1.0 - cold) + isCS*(1.5*smoothstep(0.0, 0.35, degT)*(0.8 + 0.2*sin(degT*1.7)))
               + isS*0.18*smoothstep(0.0, 1.2, degT) + 0.2*thrown*uLit*(1.0 - isS);
  float rayFront = isCS > 0.5 ? smoothstep(degT*11.0 + 0.5, degT*11.0 - 1.5, ql) : 1.0;
  vec3 rayC = mix(lc, uGold, isCS);
  em += rayC*rays*fan*fall*rayAmt*mix(1.0, rayFront, isCS);

  // ── the throw: light scattering through the slab with the die's spin ──
  float spinE = sqrt(clamp(uRate, 0.0, 1.0));
  if (thrown > 0.5 && spinE > 0.05) {
    float arms = pow(max(cos(3.0*(ang - uSpin)), 0.0), 14.0) + 0.6*pow(max(cos(5.0*(ang + 0.7*uSpin) + 1.3), 0.0), 22.0);
    float sfall = smoothstep(0.75, 1.25, r)*exp(-(r - 1.0)/4.5);
    em += pale*arms*sfall*spinE*1.1*present;
    em += pale*exp(-max(body, 0.0)/(0.25*R))*spinE*0.12*present;   // the slab's edges catch the spin
  }
  // landing: one ring of light leaves the die
  if (uLandT >= 0.0) {
    float lr = 1.0 + uLandT*9.0;
    em += pale*exp(-pow((r - lr)*1.4, 2.0))*exp(-uLandT*2.4)*0.55;
  }
  // a hidden DC unveils: a blade of light along its line
  if (uDcT >= 0.0) {
    float dcY = uDie.y - R - gap - drop;
    float blade = exp(-pow((p.y - dcY)/(2.5*uDpr), 2.0))*smoothstep(hw*1.8, 0.0, abs(p.x - uDie.x));
    em += pale*blade*exp(-uDcT*3.0)*0.9;
  }
  // ── the natural: gold blooms outward, crimson implodes ──
  if (natT >= 0.0) {
    if (uNatural > 10.0) {
      float nr = 1.0 + natT*7.5;
      em += uGold*(exp(-pow((r - nr)*1.1, 2.0))*0.75 + exp(-r*1.15)*0.8)*exp(-natT*1.8);
      em += uGold*rays*fan*fall*0.9*exp(-natT*1.2);
    } else {
      float nr = 1.0 + 6.0*(1.0 - smoothstep(0.0, 0.55, natT));
      em += uCrimson*exp(-pow((r - nr)*1.3, 2.0))*0.9*exp(-natT*1.3);
      em += uCrimson*exp(-r*0.7)*0.6*exp(-natT*2.0);
    }
  }
  // ── degree ──
  if (degT >= 0.0) {
    float bloom = exp(-r*0.42);
    em += degC*exp(-r*0.6)*isS*0.28*smoothstep(0.0, 0.9, degT);
    em += uGold*exp(-r*0.75)*isCS*(1.1*exp(-degT*1.6) + 0.25);
    em += uGold*isCS*exp(-pow((r - (1.0 + degT*10.0))*3.2, 2.0))*exp(-degT*1.4)*0.4;
    // failure: the light goes out of the air and what is left is cold
    em += vec3(0.05, 0.07, 0.10)*isF*smoothstep(0.0, 1.5, degT)*exp(-max(body, 0.0)/(1.2*R));
  }
  // ── a critical failure cracks the slab from the die ──
  if (isCF > 0.5) {
    float S4 = 4.0*R;
    vec4 br = gluBreakField((p - uDie)/S4, vec2(0.0), degT, 0.03, 1.0/S4, 1.0, 1.15);
    float inSlab = 1.0 - smoothstep(-2.0, 2.0, sd);
    float keep = (1.0 - uFall)*present;
    vec3 hot = mix(uCrimson, vec3(1.0, 0.75, 0.7), 0.55);
    em += (uCrimson*(br.x*1.4 + br.y*2.2) + hot*(br.z*1.5 + br.w*1.2))*inSlab*keep;
    em += uCrimson*bleed*0.35*keep*smoothstep(0.0, 0.4, degT);
    em += uCrimson*exp(-r*0.5)*0.5*exp(-degT*1.5);
  }
  // ── opposed: the defender's stele, 5.2R to the right of the die ──
  if (opp > 0.5) {
    float dcx = uDie.x + 5.2*R, dhw = 1.6*R, dph = max(84.0*uu, 78.0*uDpr);
    float dsd = sdBox(p - vec2(dcx, 0.5*(top + bot)), vec2(dhw, 0.5*(top - bot)));
    float dbody = min(dsd, sdBox(p - vec2(dcx, bot - 0.5*dph), vec2(dhw, 0.5*dph)));
    vec3 dcol = thrown > 0.5 ? uDefCol : pale;
    float dk = thrown > 0.5 ? uDefK : 0.4;
    float dbleed = exp(-max(dbody, 0.0)/(0.42*R));
    em += dcol*dbleed*0.2*dk*present;
    vec2 dq = (p - vec2(dcx, uDie.y + 0.3*R))/R; float dqa = atan(dq.x, dq.y), dql = length(dq);
    float dn = raysOn() > 0.5 ? 0.62*gluVNoise(vec2(dqa*7.0 + 5.0, 2.3)) + 0.38*gluVNoise(vec2(dqa*17.0, 6.1)) : 0.0;
    float drays = smoothstep(0.5, 0.93, dn); drays *= drays;
    em += dcol*drays*smoothstep(2.6, 0.2, abs(dqa))*exp(-dql/4.5)*smoothstep(0.6, 1.6, dql)*(0.1 + 1.1*uDefFlare*thrown)*present;
    if (thrown > 0.5 && uDefCrackT >= 0.0 && dsd < 3.0*uDpr) {
      float S = 4.0*R;
      vec4 br = gluBreakField((p - vec2(dcx, uDie.y))/S, vec2(0.0), uDefCrackT, 0.03, 1.0/S, 1.0, 1.15);
      float keep = (1.0 - uDefFall)*present*(1.0 - smoothstep(-2.0, 2.0, dsd));
      vec3 hot = mix(uGold, vec3(1.0), 0.4);
      em += (uGold*(br.x*1.3 + br.y*2.0) + hot*(br.z*1.2 + br.w*1.0))*keep;
    }
  }
  // ── ground haze at the plinth's foot, lit by whatever the stele is giving off ──
  float hz = gluFbm(vec2(p.x/(3.5*R) + uTime*0.03, p.y/(1.4*R)));
  float band = exp(-pow((p.y - (bot - ph))/(1.6*R), 2.0));
  em += lc*hz*band*0.16*present*(1.0 - 0.6*cold)*smoothstep(4.5*R, 0.5*R, abs(p.x - uDie.x - opp*2.6*R));

  if (uOutT >= 0.0) em *= 1.0 - smoothstep(0.0, 1.0, sinkT);
  em *= smoothstep(0.0, 0.5, uArrive);
  gl_FragColor = vec4(em, veil);
}`;

