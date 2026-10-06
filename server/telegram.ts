import type Database from 'better-sqlite3';
import {writeFile,unlink} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {fileTypeFromBuffer} from 'file-type';
import {cryptoBox,digest,token} from './store.js';
export const TELEGRAM_MAX_BYTES=20_000_000;
export type TelegramConfig={enabled:boolean;token:string;adminTelegramId:string;ownerId:number};
type Transport={call:(token:string,method:string,data:Record<string,unknown>,signal?:AbortSignal)=>Promise<any>;download:(token:string,path:string,signal?:AbortSignal)=>Promise<Buffer>};
async function limitedBody(response:Response){
 if(!response.ok||!response.body)throw new Error('Telegram 文件下载失败');
 if(Number(response.headers.get('content-length'))>TELEGRAM_MAX_BYTES)throw new Error('文件超过 Telegram 20 MB 上限');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>TELEGRAM_MAX_BYTES)throw new Error('文件超过 Telegram 20 MB 上限');chunks.push(r.value);}}finally{await reader.cancel();}
 return Buffer.concat(chunks,size);
}
const transport:Transport={
 async call(t,m,data,signal){try{const r=await fetch(`https://api.telegram.org/bot${t}/${m}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal:signal??AbortSignal.timeout(35000)});const json=await r.json() as any;if(!r.ok||!json.ok)throw new Error();return json.result;}catch{throw new Error('Telegram API 请求失败，请检查 Token、网络及是否有其他程序使用此 Bot');}},
 async download(t,path,signal){if(!/^[a-zA-Z0-9_\-/\.]+$/.test(path)||path.includes('..')||path.startsWith('/'))throw new Error('Telegram 文件路径无效');try{return await limitedBody(await fetch(`https://api.telegram.org/file/bot${t}/${path}`,{signal:signal??AbortSignal.timeout(35000)}));}catch{throw new Error('Telegram 文件下载失败或超过 20 MB，请检查网络及文件大小');}}
};
export class TelegramService{
 private box;private timer?:ReturnType<typeof setTimeout>;private controller?:AbortController;private closed=false;private revision=0;private worker=false;
 status='未启用';lastProcessedAt:number|null=null;
 constructor(private db:Database.Database,private root:string,private origin:string,secret:string,private io:Transport=transport){
  this.box=cryptoBox(secret);
  db.exec('CREATE TABLE IF NOT EXISTS telegram_receipts(bot TEXT NOT NULL,update_id INTEGER NOT NULL,image_id INTEGER NOT NULL REFERENCES images(id),PRIMARY KEY(bot,update_id));');
 }
 config():TelegramConfig|undefined{const row=this.db.prepare("SELECT value FROM settings WHERE key='telegram'").get() as {value:string}|undefined;return row?this.box.open(row.value):undefined;}
 publicConfig(){const c=this.config();return {enabled:c?.enabled??false,adminTelegramId:c?.adminTelegramId??'',hasToken:!!c?.token,status:this.status,lastProcessedAt:this.lastProcessedAt};}
 configure(input:Record<string,unknown>,ownerId:number){
  const prev=this.config(),t=typeof input.token==='string'&&input.token.trim()?input.token.trim():prev?.token??'',id=String(input.adminTelegramId??'').trim();
  if(typeof input.enabled!=='boolean')throw new Error('启用状态不正确');
  if(input.enabled&&(!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(t)||(id!==''&&(!/^\d{1,16}$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)<1))))throw new Error('请输入有效 Bot Token 和管理员 Telegram 数字 ID');
  if(t.length>256||id.length>16)throw new Error('Telegram 配置过长');
  const c={enabled:input.enabled,token:t,adminTelegramId:id,ownerId};
  this.db.prepare("INSERT INTO settings VALUES('telegram',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(this.box.seal(c));
  this.revision++;this.controller?.abort();this.status=c.enabled?'等待连接':'未启用';
 }
 private active(c:TelegramConfig,revision:number){if(this.closed||revision!==this.revision)return false;const u=this.db.prepare("SELECT id FROM users WHERE id=? AND active=1 AND role='admin'").get(c.ownerId);return c.enabled&&!!u;}
 async handle(update:any,c:TelegramConfig,signal?:AbortSignal){
  const revision=this.revision,m=update.message;
  if(!Number.isSafeInteger(update.update_id)||!m||m.chat?.type!=='private'||m.from?.is_bot||String(m.chat?.id)!==String(m.from?.id)||!this.active(c,revision))return;
  if(m.text==='/id'){await this.io.call(c.token,'sendMessage',{chat_id:m.chat.id,text:`你的 Telegram ID：${m.from.id}`},signal);return;}
  if(!c.adminTelegramId||String(m.from?.id)!==c.adminTelegramId)return;
  const reply=async(text:string)=>{if(this.active(c,revision))await this.io.call(c.token,'sendMessage',{chat_id:m.chat.id,text,link_preview_options:{is_disabled:true}},signal);};
  const photos=Array.isArray(m.photo)?m.photo:[];
  const file=m.document??m.video??m.animation??photos.at(-1);
  if(!file){await reply('发送图片或 MP4 视频即可保存到图床，单文件最多 20 MB。发送图片时选择“文件”可保留 Telegram 接收的原文件。');return;}
  const bot=digest(c.token),existing=this.db.prepare('SELECT i.key,i.deleted_at FROM telegram_receipts t JOIN images i ON i.id=t.image_id WHERE t.bot=? AND t.update_id=?').get(bot,update.update_id) as {key:string;deleted_at:number|null}|undefined;
  if(existing){await reply(existing.deleted_at?'此文件已在图床中删除。':`${this.origin}/i/${existing.key}`);return;}
  let bytes:Buffer,detected:Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try{
   if(!file.file_id||Number(file.file_size)>TELEGRAM_MAX_BYTES)throw new Error('文件超过 Telegram 20 MB 上限');
   const info=await this.io.call(c.token,'getFile',{file_id:file.file_id},signal);
   if(!info.file_path||Number(info.file_size)>TELEGRAM_MAX_BYTES)throw new Error('文件超过 Telegram 20 MB 上限或无法下载');
   bytes=await this.io.download(c.token,info.file_path,signal);
   if(!bytes.length||bytes.length>TELEGRAM_MAX_BYTES)throw new Error('文件为空或超过 Telegram 20 MB 上限');
   detected=await fileTypeFromBuffer(bytes);
   if(!detected||!['image/jpeg','image/png','image/gif','image/webp','video/mp4'].includes(detected.mime))throw new Error('只支持 JPEG、PNG、GIF、WebP 图片及 MP4 视频');
  }catch(e){await reply(`保存失败：${(e as Error).message}。请检查后重新发送。`);return;}
  if(!this.active(c,revision))return;
  const key=`${token()}.${detected.ext}`,path=join(this.root,key),name=basename(String(file.file_name??`telegram-${m.message_id}.${detected.ext}`).replaceAll('\\','/')).replace(/[\x00-\x1f]/g,'').slice(0,200);
  try{
   await writeFile(path,bytes,{flag:'wx',mode:0o640});
   if(!this.active(c,revision)){await unlink(path);return;}
   this.db.transaction(()=>{const id=this.db.prepare('INSERT INTO images(user_id,key,name,mime,size,created_at) VALUES(?,?,?,?,?,?)').run(c.ownerId,key,name,detected!.mime,bytes.length,Date.now()).lastInsertRowid;this.db.prepare('INSERT INTO telegram_receipts VALUES(?,?,?)').run(bot,update.update_id,id);})();
  }catch{try{await unlink(path);}catch{}await reply('保存失败：请检查 VPS 磁盘空间和权限后重新发送。');return;}
  this.lastProcessedAt=Date.now();await reply(`${this.origin}/i/${key}`);
 }
 start(){if(this.worker)return;this.worker=true;void this.tick();}
 private async tick(){
  if(this.closed)return;let delay=1000;const revision=this.revision;this.controller=new AbortController();const timeout=setTimeout(()=>this.controller?.abort(),35000);
  try{
   const c=this.config();if(c?.enabled&&this.active(c,revision)){
    const hook=await this.io.call(c.token,'getWebhookInfo',{},this.controller.signal);if(hook.url)throw new Error('Bot 已设置 Webhook，请先停用原程序并移除其 Webhook');
    const key='telegram_offset_'+digest(c.token),row=this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as {value:string}|undefined;
    const updates=await this.io.call(c.token,'getUpdates',{offset:Number(row?.value??0),timeout:20,limit:20,allowed_updates:['message']},this.controller.signal);
    this.status=c.adminTelegramId?'已连接':'已连接，未设置管理员 ID，仅响应 /id';
    for(const u of updates){if(!this.active(c,revision))break;await this.handle(u,c,this.controller.signal);if(this.active(c,revision))this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(u.update_id+1));}
   }else this.status='未启用';
  }catch(e){if(!this.closed&&revision===this.revision){this.status=(e as Error).message;delay=5000;}}
  finally{clearTimeout(timeout);if(!this.closed)this.timer=setTimeout(()=>void this.tick(),delay);}
 }
 close(){this.closed=true;if(this.timer)clearTimeout(this.timer);this.controller?.abort();}
}
