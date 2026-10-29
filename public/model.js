export const normalizeText = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
export const formatTime = value => {const t=Math.max(0,Math.floor(Number(value)||0));return t>=3600?`${Math.floor(t/3600)}:${String(Math.floor(t/60)%60).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`:`${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`};
export const displayText = passage => passage.sourceText || passage.displayText || passage.text || '';
export function passageAt(passages,time){let low=0,high=passages.length-1,result=null;while(low<=high){const mid=(low+high)>>1,p=passages[mid];if(p.start<=time){result=p;low=mid+1}else high=mid-1}return result && time<result.end+.3?result:null}
export const FACETS = [
 {id:'page',label:'Source page'}, {id:'section',label:'Section'}, {id:'category',label:'Category'},
 {id:'subcategory',label:'Subcategory'}, {id:'topic',label:'Topic'}, {id:'authority',label:'Cited authority'},
 {id:'obligation',label:'Obligation in context'}, {id:'ruling',label:'Ruling in context'}, {id:'type',label:'Statement type'}
];
const valueLabel = value => typeof value==='object'&&value!==null ? String(value.label??value.name??value.value??'') : String(value??'');
const list = value => (Array.isArray(value)?value:value==null?[]:[value]).map(valueLabel).filter(Boolean);
const classificationValues = (p,field) => {
 const values=p.classifications?.[field];
 if(!Array.isArray(values)||!values.length)return ['Unclassified'];
 return [...new Set(values.map(item=>item.status==='uncertain'||item.value==='uncertain'?'Uncertain':item.status==='not-applicable'||item.value==='not-applicable'?'Not applicable':valueLabel(item)).filter(Boolean))];
};
export function facetValues(p,facet){
 const values={page:()=>[String(p.page),...(p.sourceSpans||[]).map(span=>String(span.page))],section:()=>list(p.metadataSection||p.section),category:()=>list(p.category),subcategory:()=>list(p.subcategory),topic:()=>list(p.topics),authority:()=>list(p.authorities),obligation:()=>classificationValues(p,'obligation'),ruling:()=>classificationValues(p,'ruling'),type:()=>list(p.statementTypes)}[facet]?.()||[];
 return [...new Set(values.length?values:['Unclassified'])];
}
export const facetLabel = (facet,value) => facet==='page'?`Page ${value}`:String(value).replace(/^\w/,letter=>letter.toUpperCase());
export function sentenceAt(passage,time){return passage?.sentenceTimings?.find(sentence=>Number.isFinite(sentence.start)&&Number.isFinite(sentence.end)&&time>=sentence.start&&time<sentence.end)||null}
export function playbackSourcePage(passage,time){
 const sentencePage=sentenceAt(passage,time)?.sourcePage;
 return Number.isInteger(sentencePage)&&sentencePage>0?sentencePage:passage?.page;
}
export function filteredPassages(passages,{query='',filter='all',saved=[],review=[],facets={},ignoreFacet=null}={}){
 const q=normalizeText(query),savedSet=new Set(saved),reviewSet=new Set(review);
 return passages.filter(p=>!p.isNarrationCue&&(filter==='all'||filter==='saved'&&savedSet.has(p.id)||filter==='review'&&reviewSet.has(p.id))&&(!q||normalizeText([displayText(p),p.text,p.narrationText,p.metadataSection||p.section,p.subsection,...list(p.topics),...list(p.authorities)].join(' ')).includes(q))&&Object.entries(facets).every(([facet,selected])=>facet===ignoreFacet||!selected?.length||selected.some(value=>facetValues(p,facet).includes(value))));
}
export function facetCounts(passages,options={}){
 const result={};
 for(const facet of FACETS){const counts=new Map;for(const p of filteredPassages(passages,{...options,ignoreFacet:facet.id}))for(const value of facetValues(p,facet.id))counts.set(value,(counts.get(value)||0)+1);for(const value of options.facets?.[facet.id]||[])if(!counts.has(value))counts.set(value,0);result[facet.id]=[...counts].map(([value,count])=>({value,count})).sort((a,b)=>a.value.localeCompare(b.value,undefined,{numeric:true,sensitivity:'base'}))}
 return result;
}
export function sourceCompare(a,b){return (Number(a.sourceOrder)||a.page*10000)-(Number(b.sourceOrder)||b.page*10000)||a.page-b.page||a.start-b.start||String(a.id).localeCompare(String(b.id))}
export function primaryFacetValue(p,facet){return facetValues(p,facet).slice().sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}))[0]}
export function sortPassages(passages,sort='source'){
 const copy=[...passages];
 return copy.sort(sort==='source'?sourceCompare:(a,b)=>primaryFacetValue(a,sort).localeCompare(primaryFacetValue(b,sort),undefined,{numeric:true,sensitivity:'base'})||sourceCompare(a,b));
}
export function groupPassages(passages,group='none'){
 if(group==='none')return [{key:'',label:'',passages}];
 const groups=new Map;for(const p of passages){const key=primaryFacetValue(p,group);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p)}
 return [...groups].sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})).map(([key,items])=>({key,label:facetLabel(group,key),passages:items}));
}
export function migrateSession(memory,data){
 const next={...memory},ids=new Map(data.passages.map(p=>[p.id,p]));
 const map=data.idMigration||data.migration?.idMap||{};
 const migrated=id=>ids.has(id)?[id]:list(map[id]).filter(value=>ids.has(value));
 const legacyVersion=String(memory.audioVersion||data.migration?.fromAudioVersion||data.migration?.fromEdition||'scp-challah-notes-v1');
 next.legacyMarks={...memory.legacyMarks};
 for(const key of ['saved','studied','review']){
  const marks=Array.isArray(memory[key])?memory[key]:[];
  next[key]=[...new Set(marks.flatMap(migrated))];
  // Keep unresolved marks with their original identity and edition. They must
  // never appear as a bookmark at an unrelated new passage or audio position.
  const previous=Array.isArray(memory.legacyMarks?.[key])?memory.legacyMarks[key]:[];
  const legacy=[...previous.map(mark=>typeof mark==='string'?{id:mark,audioVersion:legacyVersion}:{...mark}),...marks.filter(id=>!migrated(id).length).map(id=>({id,audioVersion:legacyVersion}))];
  next.legacyMarks[key]=[...new Map(legacy.filter(mark=>typeof mark.id==='string').map(mark=>[`${mark.audioVersion||'unknown'}\0${mark.id}`,mark])).values()];
 }
 next.selected=migrated(memory.selected)[0]||undefined;
 const version=String(data.audio.version||data.audio.sha256||data.audio.url);
 if(memory.audioVersion!==version){
  // Audio versions never share a raw timeline. Preserve place by a mapped note.
  const selected=ids.get(next.selected);next.time=selected?.start||0;next.audioVersion=version;next.follow=false;
 }
 next.time=Math.max(0,Math.min(Number(next.time)||0,data.audio.duration-.1));
 return next;
}
export function validateModel(data){
 if(!data||!Array.isArray(data.passages)||!data.passages.length)throw Error('No note passages were found.');
 const duration=Number(data.audio?.duration);if(!Number.isFinite(duration)||duration<=0)throw Error('Audio timing metadata is missing.');
 let end=0;const ids=new Set;
 for(const p of data.passages){if(ids.has(p.id)||!Number.isFinite(p.start)||!Number.isFinite(p.end)||p.start<0||p.end<=p.start||p.start<end-.002||p.end>duration+.1||!Number.isInteger(p.page)||p.page<1)throw Error('The note timing data did not pass validation.');ids.add(p.id);end=p.end;
  let sentenceEnd=p.start;for(const sentence of p.sentenceTimings||[]){if(!Number.isFinite(sentence.start)||!Number.isFinite(sentence.end)||sentence.start<p.start-.002||sentence.end>p.end+.002||sentence.end<=sentence.start||sentence.start<sentenceEnd-.002)throw Error('Sentence timing metadata did not pass validation.');sentenceEnd=sentence.end}
 }
 return data;
}
