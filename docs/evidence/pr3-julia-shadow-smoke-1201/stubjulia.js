const http=require('http')
http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{let c=[];try{c=JSON.parse(b).candidates||[]}catch{}
 const pick=c.length?c[c.length-1].id:null; console.log('req',c.map(x=>x.id).join(','),'->',pick)
 res.setHeader('content-type','application/json');res.end(JSON.stringify({choice:pick,confidence:0.5,latency_ms:2,model_calls:1}))})}).listen(8768,'127.0.0.1')
