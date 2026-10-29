import { NotesPlayer } from './player.js';
import { normalizeText, formatTime, displayText, passageAt, sentenceAt, playbackSourcePage, filteredPassages, validateModel, FACETS, facetValues, facetLabel, facetCounts, sortPassages, groupPassages, migrateSession } from './model.js';

const $=selector=>document.querySelector(selector);
const all=selector=>[...document.querySelectorAll(selector)];
const text=(element,value)=>{element.textContent=String(value??'')};
const storageKey='scp-challah-notes-v1';
let memory={};try{memory=JSON.parse(localStorage.getItem(storageKey)||'{}')||{}}catch{}
for(const name of ['saved','studied','review'])if(!Array.isArray(memory[name]))memory[name]=[];
let data,player,pdf,pdfjs,pdfTask,selected=null,activePassage=null,page=Number(memory.page)||1,zoom=1,filter='all',query='',renderRevision=0,view=memory.view||(innerWidth<=760?'text':'pdf'),follow=memory.follow===true,repeat=false,lastSaved=0,toastTimer,resizeTimer;
let facets={},sort='source',group='none',scope='page',visibleLimit=120,activeSentence=null;
const facetInputs=new Map();
const byId=new Map(),byChapter=new Map();
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(memory))}catch{}}
function toast(message){text($('#status'),message);$('#status').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#status').classList.remove('visible'),5000)}
function saveSession(){if(!data)return;Object.assign(memory,{page,view,selected:selected?.id,time:player?.time??memory.time??0,follow,rate:$('#speed').value,compact:document.body.classList.contains('compact-player'),readerMode:document.body.classList.contains('reader-mode'),organization:{facets,sort,group,scope}});persist()}
function openMenu(open=true){$('#sidebar').classList.toggle('open',open);$('#backdrop').hidden=!open;$('#menuButton').setAttribute('aria-expanded',String(open));if(open)$('#search').focus({preventScroll:true})}
function titleFor(p){return p?.subsection||p?.section||byChapter.get(p?.chapterId)?.title||'Class notes'}
function excerpt(p,length=135){const value=displayText(p).replace(/\s+/g,' ').trim();return value.length>length?value.slice(0,length)+'…':value}
function firstPassage(chapter){return data.passages.find(p=>p.chapterId===chapter.id)}
function chapterForPage(){return data.chapters.find(c=>c.pages?.includes(page))}
function createButton(className,label,handler){const button=document.createElement('button');button.className=className;button.type='button';text(button,label);button.addEventListener('click',handler);return button}

function filterOptions(){return{query,filter,saved:memory.saved,review:memory.review,facets}}
function hasFacets(){return Object.values(facets).some(values=>values.length)}
function organized(){return scope==='all'}
function matches(){return filteredPassages(data.passages,filterOptions())}
function beginBrowse(){scope='all';follow=false;$('#followAudio').checked=false;visibleLimit=120;setView('text');renderNavigation();renderOrganizer();updateReturn();saveSession()}
function toggleFacet(facet,value){const values=new Set(facets[facet]||[]);if(values.has(value))values.delete(value);else values.add(value);facets[facet]=[...values];beginBrowse()}
function setupOrganizer(){
 const saved=memory.organization||{};for(const facet of FACETS)if(Array.isArray(saved.facets?.[facet.id]))facets[facet.id]=saved.facets[facet.id].filter(value=>typeof value==='string');
 sort=['source','page','section','category','topic','authority','obligation','ruling','type'].includes(saved.sort)?saved.sort:'source';group=['none','page','section','category','topic','authority','obligation','ruling','type'].includes(saved.group)?saved.group:'none';scope=saved.scope==='all'?'all':'page';
 const panel=document.createElement('details');panel.id='metadataPanel';panel.className='metadata-panel';panel.innerHTML='<summary>Filter and organize</summary><p class="facet-explanation">Match <strong>all selected facets</strong>; match <strong>any tag within a facet</strong>. Counts reflect the other selected facets.</p><div id="facetControls"></div><button id="resetOrganization" class="text-button reset-organization" type="button">Clear filters and reset order</button><p class="facet-explanation">Authority tags name cited sources, not an endorsed position. Obligation and ruling tags apply only in the passage’s stated context.</p>';
 $('#sidebar').insertBefore(panel,$('#navCount'));const selectionTags=document.createElement('div');selectionTags.id='selectionTags';$('#selectionText').after(selectionTags);
 const counts=facetCounts(data.passages);let index=0;
 for(const facet of FACETS){const box=document.createElement('details');box.className='facet';const summary=document.createElement('summary');text(summary,facet.label);box.append(summary);const options=document.createElement('div');options.className='facet-options';
  for(const item of counts[facet.id]){const label=document.createElement('label'),input=document.createElement('input'),name=document.createElement('span'),count=document.createElement('small');input.type='checkbox';input.id=`facet-${index++}`;input.value=item.value;input.dataset.facet=facet.id;name.dir='auto';text(name,facetLabel(facet.id,item.value));input.onchange=()=>toggleFacet(facet.id,item.value);label.append(input,name,count);options.append(label);facetInputs.set(`${facet.id}\0${item.value}`,{input,count,label})}box.append(options);$('#facetControls').append(box)}
 const toolbar=document.createElement('div');toolbar.id='organizationToolbar';toolbar.className='organization-toolbar';toolbar.innerHTML='<button id="openOrganization" type="button" class="text-button" aria-controls="metadataPanel">Tags &amp; filters</button><label>Show <select id="passageScope" aria-label="Passage scope"><option value="page">This source page</option><option value="all">All matching notes</option></select></label><label>Sort <select id="passageSort" aria-label="Sort passages"><option value="source">Source order</option><option value="page">Page</option><option value="section">Section</option><option value="category">Category</option><option value="topic">Topic</option><option value="authority">Cited authority</option><option value="obligation">Obligation</option><option value="ruling">Ruling</option><option value="type">Statement type</option></select></label><label>Group <select id="passageGroup" aria-label="Group passages"><option value="none">No groups</option><option value="page">Page</option><option value="section">Section</option><option value="category">Category</option><option value="topic">Topic</option><option value="authority">Cited authority</option><option value="obligation">Obligation</option><option value="ruling">Ruling</option><option value="type">Statement type</option></select></label>';
 $('#reader').insertBefore(toolbar,$('.reader-context'));
 const chips=document.createElement('div');chips.id='activeTags';chips.className='active-tags';chips.setAttribute('aria-label','Active note filters');toolbar.after(chips);
 $('#openOrganization').onclick=()=>{if(document.body.classList.contains('reader-mode')){document.body.classList.remove('reader-mode');$('#readerMode').setAttribute('aria-pressed','false')}panel.open=true;openMenu(true);panel.scrollIntoView({block:'start'});panel.querySelector('summary').focus()};
 $('#passageScope').onchange=event=>{scope=event.target.value;if(scope==='page'){facets={};query='';$('#search').value='';filter='all';sort='source';group='none';syncStudyFilters()}beginBrowseScope()};
 $('#passageSort').onchange=event=>{sort=event.target.value;beginBrowse()};$('#passageGroup').onchange=event=>{group=event.target.value;beginBrowse()};
 $('#resetOrganization').onclick=resetOrganization;renderOrganizer();
}
function syncStudyFilters(){all('[data-filter]').forEach(button=>{const active=button.dataset.filter===filter;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))})}
function beginBrowseScope(){follow=false;$('#followAudio').checked=false;visibleLimit=120;setView('text');renderNavigation();renderOrganizer();updateReturn();saveSession()}
function resetOrganization(){facets={};query='';filter='all';sort='source';group='none';scope='page';$('#search').value='';syncStudyFilters();beginBrowseScope()}
function renderOrganizer(){
 if(!$('#metadataPanel'))return;const counts=facetCounts(data.passages,filterOptions());
 for(const facet of FACETS)for(const [key,control] of facetInputs){if(!key.startsWith(facet.id+'\0'))continue;const value=control.input.value,item=counts[facet.id].find(item=>item.value===value),checked=(facets[facet.id]||[]).includes(value),count=item?.count||0;control.input.checked=checked;control.input.disabled=!checked&&!count;text(control.count,count);control.label.classList.toggle('zero-count',!count);control.input.setAttribute('aria-label',`${facet.label}: ${facetLabel(facet.id,value)}, ${count} matching passage${count===1?'':'s'}`)}
 $('#passageScope').value=organized()?'all':'page';$('#passageSort').value=sort;$('#passageGroup').value=group;
 const chips=$('#activeTags');chips.replaceChildren();for(const facet of FACETS)for(const value of facets[facet.id]||[]){const button=createButton('active-chip',`${facet.label}: ${facetLabel(facet.id,value)} ×`,()=>toggleFacet(facet.id,value));button.setAttribute('aria-label',`Remove ${facet.label} filter ${value}`);chips.append(button)}if(query)chips.append(createButton('active-chip',`Search: ${query} ×`,()=>{query='';$('#search').value='';beginBrowseScope()}));if(filter!=='all')chips.append(createButton('active-chip',`${filter==='saved'?'Saved':'To revisit'} ×`,()=>{filter='all';syncStudyFilters();beginBrowseScope()}));chips.hidden=!chips.childElementCount;
}

