"""Генератор эталона rinar-golden.json из Python-проекта rinar_bot (нужны pandas и numpy).
Запуск:  python3 gen_golden.py   (путь к rinar_bot задан в sys.path.insert ниже), затем округлить числа до 12 знаков
и сохранить как tests/fixtures/rinar-golden.json. Эталон нужен только для сверки формул, на работу сервера не влияет."""
import sys, json, numpy as np, pandas as pd
sys.path.insert(0,'/home/claude/bot/rinar_bot')
from rinar.indicators import compute_levels, bearish_divergence, rsi_band_pine
from rinar.dema_atr import compute_dema_atr_levels
rng=np.random.default_rng(7)
n=450
r=rng.normal(0.0004,0.035,n)
close=100*np.exp(np.cumsum(r))
open_=np.r_[close[0],close[:-1]]*(1+rng.normal(0,0.004,n))
high=np.maximum(open_,close)*(1+np.abs(rng.normal(0,0.012,n)))
low=np.minimum(open_,close)*(1-np.abs(rng.normal(0,0.012,n)))
vol=rng.uniform(100,5000,n)
idx=pd.date_range('2024-03-06',periods=n,freq='D')  # starts Wednesday
df=pd.DataFrame({'open':open_,'high':high,'low':low,'close':close,'volume':vol},index=idx)
lv=compute_levels(df)
dl=compute_dema_atr_levels(df)
div=bearish_divergence(df)
# rsi_pine (copy of breadth.rsi_pine)
def rsi_pine(c,length=14):
    c=c.to_numpy(float);n=len(c);out=np.full(n,np.nan)
    d=np.diff(c);up,dn=np.maximum(d,0),np.maximum(-d,0)
    au,ad=up[:length].mean(),dn[:length].mean()
    val=lambda a,b:100.0 if b==0 else (0.0 if a==0 else 100.0-100.0/(1.0+a/b))
    out[length]=val(au,ad)
    for k in range(length,n-1):
        au=(au*(length-1)+up[k])/length; ad=(ad*(length-1)+dn[k])/length
        out[k+1]=val(au,ad)
    return out
c=df['close']
macd=c.ewm(span=12,adjust=False).mean()-c.ewm(span=26,adjust=False).mean()
sig=macd.ewm(span=9,adjust=False).mean()
sd=c.rolling(20).std(ddof=0); mid=c.rolling(20).mean()
nn=lambda s:[None if (x!=x) else float(x) for x in np.asarray(s,float)]
out={'times':[int(t.timestamp()) for t in idx],'open':nn(open_),'high':nn(high),'low':nn(low),'close':nn(close),'volume':nn(vol),
 'rinar':{k:nn(lv[k]) for k in ['fund','rsi25','rsi14w','yellow','purple','orange','red']},
 'dema':{k:nn(dl[k]) for k in ['fast_dema','slow_dema','atr','dema_p1','dema_p2','dema_p3','dema_m1','dema_m2','dema_m3']},
 'div':[bool(x) for x in div],'div_fast':[bool(x) for x in bearish_divergence(df,12,26,9)],'rsi14':nn(rsi_pine(c)),'macd':nn(macd),'signal':nn(sig),
 'bb':{'mid':nn(mid),'upper':nn(mid+2*sd),'lower':nn(mid-2*sd)},
 'ema20':nn(c.ewm(span=20,adjust=False).mean()),'sma50':nn(c.rolling(50).mean())}
json.dump(out,open('golden.json','w'))
print('div signals',sum(out['div']),'rsi14w nan',sum(x is None for x in out['rinar']['rsi14w']))
