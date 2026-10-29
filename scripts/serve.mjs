import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const original=process.env.NOTES_SOURCE_ROOT;
if(!original)throw Error('NOTES_SOURCE_ROOT must explicitly identify approved edition assets');
const port=Number(process.env.PORT||8847);
const aliases=new Map([['/data/notes.json',path.join(root,'private-data','notes.json')],['/source.pdf',path.join(original,'Print Packet 1 Challah.pdf')],['/audiobook.mp3',path.join(original,'audiobook','scp-hafrashat-challah-notes.mp3')]]);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.pdf':'application/pdf','.mp3':'audio/mpeg','.wasm':'application/wasm','.bcmap':'application/octet-stream','.pfb':'application/octet-stream','.ttf':'font/ttf','.icc':'application/vnd.iccprofile'};
const server=http.createServer((req,res)=>{try{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return}
 const url=new URL(req.url,'http://127.0.0.1'),pathname=decodeURIComponent(url.pathname),relative=pathname==='/'?'index.html':pathname.slice(1);
 let filename=aliases.get(pathname);
 if(!filename){const candidate=path.resolve(root,'public',relative);if(!candidate.startsWith(path.join(root,'public')+path.sep)){res.writeHead(403).end();return}filename=candidate}
 if(!existsSync(filename)||!statSync(filename).isFile()){res.writeHead(404,{'Content-Type':'text/plain'}).end('Not found');return}
 const size=statSync(filename).size,headers={'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
 let start=0,end=size-1,status=200;
 if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return}if(!match[1]){const suffix=Number(match[2]);start=Math.max(0,size-suffix)}else start=Number(match[1]);if(match[2]&&match[1])end=Math.min(end,Number(match[2]));if(start>=size||start<0||end<start){res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return}status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`}
 headers['Content-Length']=end-start+1;res.writeHead(status,headers);if(req.method==='HEAD'){res.end();return}createReadStream(filename,{start,end}).pipe(res);
}catch{res.writeHead(500,{'Content-Type':'text/plain'}).end('Unable to serve this file.')}});
server.listen(port,'127.0.0.1',()=>console.log(`SCP notes preview: http://127.0.0.1:${port}/`));