function renderNavigation(){
 if(!data)return;
 const chapters=$('#chapterList'),results=$('#searchResults');chapters.replaceChildren();results.replaceChildren();const searching=!!query||filter!=='all'||hasFacets();chapters.hidden=searching;results.hidden=!searching;
 if(searching){const found=sortPassages(matches(),sort);text($('#navCount'),`${found.length} matching passage${found.length===1?'':'s'}${found.length>60?' · first 60 in navigation':''}`);for(const p of found.slice(0,60)){const button=createButton('search-hit','',()=>selectPassage(p,{play:false,show:true}));const label=document.createElement('span');label.dir='auto';text(label,excerpt(p,190));const meta=document.createElement('small');text(meta,`Page ${p.page} · ${formatTime(p.start)}${memory.saved.includes(p.id)?' · Saved':''}`);button.append(label,meta);results.append(button)}if(!found.length){const empty=document.createElement('p');empty.className='empty';text(empty,'No passages match these filters. Remove a tag or clear filters to start again.');results.append(empty)}return}
 text($('#navCount'),`${data.chapters.length} chapters · ${data.source.pages} source pages`);
 for(const [index,chapter] of data.chapters.entries()){const row=document.createElement('div');row.className='chapter-row'+((selected?.chapterId||chapterForPage()?.id)===chapter.id?' active':'');const open=createButton('chapter-open','',()=>{const p=firstPassage(chapter);if(p)selectPassage(p,{show:true})});const number=document.createElement('span');number.className='chapter-number';text(number,String(index+1).padStart(2,'0'));const body=document.createElement('span'),heading=document.createElement('strong'),meta=document.createElement('small');heading.dir='auto';text(heading,chapter.title);text(meta,`${formatTime(chapter.start)} · ${formatTime(chapter.end-chapter.start)}`);body.append(heading,meta);open.append(number,body);const play=createButton('chapter-play','▶',()=>{const p=firstPassage(chapter);if(p)selectPassage(p,{play:true,show:true})});play.setAttribute('aria-label',`Play chapter ${index+1}: ${chapter.title}`);row.append(open,play);chapters.append(row)}
}

