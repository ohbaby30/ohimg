import { createApp } from './app.js';
const {app}=await createApp({dbPath:process.env.DB_PATH??'/data/db/lightimg.sqlite',imageDir:process.env.IMAGE_DIR??'/data/images',appURL:process.env.APP_URL??'http://localhost:18080',secret:process.env.APP_SECRET??'',logger:true,telegramWorker:true,trustProxy:process.env.TRUST_PROXY?.split(',').map(x=>x.trim()).filter(Boolean)});
await app.listen({host:'0.0.0.0',port:Number(process.env.PORT??8080)});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void app.close().then(()=>process.exit(0)));
