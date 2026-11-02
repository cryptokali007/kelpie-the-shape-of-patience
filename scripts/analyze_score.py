from pathlib import Path
import json,time
import numpy as np
import soundfile as sf
import torch
ROOT=Path(__file__).resolve().parents[1];start=time.monotonic()
audio,sr=sf.read(ROOT/'assets/score.wav',dtype='float32');assert sr==48000 and len(audio)==300*sr
wave=torch.from_numpy(audio.mean(axis=1)).to('cuda');window=torch.hann_window(2048,device='cuda')
spec=torch.stft(wave,n_fft=2048,hop_length=960,window=window,return_complex=True).abs().square()[:,:15000]
f=torch.arange(spec.shape[0],device='cuda')*sr/2048
features={}
for name,lo,hi in [('low',20,250),('mid',250,2500),('high',2500,16000)]:
 a=spec[(f>=lo)&(f<hi)].mean(dim=0).sqrt();a=(a/torch.quantile(a,.99).clamp_min(1e-7)).clamp(0,1);features[name]=a.cpu().tolist()
rms=torch.from_numpy(np.sqrt((audio.mean(axis=1).reshape(15000,960)**2).mean(axis=1))).to('cuda');features['rms']=(rms/torch.quantile(rms,.99).clamp_min(1e-7)).clamp(0,1).cpu().tolist()
(ROOT/'assets/motion_envelopes.json').write_text(json.dumps({'fps':50,'duration':300,'provenance':'Actual RMS and independently measured STFT bands from the original Kaggle-generated score',**features},separators=(',',':')))
(ROOT/'evidence/SCORE_GPU_ANALYSIS.json').write_text(json.dumps({'status':'passed','device':torch.cuda.get_device_name(0),'sample_rate':sr,'frame_rate':50,'frames':15000,'frequency_bands_hz':{'low':[20,250],'mid':[250,2500],'high':[2500,16000]},'seconds':time.monotonic()-start},indent=2))
print('Measured real score frequency bands on',torch.cuda.get_device_name(0))