function renderSelection(){
 if(!selected){text($('#selectionTitle'),'Choose a passage.');text($('#selectionMeta'),`Source page ${page}`);text($('#selectionText'),'Select a passage in the notes, or use search.');$('#selectionTags')?.replaceChildren();for(const id of ['playSelection','savePassage','markStudied','markReview'])$('#'+id).disabled=true;return}text($('#selectionTitle'),titleFor(selected));text($('#selectionMeta'),`Source page ${selected.page} · ${formatTime(selected.start)}–${formatTime(selected.end)}`);text($('#selectionText'),displayText(selected));$('#selectionTags')?.replaceChildren(metadataFor(selected));$('#playSelection').disabled=false;
 for(const [id,key,label,icon] of [['savePassage','saved','Save','☆'],['markStudied','studied','Studied','✓'],['markReview','review','Revisit','↺']]){const button=$('#'+id);button.disabled=false;const marked=memory[key].includes(selected.id);button.setAttribute('aria-pressed',String(marked));text(button,`${marked?'●':icon} ${label}`)}
 updateHighlights();
}
function toggleTag(key){if(!selected)return;const set=new Set(memory[key]);if(set.has(selected.id))set.delete(selected.id);else set.add(selected.id);memory[key]=[...set];persist();renderSelection();renderNavigation();renderTextPassages()}
function selectPassage(p,{play=false,show=false}={}){
 if(show&&!filteredPassages([p],filterOptions()).length){facets={};query='';filter='all';$('#search').value='';syncStudyFilters();renderOrganizer()}selected=p;memory.selected=p.id;renderSelection();renderNavigation();openMenu(false);
 // Playback is invoked before any awaited page rendering, retaining the user gesture.
 if(play){player.seek(p.start,{play:true});text($('#nowTitle'),titleFor(p));text($('#nowMeta'),`Source page ${p.page} · ${formatTime(p.start)}`);if(repeat)player.setRepeat({start:p.start,end:p.end})}
 if(show&&p.page!==page)goPage(p.page,{manual:true});else{renderTextPassages();if(show)document.querySelector(`[data-passage-card="${p.id}"]`)?.scrollIntoView({block:'center',behavior:'smooth'})}
 saveSession();
}

