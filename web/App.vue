<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
type User={id:number;email:string;role:'admin'|'member'};
type Links={url:string;markdown:string;html:string;bbcode:string};
type Photo={id:number;name:string;size:number;key:string;mime:string;owner:string;created_at:number;links:Links};
type Upload={id:string;file:File;preview:string;status:'waiting'|'uploading'|'done'|'failed';progress:number;error:string;links?:Links};
const router=useRouter(),route=useRoute(),me=ref<User|null>(null),ready=ref(false),busy=ref(false),loading=ref(false),notice=ref(''),noticeError=ref(false),invitedEmail=ref(''),inviteError=ref('');
let noticeTimer:ReturnType<typeof setTimeout>;
function toast(text:string,error=false){notice.value=text;noticeError.value=error;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.value='',6500);}
async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{const headers=new Headers(options.headers);headers.set('X-Requested-With','lightimg');if(options.body)headers.set('Content-Type','application/json');const res=await fetch('/api'+path,{...options,headers,credentials:'same-origin'});const data=await res.json();if(!res.ok){if(res.status===401&&path!='/login')me.value=null;throw new Error(data.error??'请求失败');}return data;}
const send=(path:string,data:any,method='POST')=>api(path,{method,body:JSON.stringify(data)});
const path=computed(()=>route.path),admin=computed(()=>me.value?.role==='admin'),publicForm=computed(()=>['/accept','/reset','/forgot'].includes(path.value));
const labels:Record<string,string>={'/upload':'上传图片','/images':'我的图片','/account':'账号设置','/admin/images':'全站图片','/admin/users':'用户管理','/admin/invites':'邮箱邀请','/admin/telegram':'Telegram Bot','/admin/mail':'邮件设置'};
const title=computed(()=>labels[path.value]??'上传图片');
const descriptions:Record<string,string>={'/upload':'拖放、粘贴或选择图片，让分享变得简单。','/images':'收藏每一张图片，随时找到它的分享链接。','/admin/images':'查看和管理所有用户上传的图片。','/admin/users':'只有受邀用户才能加入，账号权限由你掌握。','/admin/invites':'用一封邮件，邀请新伙伴加入。','/admin/mail':'连接你的发信邮箱，用于邀请和密码重置。','/admin/telegram':'从 Telegram 私聊上传图片和视频。','/account':'管理你的登录密码。'};
const credentials=reactive({email:'',password:'',confirm:'',currentPassword:''});
async function formAction(){if(busy.value)return;busy.value=true;try{if(path.value==='/accept'||path.value==='/reset'){if(credentials.password!==credentials.confirm)throw new Error('两次输入的密码不一致');const raw=new URLSearchParams(route.hash.slice(1)).get('token');await send(path.value==='/accept'?'/invite/accept':'/reset',{token:raw,email:invitedEmail.value,password:credentials.password});toast(path.value==='/accept'?'账号已创建，请登录':'密码已重置，请登录');credentials.password='';credentials.confirm='';await router.replace('/login');}
else if(path.value==='/forgot'){const r=await send('/forgot',{email:credentials.email});toast(r.message);}
else{const r=await send('/login',{email:credentials.email,password:credentials.password});me.value=r.user;credentials.password='';await router.replace('/upload');}}catch(e){toast((e as Error).message,true);}finally{busy.value=false;}}
async function logout(){try{await send('/logout',{});me.value=null;await router.replace('/login');}catch(e){toast((e as Error).message,true);}}
async function changePassword(){busy.value=true;try{if(credentials.password!==credentials.confirm)throw new Error('两次输入的密码不一致');await send('/password',{currentPassword:credentials.currentPassword,password:credentials.password});credentials.password='';credentials.confirm='';credentials.currentPassword='';me.value=null;toast('密码已修改，请重新登录');await router.replace('/login');}catch(e){toast((e as Error).message,true);}finally{busy.value=false;}}
const photos=ref<Photo[]>([]),total=ref(0),page=ref(1),search=ref(''),pageError=ref(''),users=ref<any[]>([]),invites=ref<any[]>([]),cleanup=ref<any[]>([]);
const telegramLoaded=ref(false),telegram=reactive({enabled:false,token:'',adminTelegramId:'',hasToken:false,status:'未启用'});
const smtpLoaded=ref(false);
const smtp=reactive({host:'',port:587,mode:'starttls',username:'',password:'',from:'',hasPassword:false});
const formatBytes=(n:number)=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const date=(n:number)=>new Date(n).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
let loadVersion=0;
async function load(){const version=++loadVersion;if(!me.value)return;loading.value=true;pageError.value='';try{const p=path.value;
if(p==='/images'||p==='/admin/images'){const r=await api(`/images?page=${page.value}&search=${encodeURIComponent(search.value)}${p==='/admin/images'?'&all=1':''}`);if(version!==loadVersion)return;photos.value=r.items;total.value=r.total;if(p==='/admin/images')cleanup.value=await api('/admin/cleanup');}
if(p==='/admin/telegram'){telegramLoaded.value=false;const r=await api('/admin/telegram');if(version===loadVersion){Object.assign(telegram,r,{token:''});telegramLoaded.value=true;}}
if(p==='/admin/users'){const r=await api('/admin/users');if(version===loadVersion)users.value=r;}
if(p==='/admin/invites'){const r=await api('/admin/invites');if(version===loadVersion)invites.value=r;}
if(p==='/admin/mail'){smtpLoaded.value=false;const r=await api('/admin/smtp');if(version===loadVersion){Object.assign(smtp,{host:'',port:587,mode:'starttls',username:'',password:'',from:'',hasPassword:false},r);smtp.password='';smtpLoaded.value=true;}}
}catch(e){if(version===loadVersion)pageError.value=(e as Error).message;}finally{if(version===loadVersion)loading.value=false;}}
async function refresh(){await load();}
async function find(){page.value=1;await load();}
async function nextPage(delta:number){page.value+=delta;await load();}
async function copy(text:string){let copied=false;if(navigator.clipboard&&window.isSecureContext){try{await navigator.clipboard.writeText(text);copied=true;}catch{}}if(!copied){const previous=document.activeElement as HTMLElement|null;const input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.focus();input.select();try{copied=document.execCommand('copy');}catch{}input.remove();previous?.focus();}toast(copied?'链接已复制':'复制失败，请在链接框中手动复制',!copied);}

