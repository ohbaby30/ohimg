import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import limiter from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import {TelegramService} from './telegram.js';
import nodemailer from 'nodemailer';
import { fileTypeFromBuffer } from 'file-type';
import { mkdirSync, createReadStream, existsSync } from 'node:fs';
import { writeFile, unlink, stat } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, cryptoBox, digest, token, email, matches, hashPassword, type User } from './store.js';
export type Options = { dbPath:string; imageDir:string; appURL:string; secret:string; logger?:boolean; maxBytes?:number; trustProxy?:string[]; telegramWorker?:boolean; telegramTransport?:ConstructorParameters<typeof TelegramService>[4]; sendMail?:(settings:SMTP,to:string,subject:string,text:string)=>Promise<void> };
type SMTP = {host:string;port:number;mode:'starttls'|'tls';username:string;password:string;from:string};
class Problem extends Error { constructor(public statusCode:number,message:string){super(message);} }
const bad=(message:string,code=400)=>{throw new Problem(code,message);};
const body=(r:FastifyRequest)=> (r.body??{}) as Record<string,unknown>;
const authLimit={rateLimit:{max:8,timeWindow:60_000}};
export async function createApp(o:Options) {
 const publicURL=new URL(o.appURL); if(!['https:','http:'].includes(publicURL.protocol)||publicURL.pathname!=='/'||publicURL.search||publicURL.hash||publicURL.username||publicURL.password) throw new Error('APP_URL 必须是没有路径或认证信息的站点地址');
 const app=Fastify({logger:o.logger??false,disableRequestLogging:true,trustProxy:o.trustProxy??false,bodyLimit:64*1024});
 const db=openStore(o.dbPath), box=cryptoBox(o.secret), root=resolve(o.imageDir), maxBytes=o.maxBytes??20*1024*1024;
 mkdirSync(root,{recursive:true});
 const telegram=new TelegramService(db,root,publicURL.origin,o.secret,o.telegramTransport);
 await app.register(cookie); await app.register(limiter,{max:240,timeWindow:60_000}); await app.register(multipart,{limits:{fileSize:maxBytes,files:1,fields:0,parts:1}});
 app.addHook('onRequest',async(req,reply)=>{
  reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY');
  reply.header('Content-Security-Policy',"default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  if(req.url.startsWith('/api/')) reply.header('Cache-Control','no-store');
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.url.startsWith('/api/')) {
   if(req.headers.origin!==publicURL.origin||req.headers['x-requested-with']!=='lightimg') bad('请求来源校验失败，请通过正式站点地址操作',403);
  }
 });
 function user(req:FastifyRequest,admin=false):User {
  const session=req.cookies.session; if(!session) return bad('请先登录',401);
  const u=db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires_at>? AND u.active=1').get(digest(session),Date.now()) as User|undefined;
  if(!u) return bad('登录已失效，请重新登录',401); if(admin&&u.role!=='admin') return bad('需要管理员权限',403); return u;
 }
 function publicUser(u:User){return {id:u.id,email:u.email,role:u.role};}
 function smtp():SMTP {const row=db.prepare("SELECT value FROM settings WHERE key='smtp'").get() as {value:string}|undefined;if(!row) return bad('管理员尚未配置邮件服务',503);try{return box.open(row.value);}catch{return bad('邮件配置无法解密，请检查 APP_SECRET',503);}}
 async function mail(to:string,subject:string,text:string) {
  const cfg=smtp(); if(o.sendMail) return o.sendMail(cfg,to,subject,text);
  const transport=nodemailer.createTransport({host:cfg.host,port:cfg.port,secure:cfg.mode==='tls',requireTLS:cfg.mode==='starttls',auth:cfg.username?{user:cfg.username,pass:cfg.password}:undefined,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true}});
  const sent=await transport.sendMail({from:cfg.from,to,subject,text}); if(!sent.accepted?.length) throw new Error('SMTP rejected');
 }
 async function issueInvite(to:string) {
  const raw=token(),hash=digest(raw),now=Date.now();
  const id=db.transaction(()=>{if(db.prepare('SELECT id FROM users WHERE email=?').get(to)) return bad('该邮箱已有账号');db.prepare("UPDATE invites SET status='revoked' WHERE email=? AND status IN ('pending','sent','failed')").run(to);return db.prepare("INSERT INTO invites(email,hash,status,expires_at,created_at) VALUES(?,?,'pending',?,?)").run(to,hash,now+7*86400_000,now).lastInsertRowid;})();
  try {await mail(to,'ohimg · 账号邀请',`管理员邀请你加入ohimg。请在 7 天内打开以下链接设置密码：\n${publicURL.origin}/accept#token=${raw}\n\n该邀请只能使用一次，账号邮箱为 ${to}。如果不是你期待的邀请，请忽略。`);db.prepare("UPDATE invites SET status='sent' WHERE id=? AND hash=? AND status='pending'").run(id,hash);return {id,status:'sent',message:'SMTP 已接受邮件，请收件人检查邮箱'};}
  catch {db.prepare("UPDATE invites SET status='failed' WHERE id=? AND hash=? AND status='pending'").run(id,hash);return bad('邀请发送失败，已记录。请检查 SMTP 配置后重新发送',502);}
 }
 const inviteFor=(raw:unknown)=>{if(typeof raw!=='string'||!/^[a-f0-9]{64}$/.test(raw))return bad('邀请无效或已失效');const row=db.prepare("SELECT * FROM invites WHERE hash=? AND status='sent' AND expires_at>?").get(digest(raw),Date.now()) as {id:number;email:string}|undefined;return row??bad('邀请无效、过期或已使用');};
 app.get('/api/health',async()=>({ok:true,initialized:!!db.prepare("SELECT id FROM users WHERE role='admin'").get()}));
 app.get('/api/session',async(req)=>({user:publicUser(user(req)),limits:{maxBytes,maxBatch:20}}));
 app.post('/api/login',{config:authLimit},async(req,reply)=>{const b=body(req);let e:string;try{e=email(b.email);}catch{return bad('邮箱或密码错误',401);}const u=db.prepare('SELECT * FROM users WHERE email=?').get(e) as User|undefined;
  // A dummy hash gives nonexistent users the same expensive verification step.
  const valid=await matches(b.password,u?.password??dummyHash);if(!u||!u.active||!valid)return bad('邮箱或密码错误',401);
  const raw=token(),now=Date.now(); db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(raw),u.id,now+14*86400_000);
  reply.setCookie('session',raw,{httpOnly:true,secure:publicURL.protocol==='https:',sameSite:'lax',path:'/',maxAge:14*86400});return {user:publicUser(u)};
 });
 app.post('/api/logout',async(req,reply)=>{if(req.cookies.session)db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(req.cookies.session));reply.clearCookie('session',{path:'/'});return {ok:true};});
 app.post('/api/password', {config:authLimit},async(req,reply)=>{const u=user(req),b=body(req);if(!await matches(b.currentPassword,u.password))return bad('原密码不正确');const h=await hashPassword(b.password);db.transaction(()=>{db.prepare('UPDATE users SET password=? WHERE id=?').run(h,u.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);})();reply.clearCookie('session',{path:'/'});return {ok:true};});
 app.post('/api/forgot',{config:{rateLimit:{max:3,timeWindow:60_000}}},async(req)=>{const e=email(body(req).email),u=db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(e) as User|undefined;
  const cfg=smtp();void cfg; // Fail explicitly if email is unavailable, without revealing account existence.
  if(u){const raw=token();db.transaction(()=>{db.prepare('DELETE FROM resets WHERE user_id=?').run(u.id);db.prepare('INSERT INTO resets VALUES(?,?,?)').run(digest(raw),u.id,Date.now()+3600_000);})();try{await mail(e,'ohimg · 重置密码',`请在 1 小时内打开链接重置密码：\n${publicURL.origin}/reset#token=${raw}\n\n如非本人操作，请忽略。`);}catch{db.prepare('DELETE FROM resets WHERE hash=?').run(digest(raw));app.log.warn('Password reset SMTP failed');}}
  return {message:'如果该邮箱有可用账号，系统会尝试发送重置邮件；请检查收件箱。'};
 });
 app.post('/api/reset',{config:authLimit},async(req)=>{const b=body(req);if(typeof b.token!=='string')return bad('重置链接无效');const h=await hashPassword(b.password);db.transaction(()=>{const row=db.prepare('SELECT r.user_id FROM resets r JOIN users u ON u.id=r.user_id WHERE r.hash=? AND r.expires_at>? AND u.active=1').get(digest(b.token as string),Date.now()) as {user_id:number}|undefined;if(!row)return bad('重置链接无效、过期或已使用');db.prepare('UPDATE users SET password=? WHERE id=?').run(h,row.user_id);db.prepare('DELETE FROM resets WHERE user_id=?').run(row.user_id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);})();return {ok:true};});
 app.post('/api/invite/info',{config:authLimit},async(req)=>({email:inviteFor(body(req).token).email}));
 app.post('/api/invite/accept',{config:authLimit},async(req)=>{const b=body(req),e=email(b.email);inviteFor(b.token);const password=await hashPassword(b.password);
  db.transaction(()=>{const row=inviteFor(b.token);if(row.email!==e)return bad('邮箱必须与邀请一致');if(db.prepare('SELECT id FROM users WHERE email=?').get(e))return bad('该邮箱已有账号');db.prepare("INSERT INTO users(email,password,role,created_at) VALUES(?,?,'member',?)").run(e,password,Date.now());db.prepare("UPDATE invites SET status='accepted' WHERE id=?").run(row.id);})();return {ok:true};
 });
 app.get('/api/admin/users',async(req)=>{user(req,true);return db.prepare('SELECT id,email,role,active,created_at FROM users ORDER BY id DESC').all();});
 app.patch('/api/admin/users/:id',async(req)=>{user(req,true);const id=Number((req.params as {id:string}).id),active=body(req).active;if(typeof active!=='boolean')return bad('状态不正确');db.transaction(()=>{const u=db.prepare('SELECT * FROM users WHERE id=?').get(id) as User|undefined;if(!u||u.role==='admin')return bad('仅能停用或启用普通用户');db.prepare('UPDATE users SET active=? WHERE id=?').run(active?1:0,id);if(!active){db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);db.prepare('DELETE FROM resets WHERE user_id=?').run(id);}})();return {ok:true};});
 app.get('/api/admin/invites',async(req)=>{user(req,true);return db.prepare("SELECT id,email,CASE WHEN status IN ('pending','sent','failed') AND expires_at<=? THEN 'expired' ELSE status END status,expires_at,created_at FROM invites ORDER BY id DESC LIMIT 200").all(Date.now());});
 app.post('/api/admin/invites',async(req)=>{user(req,true);return issueInvite(email(body(req).email));});
 app.post('/api/admin/invites/:id/resend',async(req)=>{user(req,true);const r=db.prepare("SELECT email,status FROM invites WHERE id=?").get(Number((req.params as {id:string}).id)) as {email:string;status:string}|undefined;if(!r||r.status==='accepted')return bad('该邀请不能重新发送');return issueInvite(r.email);});
 app.delete('/api/admin/invites/:id',async(req)=>{user(req,true);const result=db.prepare("UPDATE invites SET status='revoked' WHERE id=? AND status<>'accepted'").run(Number((req.params as {id:string}).id));if(!result.changes)return bad('邀请不存在或已接受');return {ok:true};});
 app.get('/api/admin/smtp',async(req)=>{user(req,true);const row=db.prepare("SELECT value FROM settings WHERE key='smtp'").get() as {value:string}|undefined;if(!row)return {};const cfg=box.open(row.value) as SMTP;return {...cfg,password:undefined,hasPassword:!!cfg.password};});
 app.put('/api/admin/smtp',async(req)=>{user(req,true);const b=body(req);if(typeof b.host!=='string'||!b.host.trim()||/[\s/:]/.test(b.host)||b.host.length>253||!['tls','starttls'].includes(String(b.mode)))return bad('SMTP 主机或 TLS 模式不正确');const port=Number(b.port);if(!Number.isInteger(port)||port<1||port>65535)return bad('SMTP 端口不正确');const row=db.prepare("SELECT value FROM settings WHERE key='smtp'").get() as {value:string}|undefined;const prev=row?box.open(row.value) as SMTP:undefined;const cfg:SMTP={host:b.host.trim(),port,mode:b.mode as SMTP['mode'],from:email(b.from),username:String(b.username??'').slice(0,254),password:typeof b.password==='string'&&b.password?b.password:prev?.password??''};if(cfg.password.length>4096)return bad('SMTP 密码过长');db.prepare("INSERT INTO settings VALUES('smtp',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(box.seal(cfg));return {ok:true};});
 app.post('/api/admin/smtp/test',async(req)=>{const u=user(req,true);try{await mail(u.email,'ohimg · 邮件配置测试','这是一封由你在管理员后台主动发送的测试邮件。');}catch{return bad('SMTP 测试失败，请检查配置、网络和发信权限',502);}return {message:'SMTP 已接受测试邮件，请检查管理员邮箱'};});
 app.get('/api/admin/telegram',async(req)=>{user(req,true);return telegram.publicConfig();});
 app.put('/api/admin/telegram',async(req)=>{const u=user(req,true);try{telegram.configure(body(req),u.id);}catch(e){return bad((e as Error).message);}return {ok:true};});
 function links(key:string) {const url=`${publicURL.origin}/i/${key}`;return key.endsWith('.mp4')?{url,markdown:`[视频](${url})`,html:`<video src="${url}" controls></video>`,bbcode:`[url]${url}[/url]`}:{url,markdown:`![图片](${url})`,html:`<img src="${url}" alt="图片">`,bbcode:`[img]${url}[/img]`};}
 app.get('/api/images',async(req)=>{const u=user(req),q=req.query as {page?:string;search?:string;all?:string};const all=q.all==='1';if(all&&u.role!=='admin')return bad('需要管理员权限',403);const page=Math.max(1,Math.min(100000,Number(q.page)||1));if(!Number.isInteger(page))return bad('页码不正确');const search=String(q.search??'').slice(0,200);const clause=`deleted_at IS NULL ${all?'':'AND user_id=@uid'} AND name LIKE @search ESCAPE '\\'`;const params={uid:u.id,search:`%${search.replace(/[\\%_]/g,'\\$&')}%`};const count=db.prepare(`SELECT count(*) total FROM images WHERE ${clause}`).get(params) as {total:number};const items=db.prepare(`SELECT images.id,key,name,mime,size,images.created_at,users.email owner FROM images JOIN users ON users.id=images.user_id WHERE ${clause} ORDER BY images.id DESC LIMIT 30 OFFSET @offset`).all({...params,offset:(page-1)*30}) as any[];return {total:count.total,page,items:items.map(i=>({...i,links:links(i.key)}))};});
 app.post('/api/images',async(req)=>{const u=user(req);const f=await req.file();if(!f)return bad('请选择图片');let buffer:Buffer;try{buffer=await f.toBuffer();}catch{return bad('图片超过大小限制',413);}if(f.file.truncated)return bad('图片超过大小限制',413);
  let detected;try{detected=await fileTypeFromBuffer(buffer);}catch{return bad('图片格式无法识别');}if(!detected||!['image/jpeg','image/png','image/gif','image/webp'].includes(detected.mime))return bad('只支持 JPEG、PNG、GIF、WebP 图片');
  const key=`${token()}.${detected.ext}`,path=join(root,key),name=basename(f.filename.replaceAll('\\','/')).replace(/[\x00-\x1f]/g,'').slice(0,200)||'图片';
  try{await writeFile(path,buffer,{flag:'wx',mode:0o640});const id=db.prepare('INSERT INTO images(user_id,key,name,mime,size,created_at) VALUES(?,?,?,?,?,?)').run(u.id,key,name,detected.mime,buffer.length,Date.now()).lastInsertRowid;return {id:Number(id),name,key,size:buffer.length,links:links(key)};}
  catch{try{await unlink(path);}catch{}return bad('图片保存失败，请检查服务器空间及目录权限',507);}
 });
 app.get('/i/:key',async(req,reply)=>{
  const key=(req.params as {key:string}).key;if(!/^[a-f0-9]{64}\.(jpg|png|gif|webp|mp4)$/.test(key))return bad('文件不存在',404);
  const row=db.prepare('SELECT mime FROM images WHERE key=? AND deleted_at IS NULL').get(key) as {mime:string}|undefined;if(!row)return bad('文件不存在',404);
  const path=join(root,key);let size:number;try{size=(await stat(path)).size;}catch{return bad('文件不存在',404);}
  reply.header('Cache-Control','public, max-age=0, must-revalidate').header('Accept-Ranges','bytes').type(row.mime);
  const range=req.headers.range;
  if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);let start=0,end=size-1;
   if(!m||(!m[1]&&!m[2]))return reply.code(416).header('Content-Range',`bytes */${size}`).send();
   if(!m[1])start=Math.max(0,size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(Number(m[2]),size-1);}
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size||start<0)return reply.code(416).header('Content-Range',`bytes */${size}`).send();
   reply.code(206).header('Content-Range',`bytes ${start}-${end}/${size}`).header('Content-Length',end-start+1);return reply.send(createReadStream(path,{start,end}));
  }
  reply.header('Content-Length',size);return reply.send(createReadStream(path));
 });
 async function cleanup(id:number,key:string){try{await unlink(join(root,key));db.prepare('UPDATE images SET cleanup_error=0 WHERE id=?').run(id);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'){db.prepare('UPDATE images SET cleanup_error=0 WHERE id=?').run(id);return true;}db.prepare('UPDATE images SET cleanup_error=1 WHERE id=?').run(id);app.log.warn({imageId:id},'Image file cleanup failed');return false;}}
 app.delete('/api/images/:id',async(req)=>{const u=user(req),id=Number((req.params as {id:string}).id);const row=db.prepare('SELECT user_id,key FROM images WHERE id=? AND deleted_at IS NULL').get(id) as {user_id:number;key:string}|undefined;if(!row)return bad('图片不存在',404);if(row.user_id!==u.id&&u.role!=='admin')return bad('无权删除该图片',403);db.prepare('UPDATE images SET deleted_at=?,cleanup_error=1 WHERE id=?').run(Date.now(),id);return {ok:true,cleaned:await cleanup(id,row.key)};});
 app.get('/api/admin/cleanup',async(req)=>{user(req,true);return db.prepare('SELECT id,name,deleted_at FROM images WHERE deleted_at IS NOT NULL AND cleanup_error=1').all();});
 app.post('/api/admin/cleanup',async(req)=>{user(req,true);const rows=db.prepare('SELECT id,key FROM images WHERE deleted_at IS NOT NULL AND cleanup_error=1').all() as {id:number;key:string}[];let remaining=0;for(const row of rows)if(!await cleanup(row.id,row.key))remaining++;return {remaining};});
 const web=resolve(fileURLToPath(new URL('../web',import.meta.url)));if(existsSync(join(web,'index.html'))){await app.register(staticFiles,{root:web,prefix:'/',index:false});app.get('/',async(_req,reply)=>reply.sendFile('index.html'));}
 app.setNotFoundHandler((req,reply)=>{if(req.url.startsWith('/api/')||req.url.startsWith('/i/')||req.url.startsWith('/assets/')||req.method!=='GET')return reply.code(404).send({error:'页面或接口不存在'});if(existsSync(join(web,'index.html')))return reply.sendFile('index.html');return reply.code(404).send({error:'前端尚未构建'});});
 app.setErrorHandler((error,req,reply)=>{const code=error instanceof Problem?error.statusCode:(error as {statusCode?:number}).statusCode??400;if(code>=500&&! (error instanceof Problem))app.log.error({code},'Request failed');return reply.code(code).send({error:error instanceof Problem?error.message:code===429?'操作过于频繁，请稍后重试':code===413?'图片超过大小限制':'请求内容不正确'});});
 const dummyHash=await hashPassword(token());app.addHook('onClose',async()=>{telegram.close();db.close();});await app.ready();if(o.telegramWorker)telegram.start();return {app,db,telegram};
}
