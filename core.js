export const KEY = 'memory_book_v1';
export const VERSION = 1;
export const CATEGORIES = {
  event:'Событие', relationship:'Отношения', promise:'Обещание', secret:'Секрет',
  quote:'Важная реплика', character:'Персонаж', item:'Предмет', place:'Место',
  state:'Состояние сцены', consequence:'Последствие', other:'Другое'
};
export const DEFAULTS = {
  enabled:true, autoSave:false, autoEvery:8, maxAutoMessages:12,
  contextEnabled:true, contextDepth:2, contextLimit:12, autoRecall:true,
  language:'ru', customPrompt:'', includeHiddenManual:true, lastAutoAt:0
};
export const uid = () => globalThis.crypto?.randomUUID?.() || `mb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const clone = x => JSON.parse(JSON.stringify(x));
export const norm = x => String(x ?? '').toLocaleLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
export const fingerprint = m => hash(`${m?.name || ''}\n${m?.is_user ? 'user' : 'character'}\n${m?.mes || ''}`);
export function hash(s) { let h=2166136261; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);} return (h>>>0).toString(36); }
export function eligible(m) {
  return !!m && typeof m.mes === 'string' && !!m.mes.trim()
    && !['system','summarize','chat_background'].includes(m.extra?.type)
    && !m.extra?.isSmallSys && !m.is_system;
}
export function hidden(m) { return !!(m?.is_hidden || m?.extra?.isHidden || m?.extra?.hidden); }
export function ensureIds(chat) {
  let changed=false; const seen=new Set();
  for(const m of chat) {
    if(!m.extra) m.extra={};
    if(!m.extra.memoryBookId || seen.has(m.extra.memoryBookId)) { m.extra.memoryBookId=uid(); changed=true; }
    seen.add(m.extra.memoryBookId);
  }
  return changed;
}
export const source = (m,index) => ({id:m?.extra?.memoryBookId, hash:fingerprint(m), index:Number.isInteger(m?.extra?.memoryBookIndex)?m.extra.memoryBookIndex:index, name:String(m?.name||''), is_user:!!m?.is_user});
export const sourceMap = chat => new Map(chat.map((m,i)=>[m?.extra?.memoryBookId,{hash:fingerprint(m),index:i,hidden:hidden(m)}]).filter(([id])=>!!id));
export function validSources(sources,map) {
  return Array.isArray(sources) && sources.length>0 && sources.every(s=>map.get(s.id)?.hash===s.hash);
}
export function emptyMemory() {
  return {version:VERSION,records:[],batches:[],settings:clone(DEFAULTS),revision:0,branchId:uid()};
}
export function normalizeMemory(raw) {
  const mem={...emptyMemory(),...(raw||{})};
  mem.records=Array.isArray(mem.records)?mem.records:[];
  mem.batches=Array.isArray(mem.batches)?mem.batches:[];
  mem.settings={...clone(DEFAULTS),...(mem.settings||{})};
  if(!mem.branchId) mem.branchId=uid();
  return mem;
}
export function validRecord(r,map) { return !!r.manual || validSources(r.sources,map); }
export function activeRecords(mem,chat) {
  const map=sourceMap(chat);
  return mem.records.filter(r=>!r.deleted && r.enabled!==false && validRecord(r,map));
}
export function recordText(r) {
  return [r.title,r.summary,r.content,Array.isArray(r.facts)?r.facts.join('; '):''].filter(Boolean).join('\n');
}
export function keywords(s) {
  return [...new Set(norm(s).replace(/[^\p{L}\p{N}\s'-]/gu,' ').split(/\s+/).filter(x=>x.length>2))];
}
export function scoreRecord(r, query) {
  const q=keywords(query), t=new Set(keywords(recordText(r)));
  if(!q.length) return 0;
  let score=0; for(const k of q) if(t.has(k)) score++;
  if(r.pinned) score+=2;
  if(r.importance>=4) score+=1;
  return score;
}
export function selectContext(mem,chat,limit=12) {
  const records=activeRecords(mem,chat);
  if(!records.length) return [];
  const recent=chat.filter(eligible).slice(-4).map(m=>`${m.name|| (m.is_user?'{{user}}':'{{char}}')}: ${m.mes}`).join('\n');
  const ranked=records.map((r,i)=>({r,i,score:scoreRecord(r,recent)+(r.pinned?5:0)+(Number(r.importance)||1)*0.25}))
    .sort((a,b)=>b.score-a.score || (b.r.updatedAt||0)-(a.r.updatedAt||0));
  const selected=ranked.filter(x=>x.score>0 || x.r.pinned).slice(0,limit);
  // If nothing matches, provide a small stable baseline of key memories.
  if(!selected.length) return records.filter(r=>r.pinned || r.importance>=4).slice(-Math.min(3,limit));
  return selected.map(x=>x.r);
}
export function validateExtraction(data, messages) {
  if(!data || typeof data!=='object' || !Array.isArray(data.memories)) throw Error('Модель вернула неправильный формат: ожидался объект с memories.');
  const sources=messages.map((m,i)=>source(m,i));
  const records=[];
  for(const raw of data.memories.slice(0,30)) {
    if(!raw || typeof raw!=='object') continue;
    const title=String(raw.title||'').trim().slice(0,180);
    const content=String(raw.content||raw.summary||'').trim().slice(0,4000);
    if(!title || !content) continue;
    const cat=Object.hasOwn(CATEGORIES,raw.category)?raw.category:'other';
    let idx=Array.isArray(raw.source_indices)?raw.source_indices:[];
    idx=idx.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<messages.length);
    if(!idx.length) idx=messages.map((_,i)=>i);
    const importance=Math.max(1,Math.min(5,Number(raw.importance)||3));
    records.push({
      id:uid(), key:norm(title), title, content, category:cat,
      importance, pinned:false, enabled:true, manual:false, createdAt:Date.now(),updatedAt:Date.now(),
      sources:idx.map(i=>sources[i]), sourceIndices:idx
    });
  }
  return {records, summary:String(data.scene_summary||'').trim().slice(0,2000)};
}
export function mergeRecord(mem, incoming) {
  const normalized=norm(incoming.title);
  const existing=mem.records.find(r=>!r.deleted && norm(r.title)===normalized && r.category===incoming.category && r.manual!==true);
  if(existing) {
    const oldSources=new Set((existing.sources||[]).map(s=>`${s.id}:${s.hash}`));
    existing.sources=[...(existing.sources||[]),...(incoming.sources||[]).filter(s=>!oldSources.has(`${s.id}:${s.hash}`))];
    const old=norm(existing.content), add=norm(incoming.content);
    if(add && !old.includes(add)) existing.content=`${existing.content}\n${incoming.content}`.slice(0,5000);
    existing.importance=Math.max(existing.importance||1,incoming.importance||1);
    existing.updatedAt=Date.now();
    return {record:existing,merged:true};
  }
  mem.records.push(incoming); return {record:incoming,merged:false};
}
export function branchCheck(mem, chat) {
  const map=sourceMap(chat);
  const invalid=mem.records.filter(r=>!r.manual&&!r.deleted&&Array.isArray(r.sources)&&!validSources(r.sources,map));
  return {invalid,valid:mem.records.filter(r=>!r.deleted&&(r.manual||validSources(r.sources,map)))};
}
export function formatContext(records) {
  if(!records.length) return '';
  return 'MEMORY DIARY — подтверждённые воспоминания прошлых сцен. Используй их как контекст, не придумывай новые факты. Если память противоречит явно разыгранным более поздним событиям, учитывай хронологию и уточняй неопределённость.\n'
    + records.map(r=>`[${CATEGORIES[r.category]||'Воспоминание'}${r.importance>=4?' · важно':''}] ${r.title}: ${r.content}`).join('\n');
}
