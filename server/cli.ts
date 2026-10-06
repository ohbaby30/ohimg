import Database from 'better-sqlite3';
import { openStore, email, hashPassword } from './store.js';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
const [command,...args]=process.argv.slice(2);
const path=process.env.DB_PATH??'/data/db/lightimg.sqlite';
const db=command==='backup'?new Database(path,{readonly:true,fileMustExist:true}):openStore(path);
async function password(){if(!stdin.isTTY){let text='';for await(const chunk of stdin)text+=chunk;return text.replace(/\r?\n$/,'');}stdout.write('输入密码（12–128字符，不回显）: ');stdin.setRawMode(true);stdin.resume();return new Promise<string>((done,reject)=>{let value='';const finish=()=>{stdin.off('data',listener);stdin.setRawMode(false);stdin.pause();stdout.write('\n');};const listener=(chunk:Buffer)=>{for(const c of chunk.toString()){if(c==='\u0003'){finish();reject(new Error('已取消'));return;}if(c==='\r'||c==='\n'){finish();done(value);return;}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' ')value+=c;}};stdin.on('data',listener);});}
try {
 if(command==='init-admin') {let input=args[0];if(!input){if(!stdin.isTTY)throw new Error('请提供管理员邮箱');const rl=createInterface({input:stdin,output:stdout});input=await new Promise<string>(r=>rl.question('管理员邮箱: ',r));rl.close();}const e=email(input);const existing=db.prepare("SELECT email FROM users WHERE role='admin'").get() as {email:string}|undefined;if(existing){if(existing.email!==e)throw new Error('管理员已经存在，不能再次初始化其他管理员');console.log('管理员已存在，密码保持不变');}else{const h=await hashPassword(await password());db.prepare("INSERT INTO users(email,password,role,created_at) VALUES(?,?,'admin',?)").run(e,h,Date.now());console.log('管理员已创建：'+e);}}
 else if(command==='reset-password'){const e=email(args[0]);if(!db.prepare('SELECT id FROM users WHERE email=?').get(e))throw new Error('账号不存在');const h=await hashPassword(await password());db.transaction(()=>{db.prepare('UPDATE users SET password=? WHERE email=?').run(h,e);db.prepare('DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE email=?)').run(e);db.prepare('DELETE FROM resets WHERE user_id=(SELECT id FROM users WHERE email=?)').run(e);})();console.log('密码已重置，旧会话已撤销');}
 else if(command==='backup'){if(!args[0])throw new Error('请提供全新的备份文件路径');if(existsSync(resolve(args[0])))throw new Error('备份文件已存在，拒绝覆盖');await db.backup(resolve(args[0]));console.log('数据库备份完成');}
 else throw new Error('用法：init-admin [email] | reset-password email | backup path');
} catch(e){console.error((e as Error).message);process.exitCode=1;} finally {db.close();}
