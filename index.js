import { setExtensionPrompt, extension_prompt_types, eventSource, event_types } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { KEY, CATEGORIES, DEFAULTS, uid, clone, norm, fingerprint, eligible, hidden, ensureIds, source, emptyMemory, normalizeMemory, activeRecords, validateExtraction, mergeRecord, branchCheck, formatContext, selectContext } from './core.js';
import { extract } from './api.js';

const ctx=()=>{ try{return getContext?.()||globalThis.SillyTavern?.getContext?.()||{};}catch{return {};} };
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let panel=null, activeTab='memories', busy=false, autoCounter=0, lastScope='', search='', filter='all', currentRange={start:'',end:''}, rangeOpen=false, aborter=null;
let memoryCache=null, memoryCacheScope='', databasePromise=null;
const scope=()=>{const c=ctx();return `${c.groupId||'solo'}:${c.characterId??''}:${c.getCurrentChatId?.()??c.chatId??''}`;};
function chat(){return ctx().chat||[];}
function openDatabase(){
 if(databasePromise)return databasePromise;
 databasePromise=new Promise((resolve,reject)=>{
  const request=indexedDB.open('sillytavern-memorybook',1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('books'))db.createObjectStore('books',{keyPath:'key'});};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||new Error('Не удалось открыть локальную базу MemoryBook.'));
 });
 return databasePromise;
}
async function databaseGet(key){const db=await openDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction('books','readonly');const req=tx.objectStore('books').get(key);req.onsuccess=()=>resolve(req.result?.data??null);req.onerror=()=>reject(req.error);});}
async function databasePut(key,data){const db=await openDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction('books','readwrite');tx.objectStore('books').put({key,data,updatedAt:Date.now()});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Сохранение отменено.'));});}
function mem(){if(memoryCacheScope!==scope()||!memoryCache){memoryCacheScope=scope();memoryCache=emptyMemory();}return memoryCache;}
async function loadMemory(){
 const key=scope();memoryCacheScope=key;
 try{
  let stored=await databaseGet(key);
  if(!stored){const c=ctx();const legacy=normalizeMemory(c.chatMetadata?.[KEY]);stored=legacy;await databasePut(key,legacy);if(c.chatMetadata?.[KEY]){delete c.chatMetadata[KEY];await c.saveMetadata?.();}}
  if(scope()!==key)return;
  memoryCache=normalizeMemory(stored);render();updateContext();
 }catch(error){
  console.error('[MemoryBook] Database load failed:',error);
  memoryCache=emptyMemory();memoryCacheScope=key;
  toast('Не удалось открыть базу памяти. Проверь настройки браузера и IndexedDB.');
 }
}
async function persist(){await databasePut(scope(),mem());render();updateContext();}
function toast(msg){let t=$('#mb-toast');if(!t){t=document.createElement('div');t.id='mb-toast';document.body.append(t);}t.textContent=msg;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,4500);}
function ensurePanel(){
 if($('#mb-panel')){panel=$('#mb-panel');return;}
 panel=document.createElement('section');panel.id='mb-panel';panel.hidden=true;panel.innerHTML=`
 <header class="mb-head"><div class="mb-hero-art" aria-hidden="true"><span class="mb-moon">☾</span><span class="mb-spark">✦</span><span class="mb-flower">❀</span><span class="mb-book">📖</span></div><div class="mb-head-copy"><div class="mb-kicker">✦ ЛИЧНЫЙ АРХИВ ✦</div><h2>MemoryBook</h2><div class="mb-sub">Память. Итоги. Твой персонаж.</div></div><button data-action="close" class="mb-icon" title="Закрыть">×</button></header>
 <nav class="mb-tabs"><button data-tab="summary">Сводка</button><button data-tab="characters">Персонажи</button><button data-tab="relationships">Отношения</button><button data-tab="timeline">Хронология</button><button data-tab="memories">Память</button><button data-tab="history">Журнал</button><button data-tab="settings">Настройки</button></nav>
 <div id="mb-body"></div><footer class="mb-footer"><span id="mb-count"></span><span>♡ Каждая деталь имеет значение</span></footer>`;
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
 if(activeTab==='settings'){body.innerHTML=`<div id="mb-settings">${settingsHtml(m)}</div>`;return;}
 if(activeTab==='summary'){body.innerHTML=summaryHtml(m);return;}
 if(activeTab==='characters'){body.innerHTML=charactersHtml(m);return;}
 if(activeTab==='relationships'){body.innerHTML=relationshipsHtml(m);return;}
 if(activeTab==='timeline'){body.innerHTML=timelineHtml(m);return;}
 if(activeTab==='history'){body.innerHTML=historyHtml(m);return;}
 const {invalid}=branchCheck(m,chat());
 const records=activeRecords(m,chat()).filter(r=>!search||norm(`${r.title} ${r.content} ${CATEGORIES[r.category]}`).includes(norm(search))).filter(r=>filter==='all'||(filter==='important'&&(r.importance||0)>=4)||(filter==='personal'&&['relationship','preference','secret','quote'].includes(r.category))||(filter==='user'&&(r.sources||[]).some(src=>chat()[src.index]?.is_user)));
 body.innerHTML=`<div class="mb-tools"><input class="mb-search" id="mb-search" placeholder="⌕ Поиск по памяти…" value="${esc(search)}"><div class="mb-filters"><button data-filter="all" class="${filter==='all'?'is-active':''}">Все</button><button data-filter="important" class="${filter==='important'?'is-active':''}">⭐ Важное</button><button data-filter="personal" class="${filter==='personal'?'is-active':''}">♡ Личное</button><button data-filter="user" class="${filter==='user'?'is-active':''}">♙ Пользователь</button></div><div class="mb-range-toolbar"><button data-action="open-range">Обработать диапазон</button><button data-action="save-new">Найти новое</button><button data-action="new-manual" class="mb-primary">＋ Заметка</button></div>${rangeOpen?'<section class="mb-range-box"><div class="mb-range-heading"><strong>Выбери сообщения для архива</strong><span>Всего: '+chat().length+'</span></div><div class="mb-range-fields"><label>С сообщения<input id="mb-start" type="number" inputmode="numeric" min="0" max="'+Math.max(0,chat().length-1)+'" value="'+esc(currentRange.start)+'"></label><label>По сообщение<input id="mb-end" type="number" inputmode="numeric" min="0" max="'+Math.max(0,chat().length-1)+'" value="'+esc(currentRange.end)+'"></label></div><div class="mb-range-actions"><button data-action="save-range" class="mb-primary">Начать обработку</button><button data-action="close-range">Скрыть</button></div><p class="mb-muted">Начало автоматически выставляется после последней успешной обработки. Конец — последнее сообщение чата. Нумерация с 0.</p></section>':''}</div>
 ${busy?`<div class="mb-processing"><span class="mb-spinner"></span><div><strong>Идёт обработка сообщений…</strong><small>Не закрывай MemoryBook. Результат появится здесь.</small></div><button data-action="cancel-processing">Отмена</button></div>`:'' }${invalid.length?`<div class="mb-info mb-warn">⚠️ Найдены устаревшие записи: ${invalid.length}. Проверь источники перед использованием в контексте.</div>`:''}
 ${invalid.length?`<div class="mb-card mb-warn"><h3>⚠️ Записи с устаревшими источниками</h3><p>Они не попадут в контекст автоматически. Проверь их и при необходимости сохрани как ручные, либо удали.</p><button data-action="mark-stale-manual">Сделать устаревшие ручными</button><button data-action="delete-stale" class="mb-danger">Удалить устаревшие</button></div>`:''}
 ${records.length?records.slice().reverse().map(recordHtml).join(''):`<div class="mb-empty"><span>🌙</span><strong>Пока нет воспоминаний</strong><p>Выбери диапазон сообщений или включи автоматическое сохранение в настройках.</p></div>`}`;
}
function recordHtml(r){
 const sourceText=r.manual?'Ручная запись':`${(r.sources||[]).length} исходн. сообщ.`;
 const icon=({fact:'♡',event:'✦',relationship:'♥',preference:'♧',goal:'⚑',other:'✧'})[r.category]||'✧';
 return `<article class="mb-card" data-id="${esc(r.id)}"><div class="mb-record-icon" aria-hidden="true">${icon}</div><div class="mb-record-main"><div class="mb-tags"><span class="mb-tag">${esc(CATEGORIES[r.category]||'Воспоминание')}</span><span class="mb-tag">Важность ${r.importance||3}/5</span>${r.pinned?'<span class="mb-tag">📌 Закреплено</span>':''}${r.manual?'<span class="mb-tag">✍️ Защищено</span>':''}</div><h3>${esc(r.title)}</h3><p>${esc(r.content)}</p><div class="mb-date">${esc(sourceText)}</div><div class="mb-row"><button data-action="edit" data-id="${esc(r.id)}">Править</button><button data-action="pin" data-id="${esc(r.id)}">${r.pinned?'Открепить':'Закрепить'}</button><button data-action="manualize" data-id="${esc(r.id)}">${r.manual?'Ручная ✓':'Защитить'}</button><button data-action="toggle" data-id="${esc(r.id)}">${r.enabled===false?'Включить':'Отключить'}</button><button data-action="delete" data-id="${esc(r.id)}" class="mb-danger">🗑 Удалить</button></div></div></article>`;
}
function summaryHtml(m){
 const records=activeRecords(m,chat());const important=records.filter(r=>(r.importance||0)>=4);const personal=records.filter(r=>['relationship','preference','secret','quote'].includes(r.category));const plans=records.filter(r=>/план|хочет|мечта|цель|собирается|намерен/i.test(`${r.title} ${r.content}`));const latest=records.slice().sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0))[0];const name=ctx().name2||ctx().characterName||'Твой персонаж';
 return `<section class="mb-summary-hero"><label class="mb-avatar-picker" title="Выбрать изображение"><input id="mb-profile-image" type="file" accept="image/*"><span class="mb-avatar">${m.profileImage?`<img src="${esc(m.profileImage)}" alt="Аватар персонажа">`:esc((name.trim()[0]||'♡').toUpperCase())}</span><small>Изменить фото</small></label><div class="mb-summary-identity"><span class="mb-kicker">ТВОЙ ПЕРСОНАЖ</span><h3>${esc(name)}</h3><p>Всё важное — в одном месте ♡</p><button data-action="remove-avatar" class="mb-remove-avatar" ${m.profileImage?'':'hidden'}>Убрать фото</button></div><button data-action="refresh" class="mb-refresh">⟳</button></section><div class="mb-stats"><div><strong>${records.length}</strong><span>заметок</span></div><div><strong>${m.characters.length}</strong><span>персонажей</span></div><div><strong>${m.relationships.length}</strong><span>связей</span></div><div><strong>${m.timeline.length}</strong><span>событий</span></div></div><section class="mb-summary-card"><h3>✧ Ключевые моменты</h3>${records.slice().sort((a,b)=>(b.importance||0)-(a.importance||0)).slice(0,5).map(r=>`<p class="mb-keyline"><span>♥</span><span><b>${esc(r.title)}</b><br>${esc(r.content)}</span></p>`).join('')||'<p>Пока нет сохранённых моментов. Добавь заметку или обработай сообщения чата.</p>'}</section><section class="mb-summary-card"><h3>🕯 Последнее обновление</h3>${latest?`<blockquote>${esc(latest.content)}<small>— ${esc(name)} · ${new Date(latest.updatedAt||latest.createdAt||Date.now()).toLocaleDateString()}</small></blockquote>`:'<p>Здесь появится последнее сохранённое воспоминание.</p>'}</section><section class="mb-summary-card"><h3>🪄 Быстрые действия</h3><div class="mb-quick-grid"><button data-action="new-manual">＋<span>Добавить заметку</span></button><button data-action="generate-summary">▤<span>Сгенерировать сводку</span></button><button data-action="import-chat">⇩<span>Импорт из чата</span></button><button data-action="export">⇧<span>Экспорт</span></button><button data-action="clear-memory" class="mb-danger">♲<span>Очистить память</span></button></div></section>`;
}
function historyHtml(m){
 const batches=(m.batches||[]).slice().reverse();
 return `<div class="mb-info">Здесь сохраняется журнал операций. Сам журнал не является источником правды: статус источников сверяется с текущей историей чата.</div>${batches.length?batches.map(b=>`<article class="mb-card"><h3>${esc(b.title||'Сохранение диапазона')}</h3><p>${esc(b.summary||'')}</p><div class="mb-date">${new Date(b.at).toLocaleString()} · сообщения ${b.start}–${b.end} · добавлено ${b.added}</div></article>`).join(''):'<div class="mb-empty">Операций пока нет.</div>'}`;
}