function renderTextPassages(){
 if(!data)return;const container=$('#passageView');container.replaceChildren();const browsing=organized(),found=matches(),items=sortPassages(browsing?found:found.filter(p=>facetValues(p,'page').includes(String(page))),sort);const heading=document.createElement('div');heading.className='page-heading';const title=document.createElement('h2');text(title,browsing?`${items.length} matching passages`:`Source page ${page}`);const intro=document.createElement('p');text(intro,items.length?`${browsing?'Across the supplied notes. ':''}Select a complete passage to listen. Playback continues in source order.${group!=='none'?' Passages with several group tags appear once, under the first alphabetical tag.':''}`:'No passages match this selection. Clear filters, choose another page, or open the original PDF.');heading.append(title,intro);if(!items.length)heading.append(createButton('text-button','Clear filters',resetOrganization));container.append(heading);
 const visible=items.slice(0,visibleLimit);for(const section of groupPassages(visible,group)){if(section.label){const groupTitle=document.createElement('h3');groupTitle.className='passage-group-heading';groupTitle.dir='auto';text(groupTitle,`${section.label} · ${section.passages.length}`);container.append(groupTitle)}for(const p of section.passages)container.append(passageCard(p))}
 if(items.length>visibleLimit){const more=createButton('load-more',`Show ${Math.min(120,items.length-visibleLimit)} more passages (${items.length-visibleLimit} remaining)`,()=>{visibleLimit+=120;renderTextPassages()});container.append(more)}updateSentence();
}
const sourcePages=p=>facetValues(p,'page').filter(value=>value!=='Unclassified').map(Number).sort((a,b)=>a-b);
const plain=value=>typeof value==='object'&&value!==null?String(value.label??value.name??value.text??value.value??value.citation??''):String(value??'');
function passageCard(p){
 const article=document.createElement('article');article.className='note-passage'+(selected?.id===p.id?' selected':'')+(activePassage?.id===p.id&&player?.playing?' playing':'');article.dataset.passageCard=p.id;
 const context=document.createElement('div');context.className='passage-context';context.dir='auto';text(context,[p.metadataSection||p.section,p.metadataSubsection||p.contextSubsection||p.subsection].filter((value,index,items)=>value&&items.indexOf(value)===index).join(' › '));
 const button=createButton('passage-text',displayText(p),()=>selectPassage(p,{play:true}));button.dir='auto';button.setAttribute('aria-label',`Listen from ${formatTime(p.start)}, source page ${p.page}: ${excerpt(p,110)}`);
 const sentence=document.createElement('p');sentence.className='sentence-now';sentence.dataset.sentenceFor=p.id;sentence.dir='auto';sentence.hidden=true;
 const meta=document.createElement('div');meta.className='passage-meta';const caption=document.createElement('span');text(caption,`Page${sourcePages(p).length>1?'s':''} ${sourcePages(p).join(', ')} · ${formatTime(p.start)}–${formatTime(p.end)}`);
 const save=createButton('',memory.saved.includes(p.id)?'★ Saved':'☆ Save',()=>{selected=p;toggleTag('saved')});save.setAttribute('aria-label',`${memory.saved.includes(p.id)?'Unsave':'Save'} passage on page ${p.page} at ${formatTime(p.start)}`);
 const locate=createButton('','PDF ↗',()=>{selected=p;goPage(p.page,{manual:true});setView('pdf');renderSelection()});locate.setAttribute('aria-label',`Show original PDF page ${p.page}`);
 const studied=createButton('','✓',()=>{selected=p;toggleTag('studied')});studied.setAttribute('aria-label','Mark passage studied');studied.setAttribute('aria-pressed',String(memory.studied.includes(p.id)));
 const revisit=createButton('','↻',()=>{selected=p;toggleTag('review')});revisit.setAttribute('aria-label','Mark passage to revisit');revisit.setAttribute('aria-pressed',String(memory.review.includes(p.id)));
 meta.append(caption,save,studied,revisit,locate);article.append(context,button,sentence,metadataFor(p),meta);return article;
}
function metadataFor(p){
 const wrapper=document.createElement('div');wrapper.className='passage-metadata';const tags=document.createElement('div');tags.className='passage-tags';
 for(const facet of ['topic','authority','obligation','ruling','type'])for(const value of facetValues(p,facet).filter(value=>!['Unclassified','Not applicable'].includes(value)).slice(0,5)){const tag=createButton('note-tag',`${facet==='authority'?'Cited: ':facet==='obligation'?'Obligation: ':facet==='ruling'?'Ruling: ':''}${facetLabel(facet,value)}`,()=>toggleFacet(facet,value));tag.dir='auto';tag.title=`Filter ${FACETS.find(item=>item.id===facet).label}: ${value}`;if(facet==='authority')tag.setAttribute('aria-label',`Filter cited authority: ${value}`);tags.append(tag)}wrapper.append(tags);
 if(p.sourceIncomplete){const warning=document.createElement('p');warning.className='source-note';text(warning,'Source excerpt ends here. Check the original PDF for context.');wrapper.append(warning)}
 const evidence=document.createElement('details');evidence.className='passage-evidence';const summary=document.createElement('summary');text(summary,'Context & sources');evidence.append(summary);
 const add=(label,value)=>{const values=(Array.isArray(value)?value:[value]).map(plain).filter(Boolean);if(!values.length)return;const row=document.createElement('p'),strong=document.createElement('strong'),span=document.createElement('span');text(strong,label+': ');span.dir='auto';text(span,values.join(' · '));row.append(strong,span);evidence.append(row)};
 add('Source pages',sourcePages(p));add('Source note',p.sourceNote||p.sourceNotes);add('Conditions',p.conditions);add('Cited authority',p.authorities);add('Citation',p.sourceCitations);add('Statement',p.statementTypes);
 const confidence=value=>typeof value==='number'?`${Math.round(value*100)}%`:plain(value);
 const evidenceLink=(item,target)=>{if(item.evidenceRecordId&&byId.has(item.evidenceRecordId)){const record=byId.get(item.evidenceRecordId);target.append(createButton('context-link',`Read evidence on page ${record.page}`,()=>selectPassage(record,{show:true})))}};
 for(const field of ['obligation','ruling'])for(const item of p.classifications?.[field]||[]){const row=document.createElement('p'),strong=document.createElement('strong');text(strong,`${field==='obligation'?'Obligation':'Ruling'}: ${facetLabel(field,item.value||'uncertain')} (${item.status||'uncertain'}${item.confidence!==undefined?`; confidence ${confidence(item.confidence)}`:''})`);row.append(strong);if(item.context){const span=document.createElement('span');text(span,' — '+item.context);row.append(span)}if(item.evidence){const quote=document.createElement('q');quote.dir='auto';text(quote,item.evidence);row.append(document.createTextNode(' '),quote)}evidenceLink(item,row);evidence.append(row)}
 if(p.metadataEvidence?.length){const provenance=document.createElement('details');provenance.className='tag-evidence';const summary=document.createElement('summary');text(summary,'Tag evidence');provenance.append(summary);for(const item of p.metadataEvidence){const row=document.createElement('p'),label=document.createElement('strong');text(label,`${plain(item.field)}: ${plain(item.value)} (${item.status||'uncertain'}${item.confidence!==undefined?`; confidence ${confidence(item.confidence)}`:''})`);row.append(label);if(item.evidence){const quote=document.createElement('q');quote.dir='auto';text(quote,plain(item.evidence));row.append(quote)}evidenceLink(item,row);provenance.append(row)}evidence.append(provenance)}
 const related=[...new Set([p.contextId,p.parentId,...(p.relatedIds||[])].filter(id=>byId.has(id)&&id!==p.id))];for(const id of related){const target=byId.get(id);evidence.append(createButton('context-link',`Related · Page ${target.page}: ${excerpt(target,80)}`,()=>selectPassage(target,{show:true})))}
 if(p.parentId&&!byId.has(p.parentId)){const context=data.passages.filter(item=>item.parentId===p.parentId&&item.id!==p.id);if(context.length){const first=context[0];evidence.append(createButton('context-link',`Read this section from page ${first.page}`,()=>{selected=first;facets={section:facetValues(first,'section')};sort='source';group='none';beginBrowse();renderSelection()}))}}
 wrapper.append(evidence);return wrapper;
}
function sentenceIdentity(p,sentence){return sentence?sentence.id||`${p.id}:${sentence.start}`:null}
function updateSentence(){
 const sentence=sentenceAt(activePassage,player?.time??0);activeSentence=sentenceIdentity(activePassage,sentence);
 all('[data-sentence-for]').forEach(element=>{const active=element.dataset.sentenceFor===activePassage?.id&&sentence&&player?.playing;element.hidden=!active;if(active)text(element,`Narrating: ${sentence.text||sentence.narrationText||''}`)});
}
function updateHighlights(){
 updateSentence();
 all('[data-passage]').forEach(button=>{button.classList.toggle('selected',button.dataset.passage===selected?.id);button.classList.toggle('playing',button.dataset.passage===activePassage?.id&&player?.playing)});
 all('[data-passage-card]').forEach(card=>{card.classList.toggle('selected',card.dataset.passageCard===selected?.id);card.classList.toggle('playing',card.dataset.passageCard===activePassage?.id&&player?.playing)});
}
function rectanglesForPage(p,target){const spans=(p.sourceSpans||[]).filter(span=>span.page===target&&span.rects?.length);return spans.length?spans.flatMap(span=>span.rects):p.page===target?(p.rects||[]):[]}
function renderOverlays(){
 const container=$('#pdfOverlays');container.replaceChildren();for(const p of data.passages.filter(p=>facetValues(p,'page').includes(String(page)))){for(const [index,r] of rectanglesForPage(p,page).entries()){if(![r.x,r.y,r.w,r.h].every(Number.isFinite))continue;const button=createButton('passage-overlay','',()=>selectPassage(p,{play:true}));button.dataset.passage=p.id;button.style.cssText=`left:${r.x*100}%;top:${r.y*100}%;width:${r.w*100}%;height:${r.h*100}%`;button.setAttribute('aria-label',`Listen to passage at ${formatTime(p.start)}: ${excerpt(p,100)}`);button.title=`▶ ${formatTime(p.start)} · ${excerpt(p,100)}`;if(index>0)button.tabIndex=-1;container.append(button)}}updateHighlights();
 const hasMapping=data.passages.some(p=>rectanglesForPage(p,page).length);text($('#readingHint'),hasMapping?'Marked clicks play the complete passage; a continuation may begin on an earlier page. Use Passages for the full text.':data.source.blankPages?.includes(page)?'This is a blank source page.':'For this page, open Passages to select the matching narration.');
}
async function ensurePDF(){
 if(pdf)return pdf;if(pdfTask)return pdfTask;pdfTask=(async()=>{pdfjs=await import('./vendor/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;const url=relativeURL('source.pdf');return pdf=await pdfjs.getDocument({url,cMapUrl:relativeURL('vendor/package/cmaps/'),cMapPacked:true,standardFontDataUrl:relativeURL('vendor/package/standard_fonts/'),wasmUrl:relativeURL('vendor/package/wasm/'),iccUrl:relativeURL('vendor/package/iccs/')}).promise})();return pdfTask;
}
function relativeURL(value){return new URL(value,document.baseURI).href}
async function renderPDF(){
 if(view!=='pdf'||!data)return;const revision=++renderRevision;$('#pdfError').hidden=true;$('#pdfLoading').hidden=false;$('#pdfOverlays').replaceChildren();$('#pdfPaper').hidden=true;
 try{const documentPDF=await ensurePDF();if(revision!==renderRevision)return;const sheet=await documentPDF.getPage(page);if(revision!==renderRevision)return;const base=sheet.getViewport({scale:1}),available=Math.max(260,$('#readerScroll').clientWidth-44),scale=Math.min(1.5,available/base.width)*zoom,viewport=sheet.getViewport({scale}),pixelRatio=Math.min(devicePixelRatio||1,2),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width*pixelRatio);canvas.height=Math.ceil(viewport.height*pixelRatio);const context=canvas.getContext('2d');await sheet.render({canvasContext:context,viewport,transform:pixelRatio===1?null:[pixelRatio,0,0,pixelRatio,0,0]}).promise;if(revision!==renderRevision)return;canvas.id='pdfCanvas';$('#pdfCanvas').replaceWith(canvas);$('#pdfPaper').style.width=viewport.width+'px';$('#pdfPaper').style.height=viewport.height+'px';$('#pdfPaper').hidden=false;renderOverlays();}
 catch(error){if(revision!==renderRevision)return;text($('#pdfError'),'The PDF could not open in this browser. You can still read and play the Passages view, or open the original PDF from the header.');$('#pdfError').hidden=false;$('#pdfPaper').hidden=true;console.warn('PDF preview unavailable:',error.name||'Error')}
 finally{if(revision===renderRevision)$('#pdfLoading').hidden=true}
}
function setView(next){view=next;memory.view=view;$('#pdfContainer').hidden=view!=='pdf';$('#passageView').hidden=view!=='text';$('#pdfView').classList.toggle('active',view==='pdf');$('#textView').classList.toggle('active',view==='text');$('#pdfView').setAttribute('aria-pressed',String(view==='pdf'));$('#textView').setAttribute('aria-pressed',String(view==='text'));all('.zoom-controls button').forEach(button=>button.disabled=view!=='pdf');if(view==='pdf')renderPDF();else{renderRevision++;$('#pdfLoading').hidden=true;renderTextPassages();text($('#readingHint'),'Click any passage to hear its corresponding audio. PDF opens the original page.')}persist()}
function goPage(value,{manual=false}={}){if(!data)return;page=Math.max(1,Math.min(data.source.pages,Number(value)||1));$('#pageSelect').value=String(page);$('#previousPage').disabled=page===1;$('#nextPage').disabled=page===data.source.pages;const chapter=chapterForPage();text($('#pageContext'),`SOURCE PAGE ${page} OF ${data.source.pages}${chapter?' · '+chapter.title:''}`);if(manual){scope='page';sort='source';group='none';renderOrganizer();follow=false;$('#followAudio').checked=false;if(!selected||!facetValues(selected,'page').includes(String(page)))selected=data.passages.find(p=>facetValues(p,'page').includes(String(page)))||null;renderSelection()}$('#readerScroll').scrollTop=0;if(view==='pdf')renderPDF();else renderTextPassages();renderNavigation();updateReturn();saveSession()}
function updateReturn(){
 if(!activePassage){$('#returnToAudio').hidden=true;return}
 const audioPage=playbackSourcePage(activePassage,player?.time??0);
 $('#returnToAudio').hidden=follow&&page===audioPage;
}
function followCurrent(){
 if(!activePassage)return;
 facets={};query='';filter='all';sort='source';group='none';scope='page';$('#search').value='';syncStudyFilters();renderOrganizer();renderTextPassages();renderNavigation();
 follow=true;$('#followAudio').checked=true;selected=activePassage;
 activeSentence=sentenceIdentity(activePassage,sentenceAt(activePassage,player?.time??0));
 const audioPage=playbackSourcePage(activePassage,player?.time??0);
 renderSelection();if(page!==audioPage)goPage(audioPage);else{updateHighlights();document.querySelector(`[data-passage-card="${activePassage.id}"]`)?.scrollIntoView({block:'center',behavior:'smooth'})}
 updateReturn();saveSession();
}
function onTime(time){
 text($('#currentTime'),formatTime(time));$('#seek').value=String(time);$('#seek').setAttribute('aria-valuetext',`${formatTime(time)} of ${formatTime(data.audio.duration)}`);
 const p=passageAt(data.passages,time),sentence=sentenceAt(p,time),nextSentence=sentenceIdentity(p,sentence);
 const passageChanged=p?.id!==activePassage?.id,sentenceChanged=nextSentence!==activeSentence;
 // Set both identities before rendering or page changes, whose media callbacks
 // can re-enter this function while a source-spanning passage is still active.
 activePassage=p;activeSentence=nextSentence;
 if(passageChanged||sentenceChanged){
  const audioPage=playbackSourcePage(p,time);
  text($('#nowTitle'),p?titleFor(p):data.title);text($('#nowMeta'),p?`Source page ${audioPage} · ${formatTime(p.start)}`:'Generated narration');
  if(follow&&p){selected=p;renderSelection();if(page!==audioPage)goPage(audioPage);else{updateHighlights();if(view==='text')document.querySelector(`[data-passage-card="${p.id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'})}}
  else updateHighlights();
  updateReturn();
 }else updateHighlights();
 if(Date.now()-lastSaved>1000){lastSaved=Date.now();saveSession()}
}
function onPlayerState(state){$('#playPause').setAttribute('aria-label',state.playing?'Pause audiobook':'Play audiobook');text($('#playPause'),state.playing?'Ⅱ':'▶');$('#playPause').classList.toggle('loading-audio',state.loading);updateHighlights()}
function movePassage(direction){if(!data||!player)return;const current=activePassage||selected||data.passages[0],index=data.passages.findIndex(p=>p.id===current.id),target=direction<0&&player.time-current.start>3?current:data.passages[Math.max(0,Math.min(data.passages.length-1,index+direction))];selectPassage(target,{play:true,show:follow})}
function toggleReader(){document.body.classList.toggle('reader-mode');$('#readerMode').setAttribute('aria-pressed',String(document.body.classList.contains('reader-mode')));saveSession();setTimeout(()=>renderPDF(),30)}

$('#menuButton').onclick=()=>openMenu(!$('#sidebar').classList.contains('open'));$('#closeMenu').onclick=$('#backdrop').onclick=()=>openMenu(false);$('#readerMode').onclick=toggleReader;
$('#search').addEventListener('input',event=>{query=event.target.value;beginBrowse()});all('[data-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.filter;syncStudyFilters();beginBrowse()});
$('#previousPage').onclick=()=>goPage(page-1,{manual:true});$('#nextPage').onclick=()=>goPage(page+1,{manual:true});$('#pageSelect').onchange=event=>goPage(event.target.value,{manual:true});$('#pdfView').onclick=()=>setView('pdf');$('#textView').onclick=()=>setView('text');$('#zoomOut').onclick=()=>{zoom=Math.max(.75,zoom-.25);renderPDF()};$('#zoomIn').onclick=()=>{zoom=Math.min(3,zoom+.25);renderPDF()};$('#fitPage').onclick=()=>{zoom=1;renderPDF()};
$('#playSelection').onclick=()=>selected&&selectPassage(selected,{play:true});$('#savePassage').onclick=()=>toggleTag('saved');$('#markStudied').onclick=()=>toggleTag('studied');$('#markReview').onclick=()=>toggleTag('review');
$('#playPause').onclick=()=>player?.toggle();$('#rewind').onclick=()=>player?.seek(player.time-10,{play:player.playing});$('#forward').onclick=()=>player?.seek(player.time+10,{play:player.playing});$('#previousPassage').onclick=()=>movePassage(-1);$('#nextPassage').onclick=()=>movePassage(1);$('#speed').onchange=event=>{player?.setRate(Number(event.target.value));saveSession()};$('#seek').addEventListener('input',event=>{player?.seek(Number(event.target.value),{play:player.playing});saveSession()});$('#repeatPassage').onclick=()=>{repeat=!repeat;$('#repeatPassage').setAttribute('aria-pressed',String(repeat));const p=selected||activePassage;player?.setRepeat(repeat&&p?{start:p.start,end:p.end}:null);if(repeat&&!p)toast('Choose a passage to repeat.')};$('#followAudio').onchange=event=>{follow=event.target.checked;if(follow)followCurrent();saveSession()};$('#returnToAudio').onclick=followCurrent;$('#compactPlayer').onclick=()=>{document.body.classList.toggle('compact-player');const compact=document.body.classList.contains('compact-player');text($('#compactPlayer'),compact?'Expand ↑':'Compact ↓');$('#compactPlayer').setAttribute('aria-expanded',String(!compact));saveSession();setTimeout(()=>renderPDF(),30)};
document.addEventListener('keydown',event=>{if(/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;if(event.key==='/'){event.preventDefault();openMenu(true)}if(event.key==='Escape'){openMenu(false);if(document.body.classList.contains('reader-mode'))toggleReader()}if(event.code==='Space'&&!event.target.closest('button,a')){event.preventDefault();player?.toggle()}if(event.key==='ArrowLeft'&&!event.target.closest('button,a')){event.preventDefault();player?.seek(player.time-10,{play:player.playing})}if(event.key==='ArrowRight'&&!event.target.closest('button,a')){event.preventDefault();player?.seek(player.time+10,{play:player.playing})}});
window.addEventListener('pagehide',saveSession);document.addEventListener('visibilitychange',()=>{if(document.hidden)saveSession()});const readerScroll=$('#readerScroll');let observedReaderWidth=readerScroll.clientWidth;new ResizeObserver(()=>{const width=readerScroll.clientWidth;if(Math.abs(width-observedReaderWidth)<1)return;observedReaderWidth=width;clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(view==='pdf')renderPDF()},200)}).observe(readerScroll);

async function init(){
 try{const response=await fetch(relativeURL('data/notes.json'));if(!response.ok)throw Error('Notes data could not load.');data=validateModel(await response.json());memory=migrateSession(memory,data);follow=memory.follow===true;const resumeTime=Number(memory.time)||0;for(const p of data.passages)byId.set(p.id,p);for(const chapter of data.chapters)byChapter.set(chapter.id,chapter);setupOrganizer();for(let n=1;n<=data.source.pages;n++){const option=document.createElement('option');option.value=String(n);text(option,`Page ${n} / ${data.source.pages}`);$('#pageSelect').append(option)}const audio=$('#audio');const audioURL=relativeURL(data.audio.url);audio.src=audioURL;$('#audioDownload')?.setAttribute('href',audioURL);player=new NotesPlayer(audio,{duration:data.audio.duration,onState:onPlayerState,onTime,onError:toast});$('#seek').max=String(data.audio.duration);text($('#durationTime'),formatTime(data.audio.duration));for(const chapter of data.chapters.slice(1)){const mark=document.createElement('i');mark.style.left=(chapter.start/data.audio.duration*100)+'%';$('#chapterMarkers').append(mark)}const rate=[.75,1,1.25,1.5,1.75,2].includes(Number(memory.rate))?Number(memory.rate):1;$('#speed').value=String(rate);player.setRate(rate);$('#followAudio').checked=follow;selected=byId.get(memory.selected)||data.passages.find(p=>p.page===page&&!p.isNarrationCue)||null;renderSelection();document.body.classList.toggle('reader-mode',memory.readerMode===true);$('#readerMode').setAttribute('aria-pressed',String(memory.readerMode===true));document.body.classList.toggle('compact-player',memory.compact===true);text($('#compactPlayer'),memory.compact?'Expand ↑':'Compact ↓');setView(view);goPage(page);if(resumeTime>0)player.restore(Math.min(resumeTime,data.audio.duration-.1));
 const params=new URLSearchParams(location.search),linked=byId.get(params.get('passage'));if(linked)selectPassage(linked,{show:true});
 // Read-only QA surface: metadata only, never credentials or private host paths.
 window.notesDesk={get state(){return{page,view,selected:selected?.id,activePassage:activePassage?.id,activeSentence,time:player.time,playing:player.playing,follow,facets:structuredClone(facets),sort,group,scope,matches:matches().length,audioVersion:memory.audioVersion}},get counts(){return{passages:data.passages.length,chapters:data.chapters.length,pages:data.source.pages,mappedPassages:data.passages.filter(p=>p.rects?.length).length}}};
 }catch(error){text($('#notesError'),'The notes could not load. Please refresh, or open the original PDF. Audio remains available using the download link.');$('#notesError').hidden=false;$('#pdfLoading').hidden=true;text($('#navCount'),'Notes unavailable');console.error('Notes loading failed:',error.message)}
}
init();