const deletion=ref<Photo|null>(null);
async function deletePhoto(){if(!deletion.value)return;busy.value=true;try{const r=await api('/images/'+deletion.value.id,{method:'DELETE'});deletion.value=null;toast(r.cleaned?'图片已删除，外链已失效':'外链已失效，文件清理失败，可在全站图片中重试',!r.cleaned);if(photos.value.length===1&&page.value>1)page.value--;await load();}catch(e){toast((e as Error).message,true);}finally{busy.value=false;}}
async function retryCleanup(){busy.value=true;try{const r=await send('/admin/cleanup',{});toast(r.remaining?`仍有 ${r.remaining} 个文件未能清理`:'待清理文件已处理',!!r.remaining);await load();}catch(e){toast((e as Error).message,true);}finally{busy.value=false;}}
const inviteTo=ref('');
async function invite(){busy.value=true;try{const r=await send('/admin/invites',{email:inviteTo.value});toast(r.message);inviteTo.value='';}catch(e){toast((e as Error).message,true);}finally{busy.value=false;await load();}}
const revoke=ref<any>(null),toggleUser=ref<any>(null);
async function resend(id:number){busy.value=true;try{const r=await send(`/admin/invites/${id}/resend`,{});toast(r.message);}catch(e){toast((e as Error).message,true);}finally{busy.value=false;await load();}}
async function revokeInvite(){busy.value=true;try{await api('/admin/invites/'+revoke.value.id,{method:'DELETE'});revoke.value=null;toast('邀请已撤销');await load();}catch(e){toast((e as Error).message,true);}finally{busy.value=false;}}
async function toggle(){busy.value=true;try{await send('/admin/users/'+toggleUser.value.id,{active:!toggleUser.value.active},'PATCH');toggleUser.value=null;await load();toast('账号状态已更新');}catch(e){toast((e as Error).message,true);}finally{busy.value=false;}}
async function saveTelegram(){busy.value=true;try{await send('/admin/telegram',telegram,'PUT');toast('Telegram 配置已保存');await load();}catch(e){toast((e as Error).message,true);}finally{busy.value=false;}}
async function saveSMTP(){busy.value=true;try{await send('/admin/smtp',smtp,'PUT');toast('邮件配置已保存');await load();}catch(e){toast((e as Error).message,true);}finally{busy.value=false;}}
async function testSMTP(){busy.value=true;try{const r=await send('/admin/smtp/test',{});toast(r.message);}catch(e){toast((e as Error).message,true);}finally{busy.value=false;}}
const queue=ref<Upload[]>([]),dragging=ref(false),fileInput=ref<HTMLInputElement|null>(null),running=ref(false),maxBytes=ref(20*1048576);
const complete=computed(()=>queue.value.filter(i=>i.status==='done').length);
function pick(files:FileList|File[]|null){if(!files)return;const list=Array.from(files);if(list.length>20){toast('每次最多选择 20 张图片',true);return;}if(queue.value.length+list.length>60){toast('请先清空已完成的上传记录',true);return;}for(const f of list){if(f.size>maxBytes.value){toast(`${f.name} 超过 ${formatBytes(maxBytes.value)} 上限`,true);continue;}if(!['image/jpeg','image/png','image/gif','image/webp'].includes(f.type)){toast(`${f.name} 不是支持的图片类型`,true);continue;}queue.value.push({id:crypto.randomUUID(),file:f,preview:URL.createObjectURL(f),status:'waiting',progress:0,error:''});}void runUploads();}
function onPick(event:Event){const el=event.target as HTMLInputElement;pick(el.files);el.value='';}
function onDrop(event:DragEvent){dragging.value=false;pick(event.dataTransfer?.files??null);}
async function uploadOne(item:Upload){item.status='uploading';item.progress=0;item.error='';await new Promise<void>(done=>{const xhr=new XMLHttpRequest();xhr.open('POST','/api/images');xhr.setRequestHeader('X-Requested-With','lightimg');xhr.upload.onprogress=e=>{if(e.lengthComputable)item.progress=Math.round(e.loaded/e.total*100);};xhr.timeout=120000;const fail=(message:string)=>{item.status='failed';item.error=message;done();};xhr.onerror=()=>fail('网络连接失败，请重试');xhr.ontimeout=()=>fail('上传超时，请重试');xhr.onload=()=>{try{const r=JSON.parse(xhr.responseText);if(xhr.status>=200&&xhr.status<300){item.status='done';item.progress=100;item.links=r.links;done();}else{if(xhr.status===401)me.value=null;fail(r.error??'上传失败');}}catch{fail('服务器响应异常');}};const form=new FormData();form.append('file',item.file);xhr.send(form);});}
async function runUploads(){if(running.value)return;running.value=true;try{while(true){const batch=queue.value.filter(i=>i.status==='waiting').slice(0,3);if(!batch.length)break;await Promise.all(batch.map(uploadOne));}}finally{running.value=false;}}
function retry(item:Upload){item.status='waiting';void runUploads();}
function clearDone(){queue.value=queue.value.filter(item=>{if(item.status==='done'){URL.revokeObjectURL(item.preview);return false;}return true;});}
function paste(e:ClipboardEvent){const el=e.target as HTMLElement;if(path.value!='/upload'||!me.value||(el instanceof Element&&el.closest('input,textarea,[contenteditable]')))return;const files=Array.from(e.clipboardData?.items??[]).filter(i=>i.kind==='file').map(i=>i.getAsFile()).filter((f):f is File=>!!f);if(files.length){e.preventDefault();pick(files);}}
const inviteStatus:Record<string,string>={sent:'已发出',pending:'发送中',accepted:'已接受',expired:'已过期',revoked:'已撤销',failed:'发送失败'};
async function inspectInvite(){invitedEmail.value='';inviteError.value='';if(path.value==='/accept'){try{const r=await send('/invite/info',{token:new URLSearchParams(route.hash.slice(1)).get('token')});invitedEmail.value=r.email;}catch(e){inviteError.value=(e as Error).message;}}}
watch(()=>route.fullPath,async()=>{page.value=1;search.value='';credentials.password='';credentials.confirm='';await inspectInvite();await load();});
let returnFocus:HTMLElement|null=null;
const modalOpen=computed(()=>!!(deletion.value||revoke.value||toggleUser.value));
watch(modalOpen,async(open)=>{if(open){returnFocus=document.activeElement as HTMLElement;await nextTick();document.querySelector<HTMLButtonElement>('.modal button')?.focus();}else if(returnFocus?.isConnected)returnFocus.focus();});
function modalKeys(e:KeyboardEvent){if(!modalOpen.value)return;if(e.key==='Escape'&&!busy.value){deletion.value=null;revoke.value=null;toggleUser.value=null;}if(e.key==='Tab'){const controls=Array.from(document.querySelectorAll<HTMLButtonElement>('.modal button:not(:disabled)'));const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}
onMounted(async()=>{document.addEventListener('paste',paste);document.addEventListener('keydown',modalKeys);try{const r=await api('/session');me.value=r.user;maxBytes.value=r.limits.maxBytes;}catch{}ready.value=true;if(path.value==='/'||path.value==='/login'&&me.value)await router.replace(me.value?'/upload':'/login');await inspectInvite();await load();});
onUnmounted(()=>{document.removeEventListener('paste',paste);document.removeEventListener('keydown',modalKeys);clearTimeout(noticeTimer);for(const item of queue.value)URL.revokeObjectURL(item.preview);});
</script>

<template>
 <div v-if="notice" :class="['toast',{'toast-error':noticeError}]" role="status">{{ notice }}</div>
 <div v-if="!ready" class="boot">正在打开ohimg…</div>
 <main v-else-if="!me || publicForm" class="auth-page">
  <a class="brand auth-brand" href="/"> <span class="logo">▧</span><span>ohimg<small>SELF-HOSTED MEDIA</small></span></a>
  <div class="auth-intro"><span class="eyebrow">A LITTLE SPACE FOR YOUR IMAGES</span><h1>图片有处安放，<br><em>分享自然简单。</em></h1><p>把每一张值得分享的图片，<br>变成随时可用的链接。</p><div class="art"><span class="art-shape one"></span><span class="art-shape two"></span><div class="art-frame">◒<small>YOUR NEXT GREAT IMAGE</small></div><span class="art-dot"></span></div><span class="auth-foot">仅限邀请加入 · 图片外链公开</span></div>
  <section class="auth-card">
   <span class="badge">{{ path==='/accept'?'专属邀请':'你的图片工作台' }}</span>
   <h2>{{ path==='/accept'?'欢迎加入ohimg':path==='/reset'?'设置新密码':path==='/forgot'?'找回密码':'欢迎回来' }}</h2>
   <p class="muted">{{ path==='/accept'?'这份邀请属于你，设置密码即可开始。':path==='/reset'?'重置后，所有旧登录会话将失效。':path==='/forgot'?'请输入账号邮箱，我们会尝试发送重置链接。':'登录后，上传和管理你的图片。' }}</p>
   <p v-if="inviteError" class="error-box">{{ inviteError }}。请联系管理员重新邀请。</p>
   <form v-else @submit.prevent="formAction" class="form">
    <label v-if="path!=='/reset'">邮箱<input v-if="path==='/accept'" :value="invitedEmail" readonly type="email"><input v-else v-model="credentials.email" type="email" required autocomplete="username" placeholder="you@example.com"></label>
    <label v-if="path!=='/forgot'">{{ path==='/accept'||path==='/reset'?'设置密码':'密码' }}<input v-model="credentials.password" type="password" required :minlength="path==='/accept'||path==='/reset'?12:1" maxlength="128" :autocomplete="path==='/accept'||path==='/reset'?'new-password':'current-password'" placeholder="输入你的密码"></label>
    <label v-if="path==='/accept'||path==='/reset'">确认密码<input v-model="credentials.confirm" type="password" required minlength="12" maxlength="128" autocomplete="new-password" placeholder="再输入一次密码"></label>
    <button class="primary wide" :disabled="busy||path==='/accept'&&!invitedEmail">{{ busy?'正在处理…':path==='/accept'?'接受邀请并创建账号':path==='/reset'?'重置密码':path==='/forgot'?'发送重置邮件':'登录ohimg →' }}</button>
   </form>
   <div class="auth-links"><RouterLink v-if="path==='/forgot'||path==='/accept'||path==='/reset'" to="/login">返回登录</RouterLink><RouterLink v-else to="/forgot">忘记密码？</RouterLink></div>
   <p class="auth-note">这里暂不开放注册。需要账号？请联系管理员获取邮箱邀请。</p>
  </section>
 </main>
 <div v-else class="shell">
  <aside class="sidebar">
   <RouterLink to="/upload" class="brand"><span class="logo">▧</span><span>ohimg<small>SELF-HOSTED MEDIA</small></span></RouterLink>
   <div class="nav-label">图片工作台</div><nav><RouterLink to="/upload"><span>↑</span>上传图片</RouterLink><RouterLink to="/images"><span>▧</span>我的图片</RouterLink><RouterLink to="/account"><span>◎</span>账号设置</RouterLink></nav>
   <template v-if="admin"><div class="nav-label">管理员</div><nav><RouterLink to="/admin/images"><span>▦</span>全站图片</RouterLink><RouterLink to="/admin/users"><span>♙</span>用户管理</RouterLink><RouterLink to="/admin/invites"><span>✉</span>邮箱邀请</RouterLink><RouterLink to="/admin/telegram"><span>↗</span>Telegram Bot</RouterLink><RouterLink to="/admin/mail"><span>⚙</span>邮件设置</RouterLink></nav></template>
   <div class="sidebar-note"><span class="status-dot"></span>本地存储 · 仅限邀请<p>图片外链公开，图库仅自己可见。管理员可管理全站图片。</p></div>
  </aside>
  <div class="workspace">
   <header class="topbar"><span>图片工作台 <span class="crumb">/ {{ title }}</span></span><div class="user-menu"><span class="avatar">{{ me.email[0].toUpperCase() }}</span><span class="user-email">{{ me.email }}</span><span v-if="admin" class="role-tag">管理员</span><button class="text-button" @click="logout">退出</button></div></header>
   <main class="content"><div class="page-heading"><div><span class="eyebrow">{{ path.startsWith('/admin')?'ADMINISTRATION':'YOUR IMAGE SPACE' }}</span><h1>{{ title }}<span class="title-dot" aria-hidden="true">.</span></h1><p class="muted">{{ descriptions[path] }}</p></div><span class="badge soft">{{ path==='/upload'?'PUBLIC LINKS · PRIVATE LIBRARY':'ohimg / 简单分享' }}</span></div>
   <p v-if="pageError" class="error-box">{{ pageError }} <button @click="refresh">重试</button></p>
   <template v-if="path==='/upload' || !labels[path]">
    <div class="stat-strip"><div><span>支持的格式</span><strong>JPG · PNG · GIF · WebP</strong></div><div><span>单张图片上限</span><strong>{{ formatBytes(maxBytes) }}</strong></div><div><span>本次上传完成</span><strong>{{ complete }} <small>/ {{ queue.length }} 张</small></strong></div></div>
    <section :class="['dropzone',{dragging}]" @dragover.prevent="dragging=true" @dragleave.prevent="dragging=false" @drop.prevent="onDrop"><span class="upload-icon">↑</span><h2>{{ dragging?'松开鼠标，开始上传':'把图片拖到这里' }}</h2><p>也可以粘贴截图，或从你的设备选择图片</p><button class="primary" @click="fileInput?.click()">＋ 选择图片</button><input ref="fileInput" type="file" hidden accept="image/jpeg,image/png,image/gif,image/webp" multiple @change="onPick"><small>每次最多 20 张 · 原图保存 · 上传后即可分享</small></section>
    <section class="panel queue-panel"><div class="section-heading"><h2>上传记录 <span class="count">{{ queue.length }}</span></h2><button class="text-button" :disabled="!complete" @click="clearDone">清空已完成记录</button></div><div v-if="!queue.length" class="empty small-empty"><span>▧</span><h3>从你的第一张图片开始</h3><p>上传结果和分享链接会出现在这里。</p></div><div v-for="item in queue" :key="item.id" class="upload-row"><img :src="item.preview" :alt="item.file.name"><div class="upload-detail"><strong>{{ item.file.name }}</strong><span>{{ formatBytes(item.file.size) }} · {{ item.status==='done'?'上传成功':item.status==='failed'?item.error:item.status==='waiting'?'等待上传':`正在上传 ${item.progress}%` }}</span><input v-if="item.links" :value="item.links.url" readonly aria-label="上传图片直链" @focus="($event.target as HTMLInputElement).select()"><progress v-if="item.status==='uploading'" :value="item.progress" max="100"></progress></div><div v-if="item.links" class="link-actions"><button @click="copy(item.links.url)">直链</button><button @click="copy(item.links.markdown)">Markdown</button><button @click="copy(item.links.html)">HTML</button><button @click="copy(item.links.bbcode)">BBCode</button></div><button v-if="item.status==='failed'" @click="retry(item)">重试</button></div></section>
    <div class="hint-grid"><div><span>01 / UPLOAD</span><h3>保留原图</h3><p>不压缩、不添加水印。让图片保持原本的样子。</p></div><div><span>02 / SHARE</span><h3>一键分享</h3><p>直链、Markdown、HTML 和 BBCode，按需复制。</p></div><div><span>03 / ORGANIZE</span><h3>随时管理</h3><p>在图库中预览、搜索和删除自己的图片。</p></div></div>
   </template>
   <template v-if="path==='/images'||path==='/admin/images'">
    <div class="library-toolbar"><span><strong>{{ total }}</strong> 张图片</span><form @submit.prevent="find" class="search"><input v-model="search" placeholder="搜索图片文件名" aria-label="搜索图片文件名"><button type="submit">搜索</button></form><button @click="refresh">刷新</button></div>
    <div v-if="path==='/admin/images'&&cleanup.length" class="error-box">{{ cleanup.length }} 个已删除文件尚未清理。<button :disabled="busy" @click="retryCleanup">重试清理</button></div>
    <div v-if="loading" class="empty">正在载入图库…</div><div v-else-if="!photos.length&&!pageError" class="panel empty"><span>▧</span><h3>{{ search?'没有匹配的图片':'这里还没有图片' }}</h3><p>{{ search?'试试其他文件名。':'上传后，你的图片会在这里等你。' }}</p><RouterLink to="/upload" class="primary">上传图片 →</RouterLink></div>
    <div v-else class="photo-grid"><article v-for="photo in photos" :key="photo.id" class="photo-card"><div v-if="photo.mime==='video/mp4'" class="photo-preview"><video :src="photo.links.url" controls preload="metadata"></video></div><a v-else class="photo-preview" :href="photo.links.url" target="_blank" rel="noreferrer"><img :src="photo.links.url" :alt="photo.name" loading="lazy"></a><div class="photo-info"><strong :title="photo.name">{{ photo.name }}</strong><span>{{ formatBytes(photo.size) }} · {{ date(photo.created_at) }}</span><span v-if="path==='/admin/images'" class="owner">{{ photo.owner }}</span><input :value="photo.links.url" readonly aria-label="图片直链" @focus="($event.target as HTMLInputElement).select()"><div class="link-actions"><button @click="copy(photo.links.url)">直链</button><button @click="copy(photo.links.markdown)">MD</button><button @click="copy(photo.links.html)">HTML</button><button @click="copy(photo.links.bbcode)">BBCode</button><button class="danger-text" @click="deletion=photo">删除</button></div></div></article></div>
    <div v-if="total>30" class="pagination"><button :disabled="page<=1||loading" @click="nextPage(-1)">上一页</button><span>{{ page }} / {{ Math.ceil(total/30) }}</span><button :disabled="page>=Math.ceil(total/30)||loading" @click="nextPage(1)">下一页</button></div>
   </template>
   <section v-if="path==='/account'" class="panel settings-panel"><h2>修改登录密码</h2><p class="muted">修改后需要重新登录，其他设备上的会话也会退出。</p><form class="form" @submit.prevent="changePassword"><label>当前密码<input v-model="credentials.currentPassword" type="password" autocomplete="current-password" required></label><label>新密码<input v-model="credentials.password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required placeholder="至少 12 个字符"></label><label>确认新密码<input v-model="credentials.confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><button class="primary" :disabled="busy">更新密码</button></form></section>
   <template v-if="path==='/admin/users'&&admin"><div class="panel table-panel"><div class="section-heading"><h2>已加入的用户</h2><button @click="refresh">刷新</button></div><div class="table-scroll"><table><thead><tr><th>邮箱</th><th>角色</th><th>状态</th><th>加入时间</th><th>操作</th></tr></thead><tbody><tr v-for="u in users" :key="u.id"><td>{{ u.email }}</td><td>{{ u.role==='admin'?'管理员':'普通用户' }}</td><td><span :class="['badge',!u.active?'failed':'']">{{ u.active?'正常':'已停用' }}</span></td><td>{{ date(u.created_at) }}</td><td><button v-if="u.role!=='admin'" @click="toggleUser=u">{{ u.active?'停用':'启用' }}</button><span v-else class="muted">初始化管理员</span></td></tr></tbody></table></div></div></template>
   <template v-if="path==='/admin/invites'&&admin"><section class="panel invite-compose"><div><h2>邀请一位新伙伴</h2><p class="muted">链接 7 天有效，仅能使用一次。受邀者会成为普通用户。</p></div><form @submit.prevent="invite"><input v-model="inviteTo" type="email" required placeholder="输入对方的邮箱" aria-label="被邀请人邮箱"><button class="primary" :disabled="busy">发送邀请 →</button></form></section><div class="panel table-panel"><div class="section-heading"><h2>最近 200 条邀请</h2><button @click="refresh">刷新</button></div><div v-if="!invites.length" class="empty small-empty">还没有邀请记录。</div><div v-else class="table-scroll"><table><thead><tr><th>受邀邮箱</th><th>状态</th><th>有效期至</th><th>操作</th></tr></thead><tbody><tr v-for="i in invites" :key="i.id"><td>{{ i.email }}</td><td><span :class="['badge',i.status==='failed'?'failed':'']">{{ inviteStatus[i.status] }}</span></td><td>{{ date(i.expires_at) }}</td><td><div v-if="i.status!=='accepted'" class="link-actions"><button :disabled="busy" @click="resend(i.id)">重新发送</button><button v-if="i.status!=='revoked'" :disabled="busy" @click="revoke=i">撤销</button></div><span v-else class="muted">账号已创建</span></td></tr></tbody></table></div><p class="table-note">“已发出”表示 SMTP 已接受邮件，不代表对方已收到或阅读。重新发送会使旧邀请链接失效。</p></div></template>
   <section v-if="path==='/admin/mail'&&admin" class="panel settings-panel"><h2>SMTP 发信设置</h2><p class="muted">用于邮箱邀请、密码重置和管理员测试邮件。保存配置不会自动发信。</p><p v-if="loading" class="muted">正在载入邮件配置…</p><form v-if="smtpLoaded&&!loading" class="form" @submit.prevent="saveSMTP"><label>SMTP 主机<input v-model="smtp.host" required placeholder="smtp.example.com"></label><div class="form-columns"><label>端口<input v-model.number="smtp.port" type="number" min="1" max="65535" required></label><label>加密方式<select v-model="smtp.mode"><option value="starttls">STARTTLS（通常为 587）</option><option value="tls">TLS（通常为 465）</option></select></label></div><label>发件邮箱<input v-model="smtp.from" required type="email" placeholder="images@example.com"></label><label>SMTP 用户名<input v-model="smtp.username" autocomplete="off" placeholder="通常是完整邮箱地址"></label><label>SMTP 密码 / 授权码<input v-model="smtp.password" type="password" autocomplete="new-password" :placeholder="smtp.hasPassword?'已有密码，留空则保持不变':'填写邮箱授权码或 SMTP 密码'"></label><div class="form-buttons"><button class="primary" :disabled="busy">保存配置</button><button type="button" :disabled="busy" @click="testSMTP">向管理员发送测试邮件</button></div></form></section>
   <section v-if="path==='/admin/telegram'&&admin" class="panel settings-panel">
    <h2>Telegram Bot</h2>
    <p class="muted">只接收指定管理员的私聊图片和 MP4 视频，保存到管理员图库并回复外链。单文件最多 20 MB。</p>
    <p v-if="loading" class="muted">正在载入配置…</p>
    <form v-if="telegramLoaded&&!loading" class="form" @submit.prevent="saveTelegram">
     <label>Bot Token<input v-model="telegram.token" type="password" autocomplete="new-password" :placeholder="telegram.hasToken?'已保存，留空保持不变':'填写 BotFather 提供的 Token'"></label>
     <label>管理员 Telegram ID<input v-model="telegram.adminTelegramId" inputmode="numeric" placeholder="你的 Telegram 数字用户 ID，不是用户名"></label>
     <p class="muted">不知道 ID：先填写 Token 并开启接收，向 Bot 私聊发送 /id，再将返回的数字填入这里保存。ID 留空时不接收文件。</p>
     <label>接收上传<select v-model="telegram.enabled" aria-label="接收上传"><option :value="false">关闭</option><option :value="true">开启</option></select></label>
     <p class="muted">状态：{{ telegram.status }}<br>保存后点击刷新查看连接状态。以“文件”发送图片可保留原文件；以“照片”发送时保存的是 Telegram 处理后的图片。</p>
     <div class="form-buttons"><button class="primary" :disabled="busy">保存 Telegram 配置</button><button type="button" :disabled="busy" @click="refresh">刷新状态</button></div>
    </form>
   </section>
   <footer>ohimg <span>少一点复杂，多一点分享。</span></footer></main>
  </div>
 </div>
 <div v-if="deletion||revoke||toggleUser" class="modal-backdrop" @click.self="!busy&&(deletion=null,revoke=null,toggleUser=null)"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">{{ deletion?'删除这张图片？':revoke?'撤销这份邀请？':toggleUser?.active?'停用这个账号？':'启用这个账号？' }}</h2><p>{{ deletion?`「${deletion.name}」删除后外链将立即失效，无法在界面中恢复。`:revoke?`发给 ${revoke.email} 的链接将立即失效。`:toggleUser?.active?'该用户会退出所有登录会话，已有图片外链保持可用。':'该用户将可以重新登录。' }}</p><div class="form-buttons"><button :disabled="busy" @click="deletion=null;revoke=null;toggleUser=null">取消</button><button class="primary" :disabled="busy" @click="deletion?deletePhoto():revoke?revokeInvite():toggle()">{{ busy?'正在处理…':'确认' }}</button></div></section></div>
</template>
