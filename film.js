import * as THREE_NS from 'three';

const TAU=Math.PI*2, clamp=(x,a,b)=>Math.max(a,Math.min(b,x)), smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x)};
const v=(x=0,y=0,z=0)=>new THREE_NS.Vector3(x,y,z);
const seeded=(seed)=>{let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};};

export async function createFilm({canvas,story={},envelopes=null,THREE=THREE_NS,gsap=null,heroFactory=null,surfaceMaps=null}={}){
  const shots=Array.isArray(story.shots)&&story.shots.length?story.shots:[];
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:false});
  renderer.setPixelRatio(1);renderer.setSize(3840,2160,false);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.06;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  let pmrem=null,environmentTarget=null;
  try{const {RoomEnvironment}=await import('./assets/vendor/RoomEnvironment.js');pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();environmentTarget=pmrem.fromScene(room,.04);room.dispose();}
  catch{}
  const gl=renderer.getContext();const rendererInfo=gl?.getExtension('WEBGL_debug_renderer_info');let unmaskedRenderer='unavailable';try{unmaskedRenderer=rendererInfo?gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);}catch{}
  const scene=new THREE.Scene();scene.background=new THREE.Color('#080812');scene.fog=new THREE.FogExp2('#10152b',.0065);
  if(environmentTarget){scene.environment=environmentTarget.texture;scene.environmentIntensity=.78;}
  const camera=new THREE.PerspectiveCamera(36,16/9,.1,260);camera.position.set(0,8,30);
  scene.add(new THREE.HemisphereLight('#a9d8ff','#121024',1.65));
  const key=new THREE.DirectionalLight('#ffe7c3',3.1);key.position.set(-12,22,14);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-36;key.shadow.camera.right=36;key.shadow.camera.top=30;key.shadow.camera.bottom=-18;key.shadow.camera.near=.5;key.shadow.camera.far=110;scene.add(key);
  const rim=new THREE.DirectionalLight('#4fd9eb',2.4);rim.position.set(12,10,-14);scene.add(rim);
  const fill=new THREE.PointLight('#a36cff',90,100,1.8);fill.position.set(3,5,5);scene.add(fill);
  const mats={water:new THREE.MeshPhysicalMaterial({color:'#183c61',metalness:.12,roughness:.23,clearcoat:.82,clearcoatRoughness:.12,side:THREE.DoubleSide}),waterDay:new THREE.MeshPhysicalMaterial({color:'#8cced8',metalness:.04,roughness:.28,clearcoat:.7,side:THREE.DoubleSide}),horse:new THREE.MeshStandardMaterial({color:'#223259',metalness:.48,roughness:.3}),violet:new THREE.MeshStandardMaterial({color:'#7653c9',metalness:.32,roughness:.38}),gold:new THREE.MeshStandardMaterial({color:'#dca84b',metalness:.68,roughness:.28}),teal:new THREE.MeshStandardMaterial({color:'#38c6cb',metalness:.35,roughness:.31}),stone:new THREE.MeshStandardMaterial({color:'#443c68',metalness:.5,roughness:.44}),white:new THREE.MeshStandardMaterial({color:'#dceaff',metalness:.28,roughness:.34}),dark:new THREE.MeshStandardMaterial({color:'#12172b',metalness:.5,roughness:.38}),glass:new THREE.MeshPhysicalMaterial({color:'#a8f2e9',metalness:.06,roughness:.13,transmission:.42,thickness:.65,ior:1.32,clearcoat:.92,clearcoatRoughness:.08})};
  const waterTextures=surfaceMaps||{};for(const tex of [waterTextures.height,waterTextures.roughness,waterTextures.caustic])if(tex){tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(10,8);}
  if(waterTextures.height){mats.water.bumpMap=waterTextures.height;mats.water.bumpScale=.075;mats.waterDay.bumpMap=waterTextures.height;mats.waterDay.bumpScale=.045;}
  if(waterTextures.roughness){mats.water.roughnessMap=waterTextures.roughness;mats.waterDay.roughnessMap=waterTextures.roughness;}
  if(waterTextures.caustic){mats.water.emissive=new THREE.Color('#4e8590');mats.water.emissiveMap=waterTextures.caustic;mats.water.emissiveIntensity=.11;mats.waterDay.emissive=new THREE.Color('#c7f6fa');mats.waterDay.emissiveMap=waterTextures.caustic;mats.waterDay.emissiveIntensity=.09;}

  const worlds={};
  for(const name of ['water','range','bind','memory','archive','compare','finale']){worlds[name]=new THREE.Group();worlds[name].name=`world-${name}`;scene.add(worlds[name]);}
  // Main water sheet: precomputed grid, displaced absolutely from the supplied time.
  const waterGeo=new THREE.PlaneGeometry(150,110,112,82);waterGeo.rotateX(-Math.PI/2);const waterBase=waterGeo.attributes.position.array.slice();
  const ocean=new THREE.Mesh(waterGeo,mats.water);ocean.position.set(0,-.65,-8);worlds.water.add(ocean);const finaleOcean=ocean.clone();worlds.finale.add(finaleOcean);
  const shore=new THREE.Mesh(new THREE.PlaneGeometry(170,140,1,1),new THREE.MeshStandardMaterial({color:'#171834',roughness:.9,metalness:.05}));shore.rotation.x=-Math.PI/2;shore.position.set(0,-1.4,-18);worlds.water.add(shore);
  const horizon=new THREE.Mesh(new THREE.SphereGeometry(95,48,32),new THREE.MeshBasicMaterial({color:'#11182e',side:THREE.BackSide}));horizon.position.set(0,15,-46);worlds.water.add(horizon);
  // Stylized Water Horse: sculpted body, long tapered muzzle, pointed ears, four articulated legs and fine kelp mane.
  const horse=new THREE.Group();horse.name='water-horse';
  function ellipsoid(parent,material,pos,scale,rot){const m=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),material);m.position.set(...pos);m.scale.set(...scale);if(rot)m.rotation.set(...rot);parent.add(m);return m;}
  ellipsoid(horse,mats.horse,[0,3.55,0],[3.15,1.24,1.02],[0,0,-.025]);
  ellipsoid(horse,mats.horse,[-2.1,4.08,0],[1.25,.98,.78],[0,0,-.26]);
  ellipsoid(horse,mats.horse,[-3.05,3.82,0],[1.24,.42,.48],[0,0,-.12]);
  ellipsoid(horse,mats.horse,[-3.78,3.78,0],[.66,.25,.34],[0,0,.04]);
  // nostril pair and jaw line
  for(const z of [-.32,.32])ellipsoid(horse,mats.dark,[-4.03,3.91,z],[.10,.07,.055]);
  ellipsoid(horse,mats.horse,[-2.13,4.69,0],[.69,.48,.68],[0,0,.2]);
  for(const z of [-.56,.56]){
    const eye=ellipsoid(horse,mats.gold,[-2.55,4.52,z],[.17,.17,.095]);
    ellipsoid(horse,new THREE.MeshBasicMaterial({color:'#ffda69'}),[-2.60,4.52,z*1.06],[.082,.082,.045]);
    const ear=new THREE.Mesh(new THREE.ConeGeometry(.27,.95,8),mats.horse);ear.position.set(-1.86,5.34,z*.64);ear.rotation.z=-.12;horse.add(ear);
  }
  const legParts=[];for(const x of [-2.05,1.88])for(const z of [-.58,.58]){const upper=new THREE.Group();upper.position.set(x,3.0,z);horse.add(upper);const thigh=ellipsoid(upper,mats.horse,[0,-.65,0],[.39,.98,.34]);const lower=new THREE.Group();lower.position.set(0,-1.24,0);upper.add(lower);ellipsoid(lower,mats.violet,[0,-.66,0],[.18,.78,.18]);ellipsoid(lower,mats.dark,[-.06,-1.38,0],[.37,.2,.28]);legParts.push({upper,lower,x,z,phase:(x<0?0:Math.PI)+(z<0?0:Math.PI)});}
  // Neck arch with broad tapered shoulder plates and braided filaments.
  const neck=ellipsoid(horse,mats.horse,[-1.14,4.18,0],[.9,1.5,.82],[0,0,.43]);
  const strands=[];for(let i=0;i<26;i++){const z=-.66+(i%13)*.11, row=Math.floor(i/13);const pts=[];for(let k=0;k<14;k++){const u=k/13;pts.push(v(-1.95+u*2.2,5.05-u*2.55+Math.sin(u*5+i*.7)*.18,z+Math.sin(u*4+i)*.13+row*.2));}const curve=new THREE.CatmullRomCurve3(pts);const line=new THREE.Mesh(new THREE.TubeGeometry(curve,18,.025+(i%3)*.009,5,false),i%4===0?mats.gold:mats.teal);horse.add(line);strands.push(line);}
  const tailPts=Array.from({length:24},(_,i)=>v(2.65+i*.07,3.72-i*.16,.2+Math.sin(i*.25)*.08));const tail=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tailPts),40,.16,8,false),mats.teal);horse.add(tail);
  ellipsoid(horse,mats.violet,[.55,4.17,.0],[1.28,.48,1.02],[0,0,.08]);
  worlds.water.add(horse);
  const horseCopy=horse.clone(true);horseCopy.scale.setScalar(.66);horseCopy.position.set(1,-.1,-9);worlds.finale.add(horseCopy);
  let heroIntegration=null;
  if(typeof heroFactory==='function'){
    const supplied=await heroFactory(THREE);const main=supplied?.group||supplied;
    if(main?.isObject3D){const finaleGroup=supplied?.finaleGroup||main.clone(true);horse.visible=false;horseCopy.visible=false;worlds.water.add(main);if(finaleGroup!==main)worlds.finale.add(finaleGroup);heroIntegration={api:supplied,main,finale:finaleGroup};}
  }

  // Kelp forest: hundreds of fine, independently swaying stalks, deterministically generated.
  const kelpGroup=new THREE.Group();worlds.water.add(kelpGroup);const rand=seeded(4042);const kelpCount=155;const kelpGeos=[];for(let i=0;i<kelpCount;i++){const x=(rand()-.5)*38,z=-13+rand()*8,len=2.2+rand()*5.2;const pts=Array.from({length:9},(_,k)=>v(x+Math.sin(k*.48+i)*.38,k*len/8,z+Math.cos(k*.36+i)*.26));const mesh=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),16,.014+rand()*.018,4,false),i%5===0?mats.gold:mats.teal);kelpGroup.add(mesh);kelpGeos.push({mesh,x,z,len,seed:i});}
  const waterStreaks=[],streakRand=seeded(7319),streakMat=new THREE.MeshStandardMaterial({color:'#d6f3f1',emissive:'#214752',emissiveIntensity:.35,metalness:.82,roughness:.2,transparent:true,opacity:.25});
  const reflectionGroup=new THREE.Group();worlds.water.add(reflectionGroup);
  for(let i=0;i<58;i++){const x=(streakRand()-.5)*62,z=-26+streakRand()*45,length=.16+Math.pow(streakRand(),2)*4.4,curve=new THREE.CatmullRomCurve3([v(0,0,0),v(length*.34,.025,streakRand()*.1),v(length*.7,-.012,streakRand()*.12),v(length,.015,streakRand()*.16)]),mat=streakMat.clone();mat.opacity=.08+streakRand()*.24;const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,10,.008+streakRand()*.018,4,false),mat);mesh.position.set(x,-.34,z);reflectionGroup.add(mesh);waterStreaks.push({mesh,x,phase:streakRand()*TAU,baseOpacity:mat.opacity});}

  // Range world: raised LP bands, boundary rails, independently moving price ribbon and marker beads.
  const range=new THREE.Group();worlds.range.add(range);range.position.set(0,-.2,-1);
  const rangeMeshes=[],rangeRails=[];for(let b=0;b<5;b++){const geo=new THREE.PlaneGeometry(27,3.4,100,12);geo.rotateX(-Math.PI/2);const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:['#2a255d','#273662','#1e4560','#39426d','#25334b'][b],metalness:.38,roughness:.35,side:THREE.DoubleSide}));mesh.position.set(0,.25+b*.02,-5-b*1.3);range.add(mesh);rangeMeshes.push({geo,base:geo.attributes.position.array.slice(),band:b});for(const edge of [-1,1]){const rail=new THREE.Mesh(new THREE.BoxGeometry(27,.08,.08),b%2?mats.violet:mats.teal);rail.position.set(0,.55+b*.02,-5-b*1.3+edge*1.63);range.add(rail);rangeRails.push({mesh:rail,edge,band:b,baseX:rail.position.x,baseZ:rail.position.z});}}
  const pathPts=Array.from({length:220},(_,i)=>v(-13+i*.12,1.08+Math.sin(i*.047)*.66+Math.cos(i*.013)*.43,-4+Math.sin(i*.019)*1.3));const priceCurve=new THREE.CatmullRomCurve3(pathPts);const priceLine=new THREE.Mesh(new THREE.TubeGeometry(priceCurve,280,.048,7,false),mats.gold);range.add(priceLine);const priceBase=priceLine.geometry.attributes.position.array.slice();
  const beadGeo=new THREE.SphereGeometry(.11,10,8),beads=new THREE.InstancedMesh(beadGeo,mats.white,32);range.add(beads);
  // Bind world: a stone cleat, tightening double helix and secured glowing position core.
  const bind=new THREE.Group();worlds.bind.add(bind);bind.position.set(0,0,-3);
  const cleat=new THREE.Mesh(new THREE.CylinderGeometry(1.5,1.8,5.8,7,1),mats.stone);cleat.position.set(0,2.5,-2);bind.add(cleat);const core=new THREE.Mesh(new THREE.IcosahedronGeometry(1.23,3),new THREE.MeshPhysicalMaterial({color:'#39d8d1',emissive:'#0c929f',emissiveIntensity:1.5,metalness:.28,roughness:.18,transmission:.08}));core.position.set(0,4.6,0);bind.add(core);
  const bindRopes=[];for(let j=0;j<2;j++){const pts=Array.from({length:50},(_,i)=>{const u=i/49,a=u*TAU*5+j*Math.PI;return v(Math.cos(a)*(1.55-u*.3),.8+u*6.2,Math.sin(a)*(1.55-u*.3));});const rope=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),240,.045,7,false),j?mats.gold:mats.teal);bind.add(rope);bindRopes.push(rope);}
  const links=[];for(let i=0;i<18;i++){const link=new THREE.Mesh(new THREE.TorusGeometry(.23,.055,8,20),i%2?mats.gold:mats.violet);link.position.set(-1.7+i*.2,.35,-.1+Math.sin(i*.6)*.55);link.rotation.set(.3,i*.28,.8);bind.add(link);links.push(link);}

  // Archive: distinct carved record-stones, converging colonnades, cut glyphs, brass piping and optical insets.
  const archive=new THREE.Group();worlds.archive.add(archive);archive.position.set(0,-.9,-9);
  const records=[],seams=[],starRand=seeded(903),stoneMats=['#39354f','#45405f','#343c57','#4a3c5f'].map(color=>new THREE.MeshStandardMaterial({color,metalness:.29,roughness:.39}));
  const makeSlab=(kind)=>{
    if(kind<2){const profiles=[[[0,0],[.34,.025],[.42,.12],[.31,.25],[.34,.66],[.24,.82],[.28,.94],[.12,1],[0,1]],[[0,0],[.3,.02],[.43,.11],[.41,.19],[.32,.3],[.37,.7],[.22,.84],[.16,.95],[0,1]]][kind];return new THREE.LatheGeometry(profiles.map(([r,y])=>v(r,y,0)),kind===0?9:7);}
    const shape=new THREE.Shape(),w=kind===2?.37:.3,h=kind===2?.48:.52;shape.moveTo(-w,-h);shape.lineTo(w,-h);shape.lineTo(w*.9,h*.45);shape.lineTo(w*.42,h);shape.lineTo(-w*.72,h*.88);shape.lineTo(-w,h*.25);shape.closePath();return new THREE.ExtrudeGeometry(shape,{depth:kind===2?.34:.5,steps:1,bevelEnabled:true,bevelSegments:2,bevelSize:.055,bevelThickness:.065,curveSegments:3});
  };
  const runeMaterial=new THREE.LineBasicMaterial({color:'#c6a5ff',transparent:true,opacity:.72});
  const totalRecords=34;for(let i=0;i<totalRecords;i++){
    const row=i%2,station=Math.floor(i/2),depth=8-station*2.55,xsign=row===0?-1:1;
    const inward=station*.31,x=xsign*(7.3-inward)+(starRand()-.5)*.38,z=depth+(starRand()-.5)*.7,h=3.4+starRand()*5.2,kind=i%4;
    const pod=new THREE.Group(),frontZ=kind<2?.42:.1;pod.position.set(x,0,z);pod.rotation.y=xsign*.11+(starRand()-.5)*.14;archive.add(pod);records.push({pod,phase:starRand()*TAU,baseY:0});
    const stone=new THREE.Mesh(makeSlab(kind),stoneMats[kind]);stone.scale.set(1,h,1);stone.castShadow=true;stone.receiveShadow=true;pod.add(stone);
    if(kind>=2)stone.position.z=-.26;
    // Twin fluted keylines travel the front face; rings and a cut shoulder make every stele read as assembled masonry.
    for(const side of [-1,1]){const points=[v(side*.23,.08,frontZ),v(side*.28,.24,frontZ),v(side*.21,.54,frontZ),v(side*.12,.77,frontZ*.8),v(side*.16,.95,frontZ*.6)];const pipe=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),24,.018,5,false),i%3===0?mats.gold:mats.teal);pipe.scale.y=h;pod.add(pipe);seams.push(pipe);}
    for(const yy of [.12,.25,.83,.91]){const ring=new THREE.Mesh(new THREE.TorusGeometry(.36,.018,6,36),yy===.25?mats.teal:mats.gold);ring.rotation.x=Math.PI/2;ring.position.set(0,yy*h,frontZ*.16);ring.scale.set(1,.8,1);pod.add(ring);}
    const runeVerts=[];for(let r=0;r<5;r++){const y=.34+r*.1,xc=(starRand()-.5)*.12;const p0=[xc-.11,y,frontZ],p1=[xc+.08,y+.05,frontZ],p2=[xc-.06,y+.11,frontZ],p3=[xc+.12,y+.15,frontZ];runeVerts.push(...p0,...p1,...p1,...p2,...p2,...p3);}
    const runeGeo=new THREE.BufferGeometry();runeGeo.setAttribute('position',new THREE.Float32BufferAttribute(runeVerts,3));const glyph=new THREE.LineSegments(runeGeo,runeMaterial);glyph.scale.y=h;pod.add(glyph);
    if(i%3===0){const lens=new THREE.Mesh(new THREE.OctahedronGeometry(.19+starRand()*.08,1),i%2?mats.glass:mats.violet);lens.position.set(0,h*.62,frontZ);lens.rotation.set(.3,i*.71,.2);pod.add(lens);const bezel=new THREE.Mesh(new THREE.TorusGeometry(.26,.024,8,36),mats.gold);bezel.position.copy(lens.position);bezel.rotation.x=Math.PI/2;pod.add(bezel);const inner=new THREE.Mesh(new THREE.SphereGeometry(.075,12,8),mats.white);inner.position.set(-.055,h*.62+.045,frontZ+.055);pod.add(inner);}
    const cap=new THREE.Mesh(new THREE.OctahedronGeometry(.12+starRand()*.13,0),mats.white);cap.position.set(0,h,frontZ*.1);pod.add(cap);
  }
  // Repeated ribs and paired seam-lines establish a long, receding architectural aisle.
  const arches=[];for(let i=0;i<9;i++){const u=i/8,z=8-u*23,halfWidth=8-u*4.1,height=10-u*2.7;const pts=Array.from({length:33},(_,n)=>{const a=n/32*Math.PI;return v(Math.cos(a)*halfWidth,height*Math.sin(a),z);});const curve=new THREE.CatmullRomCurve3(pts);const rib=new THREE.Mesh(new THREE.TubeGeometry(curve,96,.09-u*.035,8,false),i%2?mats.teal:mats.stone);archive.add(rib);const crown=new THREE.Mesh(new THREE.TubeGeometry(curve,96,.018,5,false),mats.gold);crown.position.y=.045;archive.add(crown);arches.push({rib,crown,index:i});}
  // Floating memory motes are instanced, while the major record-stones retain distinct silhouettes and detail.
  const dummy=new THREE.Object3D(), starGeo=new THREE.OctahedronGeometry(.043,0),stars=new THREE.InstancedMesh(starGeo,new THREE.MeshStandardMaterial({color:'#d3c4ff',emissive:'#4b2b91',emissiveIntensity:.4,metalness:.42,roughness:.23}),640);archive.add(stars);
  for(let i=0;i<640;i++){const station=i%34,record=records[station],side=starRand()<.5?-1:1;dummy.position.set(record.pod.position.x+side*(.58+starRand()*1.1),starRand()*7,record.pod.position.z+(starRand()-.5)*1.4);dummy.scale.setScalar(.35+starRand()*.85);dummy.rotation.set(starRand()*TAU,starRand()*TAU,starRand()*TAU);dummy.updateMatrix();stars.setMatrixAt(i,dummy.matrix);}
  // Restrained official source art plate, framed as a single archive folio within the 3D world.
  const texLoader=new THREE.TextureLoader();const artMat=new THREE.MeshBasicMaterial({color:'#ffffff',side:THREE.DoubleSide});
  try{const tex=await new Promise((res,rej)=>texLoader.load('./assets/artwork/plate-10-the-record-night-1600x900.png',res,undefined,rej));tex.colorSpace=THREE.SRGBColorSpace;artMat.map=tex;artMat.needsUpdate=true;}catch{}
  const folio=new THREE.Group();const frame=new THREE.Mesh(new THREE.BoxGeometry(9.5,5.55,.32),mats.gold);folio.add(frame);const plate=new THREE.Mesh(new THREE.PlaneGeometry(9.2,5.18),artMat);plate.position.z=.19;folio.add(plate);folio.position.set(-7,5,-3);folio.rotation.y=.32;archive.add(folio);

  // Comparison: dual current channels and two distinct paths, no dashboard or live figures.
  const compare=new THREE.Group();worlds.compare.add(compare);compare.position.set(0,0,-3);
  for(let lane=0;lane<2;lane++){const z=-2.6+lane*5.2;const bed=new THREE.Mesh(new THREE.BoxGeometry(25,.24,3.35),lane?mats.violet:mats.teal);bed.position.set(0,.05,z);compare.add(bed);const pts=Array.from({length:120},(_,i)=>v(-11.5+i*.194,1.1+Math.sin(i*.055+lane)*(.5+lane*.2)+Math.cos(i*.021)*.32,z));compare.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),180,.05,7,false),lane?mats.gold:mats.white));for(let i=0;i<3;i++){const node=new THREE.Mesh(new THREE.IcosahedronGeometry(.35+i*.07,1),lane?mats.gold:mats.teal);node.position.set(-8+i*7,1.05,z);compare.add(node);}}
  // Finale vista: distant rings, luminous horizon line, floating stone garden.
  const finale=worlds.finale;const sun=new THREE.Mesh(new THREE.SphereGeometry(2.05,32,24),new THREE.MeshBasicMaterial({color:'#e6d5ff'}));sun.position.set(5,13,-38);finale.add(sun);const halo=new THREE.Mesh(new THREE.TorusGeometry(3.2,.035,8,120),mats.gold);halo.position.copy(sun.position);halo.rotation.x=.9;finale.add(halo);
  const finaleRings=[];for(let i=0;i<7;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(6+i*1.5,.026,5,140),i%2?mats.teal:mats.violet);ring.position.set(-2,1.5-i*.3,-24-i*2);ring.rotation.x=Math.PI/2;finale.add(ring);finaleRings.push({mesh:ring,baseY:ring.position.y,index:i});}
  // Reuse archive geometry in memory and comparison worlds at different scales and positions.
  const archiveEcho=archive.clone(true);archiveEcho.scale.setScalar(.55);archiveEcho.position.set(11,.4,-8);worlds.memory.add(archiveEcho);
  const compareEcho=compare.clone(true);compareEcho.scale.setScalar(.44);compareEcho.position.set(0,0,-5);
  worlds.memory.add(compareEcho);

  const ambientModes={water:['water','finale'],range:['range'],bind:['bind'],memory:['memory','archive'],archive:['archive','memory'],compare:['compare','range'],finale:['finale','water']};
  const modeFor=(shot,i)=>{const m=shot?.mode;return ambientModes[m]?m:['water','range','bind','memory','archive','compare','finale'][Math.floor(i/3)%7];};
  const camPresets={water:[-3,6,25,0,3,-4],range:[0,11,29,0,0,-4],bind:[8,8,21,0,3,-3],memory:[-11,10,28,-1,2,-8],archive:[-15,9,29,0,2,-8],compare:[0,10,27,0,1,-3],finale:[-4,8,32,0,3,-10]};
  const hasAudioBands=Array.isArray(envelopes)||Array.isArray(envelopes?.frames)||['rms','low','mid','high'].some(k=>Array.isArray(envelopes?.[k]));
  function envelope(t){const fps=Number(envelopes?.fps)||50;const at=(arr,time)=>{if(!Array.isArray(arr)||!arr.length)return null;const f=clamp(time*fps,0,arr.length-1),i=Math.floor(f),j=Math.min(arr.length-1,i+1),mix=f-i;return(Number(arr[i])||0)*(1-mix)+(Number(arr[j])||0)*mix;};let frame=null;if(Array.isArray(envelopes))frame=envelopes[Math.floor(t*fps)]||null;else if(envelopes?.frames)frame=envelopes.frames[Math.floor(t*fps)]||null;
    const sample=(key,fallback)=>{const series=at(envelopes?.[key],t);if(series!==null)return series;const fromFrame=Number(frame?.[key]);return Number.isFinite(fromFrame)?fromFrame:fallback;};
    return{rms:sample('rms',.18+.12*Math.sin(t*TAU*.75)),low:sample('low',.16+.1*Math.sin(t*TAU*.46+1)),mid:sample('mid',.14+.09*Math.sin(t*TAU*1.1)),high:sample('high',.1+.07*Math.sin(t*TAU*1.7))};}
  let current={time:0,sceneIndex:0,shot:shots[0]||{},hasAudioBands,motionSignature:'',motion:{rms:0,low:0,mid:0,high:0}};
  function draw(seconds){const t=clamp(Number(seconds)||0,0,300);const idx=clamp(Math.floor(t/15),0,19),shot=shots[idx]||{},p=(t-idx*15)/15,mode=modeFor(shot,idx),bands=envelope(t);
    for(const [name,g] of Object.entries(worlds))g.visible=(ambientModes[mode]||['water']).includes(name);
    const mood=shot.mood||'dark',day=mood==='daylight';scene.background.set(day?'#d5ebec':mood==='cobalt'?'#07182b':'#080812');scene.fog.color.set(day?'#afd5da':mood==='cobalt'?'#0b1b33':'#10152b');scene.fog.density=day?.0025:.0065;key.intensity=day?3.8:3.1;fill.color.set(day?'#7bcde5':'#a36cff');ocean.material=day?mats.waterDay:mats.water;finaleOcean.material=day?mats.waterDay:mats.water;
    const phase=idx*1.618+p;const preset=camPresets[mode]||camPresets.water;const cue=String(shot.camera||'').toLowerCase(),action=String(shot.action||'').toLowerCase();const scalePulse=1+Math.sin(p*Math.PI)*.13;
    // Every 15-second composition moves along its own deliberate travel vector and changes focal distance.
    const travel=(p-.5)*(mode==='archive'||mode==='memory'?15:12),arc=Math.sin(p*Math.PI*2+idx*.37)*3.1;const close=idx%4===1||/close|intimate|detail|eye/.test(cue);
    const cueX=/left|port|across/.test(cue)?-1.7:/right|starboard/.test(cue)?1.7:0;const cueY=/rise|ascend|above|overhead|aerial/.test(cue)?4:/descend|below|underwater|dive/.test(cue)?-3:0;
    const cx=preset[0]+travel*.62+arc*.34+cueX,cy=preset[1]+Math.sin(p*TAU+phase)*1.15+cueY,cz=preset[2]-Math.sin(p*Math.PI)*10+Math.cos(p*TAU+phase)*1.7+(close?-7:0);
    camera.position.set(cx,cy,cz);camera.lookAt(preset[3]+travel*.28+1.2,preset[4]+Math.sin(p*TAU)*.5,preset[5]-Math.sin(p*Math.PI)*2.4);camera.fov=clamp(36+(close?9:0)+Math.sin(p*Math.PI)*5,29,49);camera.updateProjectionMatrix();
    const bow=/bow|lower|dip|kneel/.test(action),rise=/rise|crest|surface|rear/.test(action),turn=/turn|circle|look|wheel/.test(action);
    horse.position.set(4.2+Math.sin(phase*.32)*1.1,Math.sin(t*2.2)*.12+(rise?Math.sin(p*Math.PI)*.5:0),mode==='water'?-2:mode==='finale'?-7:-4);horse.rotation.y=Math.sin(phase*.22)*.22+(turn?Math.sin(p*Math.PI*2)*.42:0);horse.rotation.z=bow?-Math.sin(p*Math.PI)*.12:0;horse.scale.setScalar((mode==='water'?1:mode==='finale'?.77:.58)*scalePulse);
    if(heroIntegration?.api?.draw){heroIntegration.api.draw(t,bands);heroIntegration.main.visible=mode==='water'||mode==='finale';heroIntegration.finale.visible=false;heroIntegration.main.position.copy(horse.position);heroIntegration.main.rotation.copy(horse.rotation);heroIntegration.main.scale.copy(horse.scale);if(mode==='finale')heroIntegration.main.scale.multiplyScalar(1.28);}
    for(const l of legParts){const a=Math.sin(t*2.6+l.phase)*.21;l.upper.rotation.z=a;l.lower.rotation.z=-Math.max(0,a)*.55;}
    tail.rotation.z=Math.sin(t*1.7)*.15;neck.rotation.z=Math.sin(t*1.4)*.035;
    for(const k of kelpGeos){k.mesh.position.x=k.x+Math.sin(t*.72+k.seed*.63)*.23;k.mesh.rotation.z=Math.sin(t*.85+k.seed)*.09;}
    for(const s of waterStreaks){s.mesh.position.x=s.x+Math.sin(t*.31+s.phase)*.22;s.mesh.material.opacity=s.baseOpacity*(.56+.44*Math.sin(t*.64+s.phase)**2);}
    const pos=waterGeo.attributes.position;for(let i=0;i<pos.count;i++){const x=waterBase[i*3],z=waterBase[i*3+2];pos.array[i*3+1]=waterBase[i*3+1]+Math.sin(x*.19+t*1.3)*.14+Math.cos(z*.31-t*.8)*.12+Math.sin((x+z)*.09+t*2)*.06+bands.low*.12*Math.sin(x*.5+z*.4);}pos.needsUpdate=true;waterGeo.computeVertexNormals();
    if(waterTextures.caustic){waterTextures.caustic.offset.set((t*.008)%1,(t*.005)%1);}
    const pathPositions=priceLine.geometry.attributes.position;for(let i=0;i<pathPositions.count;i++){const x=priceBase[i*3];pathPositions.array[i*3]=priceBase[i*3];pathPositions.array[i*3+1]=priceBase[i*3+1]+Math.sin(x*.48+t*.92)*(.16+bands.mid*.22)+bands.high*.04*Math.sin(x*1.7-t);pathPositions.array[i*3+2]=priceBase[i*3+2];}pathPositions.needsUpdate=true;
    for(const band of rangeMeshes){const a=band.geo.attributes.position;for(let i=0;i<a.count;i++){const x=band.base[i*3];a.array[i*3+2]=band.base[i*3+2]+Math.sin(x*.25+t*.6+band.band)*(.055+bands.low*.1)+Math.cos(x*.49-t*.42+band.band)*.035;}a.needsUpdate=true;}
    for(let i=0;i<32;i++){const u=(i/31+t*.052)%1,pt=priceCurve.getPointAt(u);pt.y+=Math.sin(pt.x*.48+t*.92)*(.16+bands.mid*.22);dummy.position.copy(pt);dummy.scale.setScalar(.6+bands.rms*.8);dummy.updateMatrix();beads.setMatrixAt(i,dummy.matrix);}beads.instanceMatrix.needsUpdate=true;
    range.scale.x=1+.035*Math.sin(t*.42);range.rotation.y=Math.sin(t*.2)*.045;for(const r of rangeRails)r.mesh.position.x=r.baseX+r.edge*(.16+bands.low*.6)*Math.sin(t*.38+r.band*.8);
    core.scale.setScalar(1+bands.rms*.18);core.rotation.set(t*.18,t*.27,t*.1);for(let i=0;i<bindRopes.length;i++){bindRopes[i].rotation.y=Math.sin(t*.24+i*Math.PI)*.11;bindRopes[i].scale.y=1+Math.sin(t*.42+i*.9)*.035;}for(let i=0;i<links.length;i++){const l=links[i];l.position.y=.35+i*.025+Math.sin(t*1.1+i*.5)*.23;l.rotation.y=i*.28+t*.35;}
    stars.rotation.y=Math.sin(t*.08)*.07;archive.rotation.y=Math.sin(t*.11)*.08;archiveEcho.rotation.y=-Math.sin(t*.08)*.045;
    for(const r of records)r.pod.position.y=Math.sin(t*.3+r.phase)*.035;
    for(const a of arches)a.rib.rotation.y=a.crown.rotation.y=Math.sin(t*.11+a.index)*.012;
    for(const ring of finaleRings){ring.mesh.position.y=ring.baseY+Math.sin(t*.37+ring.index)*.18;ring.mesh.rotation.z=Math.sin(t*.23+ring.index)*.12;}
    for(const ch of compare.children)if(ch.isMesh&&ch.geometry.type==='IcosahedronGeometry')ch.rotation.set(t*.3,t*.42,Math.sin(t)*.2);
    const fade=smooth(Math.min(p/.045,(1-p)/.045));scene.overrideMaterial=null;renderer.render(scene,camera);
    const signature=[idx,mode,Math.round(camera.position.x*100),Math.round(camera.position.y*100),Math.round(camera.position.z*100),Math.round(horse.position.x*100),Math.round(bands.rms*1000)].join(':');
    current={time:t,sceneIndex:idx,shot,mode,mood,camera:camera.position,hasAudioBands,motion:bands,motionSignature:signature,transition:fade};
  }
  function getState(){return{renderer:{unmaskedRenderer,width:3840,height:2160},camera:{position:{x:camera.position.x,y:camera.position.y,z:camera.position.z},fov:camera.fov},time:current.time,sceneIndex:current.sceneIndex,shot:current.shot,mode:current.mode,mood:current.mood,transition:current.transition,hasAudioBands:current.hasAudioBands,hasHero:!!heroIntegration,motion:current.motion,motionSignature:current.motionSignature};}
  function dispose(){heroIntegration?.api?.dispose?.();environmentTarget?.dispose();pmrem?.dispose();renderer.dispose();}
  return{draw,getState,dispose};
}
