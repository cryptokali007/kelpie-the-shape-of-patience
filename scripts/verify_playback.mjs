import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';

const project=path.resolve(import.meta.dirname,'..');
const file=path.resolve(process.argv[2]||'');
if(!file.startsWith(project+path.sep)||!file.endsWith('.mp4')||!fs.statSync(file).isFile())throw Error('Expected a project MP4');
const cfg=JSON.parse(fs.readFileSync(project+'/runtime.json','utf8'));
const require=createRequire(cfg.toolchainRoot+'/package.json');
const {chromium}=require('playwright');
const report={status:'running',file,edition:'1080p60 viewing copy',samples:[],errors:[]};
const pageHtml=`<!doctype html><html><body style="margin:0;background:black"><video id="film" style="width:100vw;height:100vh" src="/film.mp4" controls></video></body></html>`;
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(pageHtml);}
 if(req.url!=='/film.mp4'){res.writeHead(404);return res.end();}
 const size=fs.statSync(file).size,range=req.headers.range;
 if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m){res.writeHead(416);return res.end();}const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),size-1):size-1;if(start>=size||end<start){res.writeHead(416);return res.end();}res.writeHead(206,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes'});if(req.method==='HEAD')return res.end();fs.createReadStream(file,{start,end}).pipe(res);}
 else{res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':size,'Accept-Ranges':'bytes'});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({executablePath:cfg.browserPath,headless:true,args:['--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=d3d11','--enable-gpu-rasterization','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('video').readyState>=2,null,{timeout:60000});
 await page.evaluate(async()=>{const v=document.querySelector('video');const context=new AudioContext();await context.resume();const source=context.createMediaElementSource(v),analyser=context.createAnalyser(),gain=context.createGain();gain.gain.value=0;source.connect(analyser);analyser.connect(gain);gain.connect(context.destination);analyser.fftSize=2048;window.audioProbe={context,analyser};await v.play();});
 const start=Date.now(),deadline=start+420000;
 for(const target of [6,51,96,141,186,231,276,299.5]){
   await page.waitForFunction(t=>document.querySelector('video').currentTime>=t,target,{timeout:Math.max(1000,deadline-Date.now())});
   const sample=await page.evaluate(()=>{const v=document.querySelector('video'),a=new Float32Array(window.audioProbe.analyser.fftSize);window.audioProbe.analyser.getFloatTimeDomainData(a);const q=v.getVideoPlaybackQuality();return{time:v.currentTime,duration:v.duration,paused:v.paused,ended:v.ended,readyState:v.readyState,width:v.videoWidth,height:v.videoHeight,decoded:q.totalVideoFrames,dropped:q.droppedVideoFrames,audioRms:Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length),mediaError:v.error?.message||null};});
   if(sample.mediaError||sample.width!==1920||sample.height!==1080)throw Error('Playback dimensions/media error');
   report.samples.push(sample);
 }
 await page.waitForFunction(()=>document.querySelector('video').ended,null,{timeout:Math.max(1000,deadline-Date.now())});
 report.ending=await page.evaluate(()=>{const v=document.querySelector('video'),q=v.getVideoPlaybackQuality();return{ended:v.ended,time:v.currentTime,duration:v.duration,decoded:q.totalVideoFrames,dropped:q.droppedVideoFrames};});
 if(report.errors.length||!report.samples.some(s=>Number.isFinite(s.audioRms)&&s.audioRms>.0001)||Math.abs(report.ending.time-300)>.05)throw Error('Playback/audio/end criterion failed');
 report.status='passed';report.elapsedSeconds=(Date.now()-start)/1000;
 console.log(JSON.stringify({status:report.status,ending:report.ending,audioDecoded:true}));
}catch(e){report.status='failed';report.error=String(e);process.exitCode=1;}
finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.writeFileSync(project+'/evidence/PLAYBACK.json',JSON.stringify(report,null,2));}