function sectionHeader(title,description,actions=''){
 return \`<div class="mb-tools"><div><h3>\${esc(title)}</h3><p class="mb-muted">\${esc(description)}</p></div><div class="mb-range-toolbar">\${actions}</div></div>\`;
}
function charactersHtml(m){
 const rows=m.characters.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'ru'));
 return sectionHeader('Персонажи','Отдельные профили {{user}}, {{char}} и NPC. Данные сохраняются только в книге этого чата.',\`<button data-action="add-character">＋ Добавить персонажа</button><button data-action="seed-main-characters">Добавить {{user}} и {{char}}</button>\`)
 + (rows.length?rows.map(c=>\`<article class="mb-card" data-id="\${esc(c.id)}"><div class="mb-tags"><span class="mb-tag">\${esc(({user:'Пользователь',char:'Главный персонаж',npc:'NPC'})[c.role]||'Персонаж')}</span></div><h3>\${esc(c.name)}</h3>\${c.appearance?\`<p><b>Внешность:</b> \${esc(c.appearance)}</p>\`:''}\${c.personality?\`<p><b>Характер:</b> \${esc(c.personality)}</p>\`:''}\${c.background?\`<p><b>История:</b> \${esc(c.background)}</p>\`:''}\${c.currentState?\`<p><b>Состояние:</b> \${esc(c.currentState)}</p>\`:''}\${c.notes?\`<p><b>Заметки:</b> \${esc(c.notes)}</p>\`:''}<div class="mb-row"><button data-action="edit-character" data-id="\${esc(c.id)}">Редактировать профиль</button><button data-action="delete-character" data-id="\${esc(c.id)}" class="mb-danger">Удалить</button></div></article>\`).join(''):'<div class="mb-empty"><strong>Пока нет персонажей</strong><p>Создай профили вручную или добавь {{user}} и {{char}}.</p></div>');
}
function relationshipsHtml(m){
 const names=new Map(m.characters.map(c=>[c.id,c.name]));
 return sectionHeader('Отношения','Каждая связь принадлежит конкретной паре. Изменения сохраняются в истории самой связи.',\`<button data-action="add-relationship">＋ Добавить связь</button>\`)
 + (m.relationships.length?m.relationships.map(r=>\`<article class="mb-card" data-id="\${esc(r.id)}"><h3>\${esc(names.get(r.fromId)||'Удалённый персонаж')} ↔ \${esc(names.get(r.toId)||'Удалённый персонаж')}</h3><p>\${esc(r.label||'Связь без названия')}</p><div class="mb-tags"><span class="mb-tag">Доверие \${Number(r.trust)||0}%</span><span class="mb-tag">Привязанность \${Number(r.affection)||0}%</span><span class="mb-tag">Напряжение \${Number(r.tension)||0}%</span><span class="mb-tag">Враждебность \${Number(r.hostility)||0}%</span></div>\${r.notes?\`<p>\${esc(r.notes)}</p>\`:''}<div class="mb-row"><button data-action="edit-relationship" data-id="\${esc(r.id)}">Изменить</button><button data-action="relationship-history" data-id="\${esc(r.id)}">История изменений (\${(r.history||[]).length})</button><button data-action="delete-relationship" data-id="\${esc(r.id)}" class="mb-danger">Удалить</button></div></article>\`).join(''):'<div class="mb-empty"><strong>Связей пока нет</strong><p>Сначала добавь персонажей, затем создай связь между двумя из них.</p></div>');
}
function timelineHtml(m){
 const people=new Map(m.characters.map(c=>[c.id,c.name]));
 const rows=m.timeline.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||(b.createdAt||0)-(a.createdAt||0));
 return sectionHeader('Хронология','События RP в порядке внутриигрового времени. Дата здесь задаётся вручную, а не берётся с телефона.',\`<button data-action="add-event">＋ Добавить событие</button>\`)
 + (rows.length?rows.map(ev=>\`<article class="mb-card" data-id="\${esc(ev.id)}"><div class="mb-date">\${esc(ev.date||'Дата не указана')}\${ev.place?' · '+esc(ev.place):''}</div><h3>\${esc(ev.title)}</h3><p>\${esc(ev.description)}</p>\${ev.participants?.length?\`<div class="mb-tags">\${ev.participants.map(id=>\`<span class="mb-tag">\${esc(people.get(id)||'Удалённый персонаж')}</span>\`).join('')}</div>\`:''}\${ev.consequences?\`<p><b>Последствия:</b> \${esc(ev.consequences)}</p>\`:''}<div class="mb-row"><button data-action="edit-event" data-id="\${esc(ev.id)}">Редактировать</button><button data-action="delete-event" data-id="\${esc(ev.id)}" class="mb-danger">Удалить</button></div></article>\`).join(''):'<div class="mb-empty"><strong>Хронология пока пуста</strong><p>Добавь важное событие вручную. Позже подключим автоматическое извлечение из сцен.</p></div>');
}
function promptField(label,current=''){return prompt(label,current??'');}
function editCharacter(id=null,role='npc'){
 const m=mem(),old=id?m.characters.find(x=>x.id===id):null;if(id&&!old)return;
 const name=promptField('Имя персонажа',old?.name|| (role==='user'?'{{user}}':role==='char'?(ctx().name2||ctx().characterName||'{{char}}'):''));if(name===null||!name.trim())return;
 const chosenRole=promptField('Роль: user, char или npc',old?.role||role)||role;
 const appearance=promptField('Внешность',old?.appearance||'');if(appearance===null)return;
 const personality=promptField('Характер',old?.personality||'');if(personality===null)return;
 const background=promptField('Биография / история',old?.background||'');if(background===null)return;
 const currentState=promptField('Текущее состояние',old?.currentState||'');if(currentState===null)return;
 const notes=promptField('Дополнительные факты и заметки',old?.notes||'');if(notes===null)return;
 const data={id:old?.id||uid(),name:name.trim(),role:['user','char','npc'].includes(chosenRole.trim())?chosenRole.trim():'npc',appearance,personality,background,currentState,notes,createdAt:old?.createdAt||Date.now(),updatedAt:Date.now()};
 if(old)Object.assign(old,data);else m.characters.push(data);
 persist().catch(e=>toast(e.message));
}
function addMainCharacters(){
 const m=mem();
 for(const [role,name] of [['user','{{user}}'],['char',ctx().name2||ctx().characterName||'{{char}}']]){
  if(!m.characters.some(c=>c.role===role))m.characters.push({id:uid(),name,role,appearance:'',personality:'',background:'',currentState:'',notes:'',createdAt:Date.now(),updatedAt:Date.now()});
 }
 persist().then(()=>toast('Профили {{user}} и {{char}} добавлены.')).catch(e=>toast(e.message));
}
function editRelationship(id=null){
 const m=mem(),old=id?m.relationships.find(x=>x.id===id):null;if(id&&!old)return;
 if(m.characters.length<2){toast('Для связи нужны хотя бы два профиля персонажей.');return;}
 const list=m.characters.map(c=>c.id+' — '+c.name).join('\\n');
 const from=prompt('ID первого персонажа. Список:\\n'+list,old?.fromId||m.characters[0].id);if(from===null)return;
 const to=prompt('ID второго персонажа. Список:\\n'+list,old?.toId||m.characters.find(c=>c.id!==from)?.id);if(to===null)return;
 if(from===to||!m.characters.some(c=>c.id===from)||!m.characters.some(c=>c.id===to)){toast('Выбери двух разных существующих персонажей.');return;}
 const label=promptField('Тип / описание отношений',old?.label||'');if(label===null)return;
 const metric=(key,title)=>{const n=Number(prompt(title+' (0–100)',String(old?.[key]??0)));return Number.isFinite(n)?Math.max(0,Math.min(100,n)):Number(old?.[key])||0;};
 const trust=metric('trust','Доверие'),affection=metric('affection','Привязанность'),tension=metric('tension','Напряжение'),hostility=metric('hostility','Враждебность');
 const notes=promptField('Примечания',old?.notes||'');if(notes===null)return;
 const data={id:old?.id||uid(),fromId:from,toId:to,label,trust,affection,tension,hostility,notes,history:old?.history||[],createdAt:old?.createdAt||Date.now(),updatedAt:Date.now()};
 if(old){const changed=['label','trust','affection','tension','hostility','notes'].some(k=>old[k]!==data[k]);if(changed)data.history.push({at:Date.now(),summary:'Обновлены параметры отношений',before:{label:old.label,trust:old.trust,affection:old.affection,tension:old.tension,hostility:old.hostility},after:{label,trust,affection,tension,hostility}});Object.assign(old,data);}
 else{data.history.push({at:Date.now(),summary:'Связь создана'});m.relationships.push(data);}
 persist().catch(e=>toast(e.message));
}
function showRelationshipHistory(id){
 const r=mem().relationships.find(x=>x.id===id);if(!r)return;
 const lines=(r.history||[]).map(h=>new Date(h.at).toLocaleString()+' — '+h.summary).join('\\n');
 alert(lines||'История изменений пока пуста.');
}
function editTimelineEvent(id=null){
 const m=mem(),old=id?m.timeline.find(x=>x.id===id):null;if(id&&!old)return;
 const title=promptField('Название события',old?.title||'');if(title===null||!title.trim())return;
 const description=promptField('Что произошло?',old?.description||'');if(description===null)return;
 const date=promptField('Дата / период внутри RP (например: 14 декабря, вечер)',old?.date||'');if(date===null)return;
 const place=promptField('Место',old?.place||'');if(place===null)return;
 const participantText=promptField('ID участников через запятую. Профили:\\n'+m.characters.map(c=>c.id+' — '+c.name).join('\\n'),(old?.participants||[]).join(','));if(participantText===null)return;
 const participants=participantText.split(',').map(x=>x.trim()).filter(id=>m.characters.some(c=>c.id===id));
 const consequences=promptField('Последствия события',old?.consequences||'');if(consequences===null)return;
 const data={id:old?.id||uid(),title:title.trim(),description,date,place,participants,consequences,createdAt:old?.createdAt||Date.now(),updatedAt:Date.now()};
 if(old)Object.assign(old,data);else m.timeline.push(data);
 persist().catch(e=>toast(e.message));
}

function settingsHtml(m){
 const s=m.settings;
 return `<div class="mb-card"><h3>Автоматическое сохранение</h3><label class="mb-check"><input type="checkbox" id="mb-auto" ${s.autoSave?'checked':''}> Автоматически архивировать новые сообщения</label><label>Запускать обработку после N новых сообщений<input type="number" id="mb-every" min="10" max="500" step="5" value="${s.autoEvery}"></label><label>Размер пачки для анализа<input type="number" id="mb-max" min="10" max="200" step="5" value="${s.maxAutoMessages}"></label><label>Строгость отбора воспоминаний<select id="mb-memory-mode"><option value="strict" ${s.memoryMode==='strict'?'selected':''}>Только самое важное</option><option value="balanced" ${s.memoryMode==='balanced'?'selected':''}>Сбалансированно</option><option value="detailed" ${s.memoryMode==='detailed'?'selected':''}>Подробно</option></select></label><p class="mb-muted">После накопления ${s.autoEvery} новых сообщений дневник анализирует пачку целиком. Он может создать несколько записей или не сохранить ничего, если в переписке нет значимых событий. Кнопка «Найти новое» позволяет запускать обработку вручную.</p></div>
 <div class="mb-card"><h3>Контекст модели</h3><label class="mb-check"><input type="checkbox" id="mb-context" ${s.contextEnabled?'checked':''}> Добавлять выбранные воспоминания в контекст РП</label><label>Глубина контекста (слои)<input type="number" id="mb-depth" min="0" max="4" value="${s.contextDepth}"></label><label>Максимум записей за ответ<input type="number" id="mb-limit" min="1" max="30" value="${s.contextLimit}"></label><label class="mb-check"><input type="checkbox" id="mb-recall" ${s.autoRecall?'checked':''}> Автоматически подбирать релевантные воспоминания</label></div>
 <div class="mb-card"><h3>Инструкции архивариусу</h3><textarea id="mb-prompt" placeholder="Дополнительные правила извлечения…">${esc(s.customPrompt||'')}</textarea><div class="mb-row"><button data-action="save-settings" class="mb-primary">Сохранить настройки</button><button data-action="export">Экспорт памяти</button><button data-action="import">Импорт памяти</button><button data-action="reset">Сбросить настройки</button></div></div>`;
}
function onChange(e){
 if(e.target.id==='mb-search'){search=e.target.value;const pos=e.target.selectionStart;render();const el=$('#mb-search');el?.focus();el?.setSelectionRange(pos,pos);}
 if(e.target.id==='mb-start')currentRange.start=e.target.value;
 if(e.target.id==='mb-end')currentRange.end=e.target.value;
 if(e.target.id==='mb-profile-image'){const file=e.target.files?.[0];if(file)saveProfileImage(file);}
}
async function saveProfileImage(file){
 const imageScope=scope();
 if(!file.type?.startsWith('image/')){toast('Выбери файл изображения.');return;}
 if(file.size>15*1024*1024){toast('Изображение слишком большое. Выбери фото до 15 МБ.');return;}
 try{
  let dataUrl;
  if(typeof createImageBitmap==='function'){
   const bitmap=await createImageBitmap(file);const scale=Math.min(1,640/Math.max(bitmap.width,bitmap.height));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();dataUrl=canvas.toDataURL('image/jpeg',0.84);
  }else{dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});}
  if(scope()!==imageScope)throw Error('Чат сменился во время загрузки. Повтори выбор изображения в нужном чате.');
  mem().profileImage=dataUrl;await persist();toast('Изображение персонажа сохранено для этого чата.');
 }catch(error){toast(`Не удалось сохранить изображение: ${error.message||error}`);}
}
async function onClick(e){
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.tab){activeTab=b.dataset.tab;render();return;}
 if(b.dataset.filter){filter=b.dataset.filter;render();return;}
 const action=b.dataset.action,id=b.dataset.id,m=mem();
 try{
  if(action==='close'){close();return;}
  if(action==='open-range'){const m=mem(),c=captureChat();const next=Math.min(Math.max(0,c.length-1),lastProcessedIndex(m,c)+1);currentRange={start:String(next),end:String(Math.max(0,c.length-1))};rangeOpen=true;render();return;}
  if(action==='close-range'){rangeOpen=false;render();return;}
  if(action==='save-range'){await saveRange();return;}
  if(action==='save-new'||action==='import-chat'){await saveNew();return;}
  if(action==='cancel-processing'){aborter?.abort();toast('Останавливаю обработку…');return;}
  if(action==='remove-avatar'){delete m.profileImage;await persist();toast('Фото удалено из сводки.');return;}
  if(action==='refresh'){updateContext();render();toast('Сводка обновлена.');return;}
  if(action==='generate-summary'){activeTab='summary';render();toast('Сводка собрана из сохранённых воспоминаний.');return;}
  if(action==='clear-memory'){if(!confirm('Удалить все воспоминания именно из этого чата? Это действие нельзя отменить.'))return;m.records=[];m.batches=[];await persist();toast('Память этого чата очищена.');return;}
  if(action==='new-manual'){openWithManual();return;}
  if(action==='save-settings'){saveSettingsFromUI();await persist();toast('Настройки сохранены.');return;}
  if(action==='add-character'){editCharacter();return;}
  if(action==='seed-main-characters'){addMainCharacters();return;}
  if(action==='edit-character'){editCharacter(id);return;}
  if(action==='delete-character'){const c=m.characters.find(x=>x.id===id);if(!c)return;if(!confirm('Удалить профиль '+c.name+'? Связи и события останутся, но будут показывать удалённого персонажа.'))return;m.characters=m.characters.filter(x=>x.id!==id);await persist();return;}
  if(action==='add-relationship'){editRelationship();return;}
  if(action==='edit-relationship'){editRelationship(id);return;}
  if(action==='relationship-history'){showRelationshipHistory(id);return;}
  if(action==='delete-relationship'){if(!confirm('Удалить эту связь и её историю?'))return;m.relationships=m.relationships.filter(x=>x.id!==id);await persist();return;}
  if(action==='add-event'){editTimelineEvent();return;}
  if(action==='edit-event'){editTimelineEvent(id);return;}
  if(action==='delete-event'){if(!confirm('Удалить это событие из хронологии?'))return;m.timeline=m.timeline.filter(x=>x.id!==id);await persist();return;}
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
 s.autoSave=$('#mb-auto').checked;s.autoEvery=clampNum($('#mb-every').value,10,500,50);
 s.maxAutoMessages=clampNum($('#mb-max').value,10,200,50);
 s.memoryMode=['strict','balanced','detailed'].includes($('#mb-memory-mode').value)?$('#mb-memory-mode').value:'balanced';s.autoBatchVersion=2;
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
function lastProcessedIndex(m=mem(),list=chat()){
 if(m.lastProcessedMessageId){const found=list.findIndex(message=>message.extra?.memoryBookId===m.lastProcessedMessageId);if(found>=0)return found;}
 if(Number.isInteger(m.lastProcessedIndex))return m.lastProcessedIndex;
 return Math.max(-1,...m.records.flatMap(r=>(r.sources||[]).map(s=>Number(s.index)).filter(Number.isInteger)),...m.batches.map(b=>Number(b.end)).filter(Number.isInteger));
}
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
 const scopeAt=scope(), chunkSize=8;
 busy=true;aborter=new AbortController();render();
 let totalAdded=0,totalMerged=0,completed=0;
 try{
   for(let offset=0;offset<selected.length;offset+=chunkSize){
     if(aborter.signal.aborted)throw new DOMException('Операция отменена.','AbortError');
     const chunk=selected.slice(offset,offset+chunkSize);
     const first=chunk[0]._mbIndex,last=chunk[chunk.length-1]._mbIndex;
     const snapshots=chunk.map(m=>snapshot(m,m._mbIndex));
     toast(`Архивирую сообщения ${first}–${last} (${Math.min(offset+chunk.length,selected.length)} из ${selected.length})…`);
     const raw=await extract(chunk.map(m=>({name:m.name,is_user:m.is_user,mes:m.mes,is_hidden:hidden(m)})),mem().settings,c,aborter.signal);
     if(scope()!==scopeAt)throw Error('Чат переключился во время анализа; результат этой пачки не применён.');
     const now=chat();
     for(const snap of snapshots){const current=now.find(m=>m.extra?.memoryBookId===snap.id);if(!current||fingerprint(current)!==snap.hash)throw Error('История изменилась во время анализа. Последняя пачка не сохранена — запусти её заново.');}
     const parsed=validateExtraction(raw,chunk.map(m=>({name:m.name,is_user:m.is_user,mes:m.mes,extra:{memoryBookId:m.extra?.memoryBookId,memoryBookIndex:m._mbIndex}})));
     const m=mem();let added=0,merged=0;
     for(const r of parsed.records){const result=mergeRecord(m,r);result.merged?merged++:added++;}
     m.lastProcessedIndex=Math.max(lastProcessedIndex(m,list),last);
     m.lastProcessedMessageId=list[last]?.extra?.memoryBookId||m.lastProcessedMessageId||null;
     m.batches.push({id:uid(),at:Date.now(),title:automatic?'Автоматическая обработка пачки':'Сохранение диапазона',start:first,end:last,added:added+merged,summary:parsed.summary,automatic:!!automatic});
     m.batches=m.batches.slice(-100);m.revision=(m.revision||0)+1;
     await persist();
     totalAdded+=added;totalMerged+=merged;completed+=chunk.length;
   }
   rangeOpen=false;toast(`Готово: ${totalAdded} новых, ${totalMerged} объединено. Обработано ${completed} сообщений до №${end}.`);
 }catch(err){
   if(err.name!=='AbortError')toast(`Не удалось сохранить пачку после ${completed} сообщений: ${err.message||err}. Уже сохранённые пачки остались в памяти.`);
   else toast(`Обработка остановлена. Успешно сохранено сообщений: ${completed}.`);
 }finally{busy=false;aborter=null;render();}
}
async function saveNew(){const c=captureChat(),m=mem();if(!c.length){toast('В этом чате пока нет сообщений.');return;}const start=Math.max(0,lastProcessedIndex(m,c)+1),end=c.length-1;if(start>end){toast('Новых сообщений для архива нет.');return;}currentRange={start:String(start),end:String(end)};await saveRange(start,end,false);}
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
 let b=$('#mb-fab');
 if(!b){b=document.createElement('button');b.id='mb-fab';b.type='button';b.textContent='📚';b.title='Открыть Книга памяти';b.setAttribute('aria-label','Открыть Книга памяти');document.body.append(b);}
 if(b.dataset.bound!=='1'){b.dataset.bound='1';b.addEventListener('click',open);}
}
function ensureWand(){
 const menu=$('#extensionsMenu');
 if(!menu||$('#mb-wand'))return;
 const item=document.createElement('div');item.id='mb-wand';item.className='list-group-item flex-container flexGap5 interactable';item.tabIndex=0;
 item.innerHTML='<span aria-hidden="true">📚</span><span>MemoryBook — Книга памяти</span>';
 item.addEventListener('click',e=>{e.preventDefault();open();});
 item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
 menu.appendChild(item);
}
function ensureSettings(){
 const host=$('#extensions_settings2')||$('#extensions_settings');
 if(!host||$('#mb-settings'))return;
 const wrap=document.createElement('div');wrap.id='mb-settings';wrap.className='inline-drawer';
 wrap.innerHTML='<div class="inline-drawer-toggle inline-drawer-header"><b>📚 MemoryBook — Книга памяти</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><p>Личный архив событий, отношений и важных деталей ролевой истории.</p><button id="mb-open-settings" class="menu_button">📖 Открыть Книга памяти</button></div>';
 host.appendChild(wrap);
 const toggle=wrap.querySelector('.inline-drawer-toggle');toggle?.addEventListener('click',()=>wrap.classList.toggle('open'));
 wrap.querySelector('#mb-open-settings')?.addEventListener('click',open);
}
function installEvents(){
 const ev=event_types||{};
 for(const name of ['CHAT_CHANGED','MESSAGE_RECEIVED','MESSAGE_SENT','GENERATION_ENDED','GENERATION_STARTED']){
   const type=ev[name]||name;
   try{eventSource.on(type,()=>{if(scope()!==lastScope){lastScope=scope();autoCounter=0;loadMemory();return;}updateContext();if(name==='MESSAGE_RECEIVED'||name==='MESSAGE_SENT'){autoCounter++;const s=mem().settings;if(s.autoSave&&autoCounter>=Math.max(10,Number(s.autoEvery)||50)&&!busy){autoCounter=0;saveRange(undefined,undefined,true);}}});}catch{}
 }
}
function init(){
 setupFloating();ensurePanel();ensureWand();ensureSettings();installEvents();lastScope=scope();loadMemory();
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel&&!panel.hidden)close();});
 updateContext();
 // SillyTavern creates some extension UI containers after third-party scripts load.
 // Retry registration, matching the approach used by the working LoveMed extension.
 setInterval(()=>{setupFloating();ensureWand();ensureSettings();},2000);
 console.info('[MemoryBook] initialized', { floatingButton:!!$('#mb-fab'), wandMenu:!!$('#mb-wand') });
}
function openWithManual(){open();const title=prompt('Заголовок нового воспоминания');if(title===null||!title.trim())return;const content=prompt('Что нужно запомнить?');if(content===null||!content.trim())return;const category=prompt('Категория: '+Object.keys(CATEGORIES).join(', '),'event')||'event';const m=mem();m.records.push({id:uid(),title:title.trim(),content:content.trim(),category:Object.hasOwn(CATEGORIES,category)?category:'other',importance:4,pinned:true,enabled:true,manual:true,sources:[],createdAt:Date.now(),updatedAt:Date.now()});persist().catch(e=>toast(e.message));}
init();
