import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes, scrypt, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export type User = { id:number; email:string; role:'admin'|'member'; active:number; password:string };
export const digest = (s:string) => createHash('sha256').update(s).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export function email(value:unknown) { if(typeof value!=='string') throw new Error('邮箱格式不正确'); const e=value.trim().toLowerCase(); if(e.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('邮箱格式不正确'); return e; }
export async function hashPassword(p:unknown) { if(typeof p!=='string'||p.length<12||p.length>128) throw new Error('密码须为 12–128 个字符'); const salt=token(); return `${salt}:${(await derive(p,salt,64) as Buffer).toString('hex')}`; }
export async function matches(p:unknown,h:string) { if(typeof p!=='string'||p.length>128) return false; const [salt,key]=h.split(':'); if(!salt||!key) return false; const b=await derive(p,salt,64) as Buffer; const k=Buffer.from(key,'hex'); return k.length===b.length&&timingSafeEqual(k,b); }
export function openStore(path:string) {
 mkdirSync(dirname(resolve(path)),{recursive:true}); const db=new Database(path); db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');
 db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','member')),active INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS invites(id INTEGER PRIMARY KEY,email TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,status TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS resets(hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS images(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),key TEXT UNIQUE NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL,deleted_at INTEGER,cleanup_error INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS image_owner ON images(user_id,created_at);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 PRAGMA user_version = 1;`); return db;
}
export function cryptoBox(secret:string) {
 if(secret.length<32) throw new Error('APP_SECRET 至少需要 32 个字符'); const key=createHash('sha256').update(secret).digest();
 return {seal(value:unknown){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const b=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]).toString('base64');},open(value:string){const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString());}};
}
