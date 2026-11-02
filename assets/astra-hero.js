export function createHero(THREE) {
  const V = THREE.Vector3, PI = Math.PI, TAU = PI * 2;
  const group = new THREE.Group(), body = new THREE.Group();
  group.name = "Kelpie — midnight tide"; group.add(body);
  const geometries = new Set(), materials = new Set(), ribbons = [], legs = [];
  let disposed = false;
  const material = o => { const m = new THREE.MeshPhysicalMaterial(o); materials.add(m); return m; };
  const skin = material({ color: 0xffffff, vertexColors: true, metalness: .43, roughness: .38, clearcoat: .32, clearcoatRoughness: .34 });
  const kelp = material({ color: 0x24535a, metalness: .42, roughness: .39, clearcoat: .3, clearcoatRoughness: .36 });
  const violet = material({ color: 0x382c50, metalness: .44, roughness: .42, clearcoat: .25, clearcoatRoughness: .38 });
  const dark = material({ color: 0x091920, metalness: .28, roughness: .48 });
  const hoof = material({ color: 0x152633, metalness: .54, roughness: .34, clearcoat: .25 });
  const gold = material({ color: 0xb99a5d, metalness: .6, roughness: .33, clearcoat: .18 });
  const amber = material({ color: 0xffb137, metalness: .27, roughness: .24, clearcoat: .8, clearcoatRoughness: .16, emissive: 0xae5108, emissiveIntensity: .13 });
  const glint = material({ color: 0xffe6b5, metalness: .4, roughness: .23 });
  const tealColor = new THREE.Color(0x285d65), violetColor = new THREE.Color(0x42314f);
  const C = new V(), T = new V(), N = new V(), B = new V(), Z = new V(0, 0, 1), Y = new V(0, 1, 0);
  function lattice(n, m, dynamic = false) {
    const count = (n + 1) * (m + 1), indices = new Uint16Array((n * m * 2 + m * 2) * 3);
    let k = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const a = i * (m + 1) + j, b = a + m + 1;
      indices[k++] = a; indices[k++] = b; indices[k++] = a + 1;
      indices[k++] = b; indices[k++] = b + 1; indices[k++] = a + 1;
    }
    for (let j = 0; j < m; j++) {
      indices[k++] = count; indices[k++] = j; indices[k++] = j + 1;
      indices[k++] = count + 1; indices[k++] = n * (m + 1) + j + 1; indices[k++] = n * (m + 1) + j;
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    for (const name of ["position", "normal"]) {
      const a = new THREE.BufferAttribute(new Float32Array((count + 2) * 3), 3);
      if (dynamic) a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
    }
    geometries.add(g); return g;
  }
  function smooth(g, n, m) {
    g.computeVertexNormals();
    const a = g.attributes.normal.array;
    for (let i = 0; i <= n; i++) {
      const p = i * (m + 1) * 3, q = p + m * 3;
      let x = a[p] + a[q], y = a[p + 1] + a[q + 1], z = a[p + 2] + a[q + 2];
      const d = Math.hypot(x, y, z) || 1; x /= d; y /= d; z /= d;
      a[p] = a[q] = x; a[p + 1] = a[q + 1] = y; a[p + 2] = a[q + 2] = z;
    }
    g.attributes.normal.needsUpdate = true;
  }
  function mesh(g, m, parent = body) {
    const object = new THREE.Mesh(g, m); object.castShadow = m !== gold && m !== glint; object.receiveShadow = true;
    parent.add(object); return object;
  }
  function profile(p, u, axis) {
    const q = u * (p.length - 1), i = Math.min(p.length - 2, Math.floor(q)), f = q - i;
    const a = p[Math.max(0, i - 1)][axis], b = p[i][axis], c = p[i + 1][axis], d = p[Math.min(p.length - 1, i + 2)][axis];
    return Math.max(.0008, .5 * (2 * b + (c - a) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f));
  }
  function frame(curve, u) {
    curve.getPoint(u, C); curve.getTangent(u, T);
    if (T.lengthSq() < .000001) T.set(0, 1, 0);
    N.crossVectors(T, Math.abs(T.z) > .98 ? Y : Z).normalize(); B.crossVectors(N, T).normalize();
  }
  function sweep(p, mat = skin, n = 64, m = 24, parent = body, carve = 0) {
    const curve = new THREE.CatmullRomCurve3(p.map(a => new V(a[0], a[1], a[2])), false, "centripetal");
    const g = lattice(n, m), a = g.attributes.position.array, colors = mat.vertexColors ? new Float32Array(a.length) : null;
    for (let i = 0; i <= n; i++) {
      const u = i / n; frame(curve, u);
      const rx = profile(p, u, 3), rz = profile(p, u, 4);
      for (let j = 0; j <= m; j++) {
        const theta = j / m * TAU, f = 1 + carve * Math.sin(PI * u) * Math.cos(3 * theta + u * 5);
        const x = rx * Math.cos(theta) * f, z = rz * Math.sin(theta) * f, k = (i * (m + 1) + j) * 3;
        a[k] = C.x + N.x * x + B.x * z; a[k + 1] = C.y + N.y * x + B.y * z; a[k + 2] = C.z + N.z * x + B.z * z;
        if (colors) {
          const h = .14 + .48 * Math.pow(.5 + .5 * Math.cos(theta + u * 4), 2), shade = .82 + .18 * Math.max(0, Math.cos(theta));
          colors[k] = (tealColor.r * (1 - h) + violetColor.r * h) * shade;
          colors[k + 1] = (tealColor.g * (1 - h) + violetColor.g * h) * shade;
          colors[k + 2] = (tealColor.b * (1 - h) + violetColor.b * h) * shade;
        }
      }
    }
    const end = (n + 1) * (m + 1) * 3;
    curve.getPoint(0, C); C.toArray(a, end); curve.getPoint(1, C); C.toArray(a, end + 3);
    if (colors) { colors.set(colors.subarray(0, 3), end); colors.set(colors.subarray(end - 3, end), end + 3); g.setAttribute("color", new THREE.BufferAttribute(colors, 3)); }
    smooth(g, n, m); g.computeBoundingSphere();
    return { p, curve, carve, mesh: mesh(g, mat, parent), parent };
  }
  function surface(d, u, theta, offset = 0) {
    frame(d.curve, u);
    const f = 1 + d.carve * Math.sin(PI * u) * Math.cos(3 * theta + u * 5);
    return C.clone().addScaledVector(N, (profile(d.p, u, 3) * f + offset) * Math.cos(theta)).addScaledVector(B, (profile(d.p, u, 4) * f + offset) * Math.sin(theta));
  }
  function pipe(points, radius = .009, mat = gold, parent = body) {
    return sweep(points.map((p, i) => [...p, radius * (i === 0 || i === points.length - 1 ? .35 : 1), radius * (i === 0 || i === points.length - 1 ? .35 : 1)]), mat, Math.min(72, Math.max(24, points.length * 4)), 6, parent);
  }
  function trace(d, lo, hi, angle, mat = gold, radius = .008) {
    const points = [];
    for (let i = 0; i <= 28; i++) { const u = lo + (hi - lo) * i / 28; points.push(surface(d, u, angle(u), .006).toArray()); }
    pipe(points, radius, mat, d.parent);
  }
  const torso = sweep([
    [1.94,3.14,0,.025,.025],[1.65,3.24,0,.53,.46],[1.08,3.25,0,.76,.61],[.28,3.28,0,.70,.59],[-.48,3.30,0,.77,.62],
    [-1.05,3.50,0,.63,.52],[-1.34,4.03,0,.48,.39],[-1.65,4.62,0,.35,.29],[-1.96,5.14,0,.27,.245],[-2.08,5.31,0,.12,.14],[-2.12,5.32,0,.02,.02]
  ], skin, 144, 36, body, .045);
  const head = sweep([
    [-1.94,5.31,0,.06,.07],[-2.15,5.32,0,.30,.28],[-2.43,5.12,0,.35,.29],[-2.86,4.84,0,.23,.215],
    [-3.28,4.67,0,.23,.24],[-3.52,4.65,0,.205,.23],[-3.58,4.65,0,.035,.04]
  ], skin, 84, 28, body, .018);
  for (const side of [-1, 1]) {
    trace(torso, .16, .87, u => side * (.91 + .16 * Math.sin(u * 7)));
    trace(torso, .34, .68, u => side * (1.51 + .56 * Math.sin((u - .34) / .34 * PI)), kelp, .027);
    trace(torso, .40, .64, u => side * (1.61 + .55 * Math.sin((u - .34) / .34 * PI)), gold, .006);
    trace(head, .14, .48, u => side * (1.9 + .25 * Math.sin(u * 9)), kelp, .022);
    sweep([[-3.47,4.68,side*.214,.007,.005],[-3.35,4.72,side*.247,.052,.012],[-3.23,4.78,side*.221,.008,.005]], dark, 28, 12);
    pipe([[-3.53,4.54,side*.14],[-3.33,4.48,side*.155],[-3.11,4.54,side*.15],[-2.99,4.62,side*.145]], .012, dark);
  }
  for (let i = 0; i < 2; i++) {
    const x = i ? -1.81 : -2.08, z = i ? -.22 : .19, h = i ? -.065 : 0;
    sweep([[x,5.42+h,z,.09,.08],[x+.03,5.69+h,z,.145,.092],[x-.04,5.99+h,z+.015,.08,.045],[x-.12,6.18+h,z+.02,.001,.001]], skin, 40, 20);
    sweep([[x+.01,5.57+h,z+.085,.018,.006],[x+.015,5.75+h,z+.093,.09,.009],[x-.05,6+h,z+.058,.043,.006],[x-.115,6.15+h,z+.027,.001,.001]], violet, 32, 12);
  }
  sweep([[-2.56,5.21,.265,.008,.008],[-2.405,5.26,.288,.087,.036],[-2.24,5.30,.27,.006,.006]], dark, 32, 16);
  sweep([[-2.52,5.225,.294,.002,.002],[-2.405,5.26,.316,.053,.031],[-2.285,5.29,.29,.002,.002]], amber, 32, 16);
  sweep([[-2.414,5.216,.346,.002,.002],[-2.409,5.259,.348,.012,.006],[-2.405,5.301,.341,.002,.002]], dark, 20, 10);
  pipe([[-2.55,5.28,.249],[-2.40,5.345,.282],[-2.245,5.34,.272]], .01);
  sweep([[-2.448,5.281,.341,.003,.002],[-2.439,5.288,.345,.012,.006],[-2.429,5.293,.341,.002,.002]], glint, 12, 8);
  for (let i = 0; i < 4; i++) {
    const rear = i > 1, side = i % 2 ? -1 : 1, y = rear ? 3.06 : 3.04;
    const upper = new THREE.Group(), lower = new THREE.Group();
    upper.position.set(rear ? (side > 0 ? 1.25 : 1.49) : (side > 0 ? -1.05 : -.73), y, side * .445); body.add(upper);
    const kx = rear ? .28 : -.06, ky = rear ? -1.58 : -1.48, length = y + ky - .35, fx = rear ? -.26 : -.19;
    const u = sweep(rear ? [[0,.14,0,.37,.28],[-.12,-.37,0,.32,.24],[-.37,-.77,0,.20,.17],[-.04,-1.18,0,.125,.115],[kx,ky,0,.107,.105]]
      : [[0,.18,0,.23,.19],[.035,-.40,0,.205,.155],[-.02,-.96,0,.13,.115],[kx,ky,0,.105,.102]], skin, 52, 20, upper, .035);
    lower.position.set(kx, ky, 0); upper.add(lower);
    const l = sweep([[0,0,0,.106,.104],[rear ? -.07 : .01,-.43,0,.074,.072],[fx+.08,-length+.18,0,.077,.076],[fx,-length,0,.108,.102]], skin, 40, 16, lower);
    sweep([[fx,-length+.035,0,.105,.108],[fx-.025,-length-.055,0,.15,.15],[fx-.065,-length-.25,0,.205,.18],[fx-.065,-length-.29,0,.205,.18]], hoof, 28, 24, lower);
    trace(u, .19, .84, () => side * 1.48, gold, .006); trace(l, .13, .81, () => side * 1.56, gold, .005);
    const rim = [];
    for (let j = 0; j <= 24; j++) { const a = j / 24 * TAU; rim.push([fx-.026+.153*Math.cos(a),-length-.062,.154*Math.sin(a)]); }
    pipe(rim, .007, gold, lower);
    legs.push({ upper, lower, y, phase: [0, PI, PI + .55, .55][i], uz: upper.rotation.z, lz: lower.rotation.z });
  }
  sweep([[1.55,3.66,0,.16,.15],[1.99,3.56,0,.15,.14],[2.32,3.39,0,.10,.10],[2.57,3.16,0,.025,.025]], skin, 44, 20);
  const circle = m => Array.from({ length: m + 1 }, (_, j) => [Math.cos(j / m * TAU), Math.sin(j / m * TAU)]);
  const bladeCircle = circle(8), threadCircle = circle(5);
  function blade(points, width, seed, mat, gilded) {
    const n = 40, curve = new THREE.CatmullRomCurve3(points.map(p => new V(...p)), false, "centripetal"), rest = new Float32Array((n + 1) * 3);
    for (let i = 0; i <= n; i++) { curve.getPoint(i / n, C); C.toArray(rest, i * 3); }
    const g = lattice(n, 8, true), e = gilded ? lattice(n, 5, true) : null;
    g.boundingSphere = new THREE.Sphere(new V(0, 3, 0), 8); mesh(g, mat);
    if (e) { e.boundingSphere = new THREE.Sphere(new V(0, 3, 0), 8); mesh(e, gold); }
    ribbons.push({ g, e, rest, centers: new Float32Array(rest.length), n, width, seed });
  }
  for (let i = 0; i < 20; i++) {
    const f = i / 19, side = i % 3 === 0 ? -1 : 1, root = surface(torso, .90 - .43 * f, side * .12, .008), reach = .95 + .45 * (1 - f);
    blade([root.toArray(),[root.x+.29,root.y+.09,side*(.19+.15*f)],[root.x+.66*reach,root.y-.18,side*(.36+.22*f)],
      [root.x+reach,root.y-.58-.12*f,side*(.55+.12*f)],[root.x+reach+.10,root.y-.85-.15*f,side*(.62+.08*Math.sin(i))]], .10+.025*Math.sin(i*1.7)**2, i*1.618, i%3===0?violet:kelp, i%4===0);
  }
  for (let i = 0; i < 12; i++) {
    const s = Math.sin(i*2.17), c = Math.cos(i*1.39), z = (i-5.5)*.018;
    blade([[1.95+.035*s,3.55+.03*c,z],[2.45,3.63+.08*c,z*2],[3.15+.12*s,3.25-.1*c,.18*s],
      [3.65+.18*s,2.52-.15*c,.30*s],[3.91+.16*s,1.65+.20*c,.42*s],[3.58+.27*s,.78+.15*(i%4),.45*s]], .105+.025*c*c, 31+i*1.713, i%3===1?violet:kelp, i%4===1);
  }
  function animateBlade(r, t, strength) {
    const { g, e, rest, centers: q, n, width, seed } = r, p = g.attributes.position.array, ep = e && e.attributes.position.array;
    for (let i = 0; i <= n; i++) {
      const u = i/n, v = Math.sin(u*PI*.5)**2*strength, k = i*3;
      q[k] = rest[k]+.055*v*Math.sin(.73*t+4*u+seed); q[k+1] = rest[k+1]+.055*v*Math.sin(.87*t-5*u+seed*.4); q[k+2] = rest[k+2]+.12*v*Math.sin(1.07*t-4.3*u+seed);
    }
    for (let i = 0; i <= n; i++) {
      const u = i/n, k = i*3, a = Math.max(0,i-1)*3, b = Math.min(n,i+1)*3;
      T.set(q[b]-q[a],q[b+1]-q[a+1],q[b+2]-q[a+2]).normalize(); N.crossVectors(T,Math.abs(T.z)>.98?Y:Z).normalize(); B.crossVectors(N,T).normalize();
      const twist = seed*.7+u*3+.28*u*u*Math.sin(t*.81+u*5+seed), cs = Math.cos(twist), sn = Math.sin(twist);
      const ux=N.x*cs+B.x*sn, uy=N.y*cs+B.y*sn, uz=N.z*cs+B.z*sn, vx=B.x*cs-N.x*sn, vy=B.y*cs-N.y*sn, vz=B.z*cs-N.z*sn;
      const w = .001+width*(.30+.78*Math.sin(PI*u)**.7)*(1-u)**.36, thick = .001+(.009+.006*Math.sin(PI*u))*(1-u)**.3;
      for (let j = 0; j <= 8; j++) { const h=(i*9+j)*3, x=w*bladeCircle[j][0], y=thick*bladeCircle[j][1]; p[h]=q[k]+ux*x+vx*y; p[h+1]=q[k+1]+uy*x+vy*y; p[h+2]=q[k+2]+uz*x+vz*y; }
      if (ep) {
        const ex=q[k]+ux*w, ey=q[k+1]+uy*w, ez=q[k+2]+uz*w, radius=.001+.005*Math.sin(PI*u)**.35;
        for (let j=0;j<=5;j++) { const h=(i*6+j)*3,x=radius*threadCircle[j][0],y=radius*threadCircle[j][1]; ep[h]=ex+ux*x+vx*y; ep[h+1]=ey+uy*x+vy*y; ep[h+2]=ez+uz*x+vz*y; }
        if (i===0||i===n) { const h=((n+1)*6+(i===n?1:0))*3; ep[h]=ex; ep[h+1]=ey; ep[h+2]=ez; }
      }
    }
    const end=(n+1)*9*3;
    for (let j=0;j<3;j++) { p[end+j]=q[j]; p[end+3+j]=q[n*3+j]; }
    g.attributes.position.needsUpdate=true; smooth(g,n,8);
    if(e) { e.attributes.position.needsUpdate=true; smooth(e,n,5); }
  }
  function draw(t, bands = {}) {
    if (disposed) return;
    t = Number.isFinite(t) ? t : 0; bands = bands || {};
    const band = name => Number.isFinite(bands[name]) ? Math.max(0,Math.min(1,bands[name])) : 0;
    const low=band("low"), mid=band("mid"), high=band("high"), pace=t*.76;
    body.position.y=.012*(1-Math.cos(pace*2)); body.scale.z=1+(.009+.004*low)*Math.sin(t*1.08);
    for (const l of legs) { const s=Math.sin(pace+l.phase); l.upper.position.y=l.y+.022*Math.max(0,s); l.upper.rotation.z=l.uz+.032*s; l.lower.rotation.z=l.lz+.043*Math.max(0,Math.sin(pace+l.phase+.65)); }
    for (const r of ribbons) animateBlade(r,t,1+.18*mid);
    amber.emissiveIntensity=.13+.018*Math.sin(t*1.7)+.025*high;
  }
  function dispose() {
    if (disposed) return; disposed=true; group.clear();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    geometries.clear(); materials.clear(); ribbons.length=0; legs.length=0;
  }
  draw(0);
  return { group, draw, dispose };
}