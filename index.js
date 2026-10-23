import { setExtensionPrompt, extension_prompt_types, eventSource, event_types } from '../../../script.js';
import { getContext } from '../../../extensions.js';
import { KEY, CATEGORIES, DEFAULTS, uid, clone, norm, fingerprint, eligible, hidden, ensureIds, source, emptyMemory, normalizeMemory, activeRecords, validateExtraction, mergeRecord, branchCheck, formatContext, selectContext } from './core.js';
import { extract } from './api.js';

const ctx=()=>{ try{return getContext?.()||globalThis.SillyTavern?.getContext?.()||{};}catch{return {};} };
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let panel=null, activeTab='memories', busy=false, autoCounter=0, lastScope='', search='', currentRange={start:'',end:''}, aborter=null;
const scope=()=>{const c=ctx();return `${c.groupId||'solo'}:${c.characterId??''}:${c.getCurrentChatId?.()??c.chatId??''}`;};
function chat(){return ctx().chat||[];}
function mem(){const c=ctx();if(!c.chatMetadata)c.chatMetadata={};c.chatMetadata[KEY]=normalizeMemory(c.chatMetadata[KEY]);return c.chatMetadata[KEY];}
async function persist(){const c=ctx();if(typeof c.saveMetadata==='function') await c.saveMetadata();render();updateContext();}
function toast(msg){let t=$('#mb-toast');if(!t){t=document.createElement('div');t.id='mb-toast';document.body.append(t);}t.textContent=msg;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,4500);}
function ensurePanel(){
 if($('#mb-panel')){panel=$('#mb-panel');return;}
 panel=document.createElement('section');panel.id='mb-panel';panel.hidden=true;panel.innerHTML=`
 <header class="mb-head"><div><div class="mb-kicker">STORY ARCHIVE</div><h2>📖 Memory Diary</h2><div class="mb-sub">Дневник памяти твоего РП</div></div><button data-action="close" class="mb-icon" title="Закрыть">×</button></header>
 <div class="mb-toolbar"><button data-action="save-range" class="mb-primary">✦ Сохранить диапазон</button><button data-action="save-new">Найти новое</button><button data-action="new-manual">+ Своя запись</button><button data-action="refresh">Обновить контекст</button></div>
 <nav class="mb-tabs"><button data-tab="memories">Воспоминания</button><button data-tab="history">История</button><button data-tab="settings">Настройки</button></nav>
 <div id="mb-body"></div><footer class="mb-footer"><span id="mb-count"></span><span>Память хранится отдельно для каждого чата</span></footer>`;
 document.body.append(panel);
 panel.addEventListener('click',onClick);
 panel.addEventListener('change',onChange);
}
function open(){ensurePanel();panel.hidden=false;render();}
function close(){if(panel)panel.hidden=true;}
function render(){
 if(!panel||panel.hidden)return;
 const m=mem(), body=$('#mb-body',panel); 
 panel.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===activeTab)));
 $('#mb-count',panel).textContent=`${activeRecords(m,chat()).length} активных · ${m.records.filter(r=>!r.deleted).length} всего`;
 if(activeTab==='settings'){body.innerHTML=settingsHtml(m);return;}
 if(activeTab==='history'){body.innerHTML=historyHtml(m);return;}
 const {invalid}=branchCheck(m,chat());
 const records=activeRecords(m,chat()).filter(r=>!search||norm(`${r.title} ${r.content} ${CATEGORIES[r.category]}`).includes(norm(search)));
 body.innerHTML=`<div class="mb-info">Скрытие сообщения не удаляет уже сохранённую память. Источники проверяются по ID и отпечатку текста. ${invalid.length?`<strong>Найдены устаревшие записи: ${invalid.length}.</strong>`:''}</div>
 <input class="mb-search" id="mb-search" placeholder="Поиск по воспоминаниям…" value="${esc(search)}">
 <div class="mb-range"><div class="mb-grid"><label>С № сообщения<input id="mb-start" type="number" min="0" placeholder="0" value="${esc(currentRange.start)}"></label><label>По № сообщения<input id="mb-end" type="number" min="0" placeholder="${Math.max(0,chat().length-1)}" value="${esc(currentRange.end)}"></label></div><p class="mb-muted">Нумерация как в Таверне: первое сообщение — №0. Ручной диапазон включает скрытые сообщения.</p></div>
 ${invalid.length?`<div class="mb-card mb-warn"><h3>⚠️ Записи с устаревшими источниками</h3><p>Они не попадут в контекст автоматически. Проверь их и при необходимости сохрани как ручные, либо удали.</p><button data-action="mark-stale-manual">Сделать устаревшие ручными</button><button data-action="delete-stale" class="mb-danger">Удалить устаревшие</button></div>`:''}
 ${records.length?records.slice().reverse().map(recordHtml).join(''):`<div class="mb-empty"><span>🌙</span><strong>Пока нет воспоминаний</strong><p>Выбери диапазон сообщений или включи автоматическое сохранение в настройках.</p></div>`}`;
}
function recordHtml(r){
 const sourceText=r.manual?'Ручная запись':`${(r.sources||[]).length} исходн. сообщ.`;
 return `<article class="mb-card" data-id="${esc(r.id)}"><div class="mb-tags"><span class="mb-tag">${esc(CATEGORIES[r.category]||'Воспоминание')}</span><span class="mb-tag">Важность ${r.importance||3}/5</span>${r.pinned?'<span class="mb-tag">📌 Закреплено</span>':''}${r.manual?'<span class="mb-tag">✍️ Защищено</span>':''}</div><h3>${esc(r.title)}</h3><p>${esc(r.content)}</p><div class="mb-date">${esc(sourceText)}</div><div class="mb-row"><button data-action="edit" data-id="${esc(r.id)}">Править</button><button data-action="pin" data-id="${esc(r.id)}">${r.pinned?'Открепить':'Закрепить'}</button><button data-action="manualize" data-id="${esc(r.id)}">${r.manual?'Ручная ✓':'Защитить'}</button><button data-action="toggle" data-id="${esc(r.id)}">${r.enabled===false?'Включить':'Отключить'}</button><button data-action="delete" data-id="${esc(r.id)}" class="mb-danger">Удалить</button></div></article>`;
}
function historyHtml(m){
 const batches=(m.batches||[]).slice().reverse();
 return `<div class="mb-info">Здесь сохраняется журнал операций. Сам журнал не является источником правды: статус источников сверяется с текущей историей чата.</div>${batches.length?batches.map(b=>`<article class="mb-card"><h3>${esc(b.title||'Сохранение диапазона')}</h3><p>${esc(b.summary||'')}</p><div class="mb-date">${new Date(b.at).toLocaleString()} · сообщения ${b.start}–${b.end} · добавлено ${b.added}</div></article>`).join(''):'<div class="mb-empty">Операций пока нет.</div>'}`;
}
function settingsHtml(m){
 const s=m.settings;
 return `<div class="mb-card"><h3>Автоматическое сохранение</h3><label class="mb-check"><input type="checkbox" id="mb-auto" ${s.autoSave?'checked':''}> Автоматически архивировать новые сообщения</label><label>Проверять каждые N новых сообщений<input type="number" id="mb-every" min="2" max="50" value="${s.autoEvery}"></label><label>Максимум сообщений за одну операцию<input type="number" id="mb-max" min="2" max="30" value="${s.maxAutoMessages}"></label><p class="mb-muted">Автоархив обрабатывает только новые видимые сообщения. Скрытые старые сообщения можно сохранить вручную через диапазон.</p></div>
 <div class="mb-card"><h3>Контекст модели</h3><label class="mb-check"><input type="checkbox" id="mb-context" ${s.contextEnabled?'checked':''}> Добавлять выбранные воспоминания в контекст РП</label><label>Глубина контекста (слои)<input type="number" id="mb-depth" min="0" max="4" value="${s.contextDepth}"></label><label>Максимум записей за ответ<input type="number" id="mb-limit" min="1" max="30" value="${s.contextLimit}"></label><label class="mb-check"><input type="checkbox" id="mb-recall" ${s.autoRecall?'checked':''}> Автоматически подбирать релевантные воспоминания</label></div>
 <div class="mb-card"><h3>Инструкции архивариусу</h3><textarea id="mb-prompt" placeholder="Дополнительные правила извлечения…">${esc(s.customPrompt||'')}</textarea><div class="mb-row"><button data-action="save-settings" class="mb-primary">Сохранить настройки</button><button data-action="export">Экспорт памяти</button><button data-action="import">Импорт памяти</button><button data-action="reset">Сбросить настройки</button></div></div>`;
}
function onChange(e){
 if(e.target.id==='mb-search'){search=e.target.value;const pos=e.target.selectionStart;render();const el=$('#mb-search');el?.focus();el?.setSelectionRange(pos,pos);}
 if(e.target.id==='mb-start')currentRange.start=e.target.value;
 if(e.target.id==='mb-end')currentRange.end=e.target.value;
}
async function onClick(e){
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.tab){activeTab=b.dataset.tab;render();return;}
 const action=b.dataset.action,id=b.dataset.id,m=mem();
 try{
  if(action==='close'){close();return;}
  if(action==='save-range'){await saveRange();return;}
  if(action==='save-new'){await saveNew();return;}
  if(action==='refresh'){updateContext();toast('Контекст Дневника памяти обновлён.');return;}
  if(action==='new-manual'){openWithManual();return;}
  if(action==='save-settings'){saveSettingsFromUI();await persist();toast('Настройки сохранены.');return;}
  if(action==='edit'){editRecord(id);return;}
  if(action==='pin'){const r=m.records.find(x=>x.id===id);if(r)r.pinned=!r.pinned;await persist();return;}
  if(action==='manualize'){const r=m.records.find(x=>x.id===id);if(r){r.manual=true;r.sources=[];r.updatedAt=Date.now();}await persist();return;}
  if(action==='toggle'){const r=m.records.find(x=>x.id===id);if(r)r.enabled=r.enabled===false;await persist();return;}
  if(action==='delete'){if(!confirm('Удалить это воспоминание? Это не удалит исходные сообщения.'))return;m.records=m.records.filter(x=>x.id!==id);await persist();return;}
  if(action==='mark-stale-manual'){for(const r of branchCheck(m,chat()).invalid){r.manual=true;r.sources=[];}await persist();toast('Устаревшие записи защищены как ручные.');return;}
  if(action==='delete-stale'){if(!confirm('Удалить все записи с недействительными источниками?'))return;const stale=new Set(branchCheck(m,chat()).invalid.map(r=>r.id));m.records=m.records.filter(r=>!stale.has(r.id));await persist();return;}
  if(action==='export'){exportData();return;}
  if(action==='import'){importData();return;}
  if(action==='reset'){m.settings={...clone(DEFAULTS)};await persist();return;}
 }catch(err){toast(`Ошибка: ${err.message||err}`);}
}
function saveSettingsFromUI(){
 const s=mem().settings;
 s.autoSave=$('#mb-auto').checked;s.autoEvery=clampNum($('#mb-every').value,2,50,8);
 s.maxAutoMessages=clampNum($('#mb-max').value,2,30,12);
 s.contextEnabled=$('#mb-context').checked;s.contextDepth=clampNum($('#mb-depth').value,0,4,2);
 s.contextLimit=clampNum($('#mb-limit').value,1,30,12);s.autoRecall=$('#mb-recall').checked;
 s.customPrompt=$('#mb-prompt').value.trim();
}
function clampNum(v,min,max,def){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):def;}
function editRecord(id){
 const r=mem().records.find(x=>x.id===id);if(!r)return;
 const title=prompt('Заголовок воспоминания',r.title);if(title===null)return;
 const content=prompt('Содержание воспоминания',r.content);if(content===null)return;
 const cat=prompt('Категория: '+Object.keys(CATEGORIES).join(', '),r.category);if(cat===null)return;
 r.title=title.trim()||r.title;r.content=content.trim()||r.content;r.category=Object.hasOwn(CATEGORIES,cat.trim())?cat.trim():r.category;
 r.manual=true;r.sources=[];r.updatedAt=Date.now();persist().catch(e=>toast(e.message));
}
function snapshot(m,i){return {...source(m,i),text:m.mes,name:m.name||'',is_user:!!m.is_user,is_hidden:hidden(m)};}
function captureChat(){const c=chat();if(ensureIds(c)){try{ctx().saveChat?.();}catch{}}return c;}
async function saveRange(startOverride,endOverride,automatic=false){
 if(busy)return toast('Подожди, предыдущая операция ещё выполняется.');
 const c=ctx(), list=captureChat();if(!list.length)return toast('В этом чате пока нет сообщений.');
 let start,end;
 if(automatic){end=list.length-1;start=Math.max(0,end-mem().settings.maxAutoMessages+1);while(start<=end&&(!eligible(list[start])||hidden(list[start])))start++;}
 else {start=Number(startOverride??$('#mb-start')?.value);end=Number(endOverride??$('#mb-end')?.value);if(!Number.isInteger(start)||!Number.isInteger(end)){toast('Укажи номера начала и конца диапазона.');return;} }
 if(start<0||end<start||end>=list.length){toast(`Диапазон неверен. В чате ${list.length} сообщений, нумерация начинается с 0.`);return;}
 let selected=list.slice(start,end+1).map((m,i)=>({...m,_mbIndex:start+i}));
 if(automatic)selected=selected.filter(m=>eligible(m)&&!hidden(m));
 else selected=selected.filter(m=>eligible(m)&&(!hidden(m)||mem().settings.includeHiddenManual));
 if(!selected.length){toast('В диапазоне нет подходящих сообщений.');return;}
 const scopeAt=scope(), snapshots=selected.map(m=>snapshot(m,m._mbIndex));
 busy=true;aborter=new AbortController();render();toast(`Архивирую ${selected.length} сообщений…`);
 try{
   const raw=await extract(selected.map(m=>({name:m.name,is_user:m.is_user,mes:m.mes,is_hidden:hidden(m)})),mem().settings,c,aborter.signal);
   if(scope()!==scopeAt)throw Error('Чат переключился во время анализа; результат не применён.');
   const now=chat();
   for(const s of snapshots){const current=now.find(m=>m.extra?.memoryBookId===s.id);if(!current||fingerprint(current)!==s.hash)throw Error('История изменилась во время анализа. Ничего не сохранено — запусти операцию заново.');}
   const parsed=validateExtraction(raw,selected.map(m=>({name:m.name,is_user:m.is_user,mes:m.mes,extra:{memoryBookId:m.extra?.memoryBookId,memoryBookIndex:m._mbIndex}})));
   const m=mem();let added=0,merged=0;
   for(const r of parsed.records){const result=mergeRecord(m,r);result.merged?merged++:added++;}
   m.batches.push({id:uid(),at:Date.now(),title:automatic?'Автоматическое сохранение':'Сохранение диапазона',start,end,added:added+merged,summary:parsed.summary});
   m.batches=m.batches.slice(-100);m.revision=(m.revision||0)+1;
   await persist();toast(`Готово: ${added} новых, ${merged} объединено.`);
 }catch(err){if(err.name!=='AbortError')toast(`Не удалось сохранить: ${err.message||err}`);}
 finally{busy=false;aborter=null;render();}
}
async function saveNew(){const c=captureChat(),m=mem(),map=new Set((m.batches||[]).filter(b=>!b.automatic).map(b=>`${b.start}:${b.end}`));const end=c.length-1;let start=0;const valid=activeRecords(m,c);const maxSource=Math.max(-1,...valid.flatMap(r=>(r.sources||[]).map(s=>s.index)));start=Math.max(0,maxSource+1);if(start>end){toast('Новых сообщений для архива нет.');return;}currentRange={start:String(start),end:String(end)};render();await saveRange(start,end,false);}
function editNewRecord(){
 const title=prompt('Заголовок нового воспоминания');if(title===null||!title.trim())return;
 const content=prompt('Что нужно запомнить?');if(content===null||!content.trim())return;
 const category=prompt('Категория: '+Object.keys(CATEGORIES).join(', '),'event')||'event';
 const m=mem();m.records.push({id:uid(),title:title.trim(),content:content.trim(),category:Object.hasOwn(CATEGORIES,category)?category:'other',importance:4,pinned:true,enabled:true,manual:true,sources:[],createdAt:Date.now(),updatedAt:Date.now()});persist().catch(e=>toast(e.message));
}
function exportData(){const blob=new Blob([JSON.stringify(mem(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`memory-diary-${Date.now()}.json`;a.click();URL.revokeObjectURL(url);}
function importData(){const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());if(!Array.isArray(data.records))throw Error('В файле нет списка records.');if(!confirm(`Импортировать ${data.records.length} записей? Они добавятся к текущей книге.`))return;const m=mem();for(const r of data.records){m.records.push({...r,id:uid(),manual:true,sources:[],createdAt:Date.now(),updatedAt:Date.now()});}await persist();toast('Импорт завершён. Записи импортированы как ручные.');}catch(e){toast(`Импорт не выполнен: ${e.message}`);}};input.click();}
function updateContext(){
 const m=mem(),s=m.settings;if(!s.contextEnabled){setExtensionPrompt('memory_book_context','',{position:extension_prompt_types.IN_CHAT,depth:0});return;}
 const records=activeRecords(m,chat());const selected=s.autoRecall?selectContext(m,chat(),s.contextLimit):records.filter(r=>r.pinned).slice(0,s.contextLimit);
 setExtensionPrompt('memory_book_context',formatContext(selected),{position:extension_prompt_types.IN_CHAT,depth:s.contextDepth});
}
function setupFloating(){
 if($('#mb-fab'))return;
 const b=document.createElement('button');b.id='mb-fab';b.textContent='📚';b.title='Открыть Дневник памяти';b.onclick=open;document.body.append(b);
}
function installEvents(){
 const ev=event_types||{};
 for(const name of ['CHAT_CHANGED','MESSAGE_RECEIVED','MESSAGE_SENT','GENERATION_ENDED','GENERATION_STARTED']){
   const type=ev[name]||name;
   try{eventSource.on(type,()=>{if(scope()!==lastScope){lastScope=scope();autoCounter=0;}updateContext();if(name==='MESSAGE_RECEIVED'||name==='MESSAGE_SENT'){autoCounter++;const s=mem().settings;if(s.autoSave&&autoCounter>=s.autoEvery){autoCounter=0;saveRange(undefined,undefined,true);}}});}catch{}
 }
}
function init(){
 setupFloating();ensurePanel();installEvents();lastScope=scope();
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel&&!panel.hidden)close();});
 updateContext();
}
function openWithManual(){open();const title=prompt('Заголовок нового воспоминания');if(title===null||!title.trim())return;const content=prompt('Что нужно запомнить?');if(content===null||!content.trim())return;const category=prompt('Категория: '+Object.keys(CATEGORIES).join(', '),'event')||'event';const m=mem();m.records.push({id:uid(),title:title.trim(),content:content.trim(),category:Object.hasOwn(CATEGORIES,category)?category:'other',importance:4,pinned:true,enabled:true,manual:true,sources:[],createdAt:Date.now(),updatedAt:Date.now()});persist().catch(e=>toast(e.message));}
init();
