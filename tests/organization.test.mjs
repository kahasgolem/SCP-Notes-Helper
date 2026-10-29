import test from 'node:test';
import assert from 'node:assert/strict';
import {filteredPassages,facetCounts,facetValues,sortPassages,groupPassages,sentenceAt,playbackSourcePage,migrateSession,validateModel} from '../public/model.js';

const passages=[
 {id:'a',page:3,sourceOrder:3001,start:0,end:12,sourceText:'A conditional rule with its exception.',section:'Obligation',category:'Challah',topics:['Dough','Shabbos'],authorities:['Shulchan Aruch','Rambam'],statementTypes:['rule','exception'],sourceSpans:[{page:3,text:'A conditional rule'},{page:4,text:'with its exception.'}],classifications:{obligation:[{value:'biblical',status:'explicit',context:'Only in the stated case'}],ruling:[{value:'strict',status:'explicit'}]},sentenceTimings:[{id:'a.1',text:'A conditional rule.',start:0,end:5},{id:'a.2',text:'With its exception.',start:5,end:12}]},
 {id:'b',page:4,sourceOrder:4001,start:12,end:22,sourceText:'A different opinion.',section:'Obligation',category:'Challah',topics:['Dough'],authorities:['Rambam'],statementTypes:['opinion'],classifications:{obligation:[{value:'rabbinic',status:'explicit'}],ruling:[{value:'lenient',status:'derived'}]}},
 {id:'c',page:5,sourceOrder:5001,start:22,end:32,sourceText:'A question without a stated ruling.',section:'Questions',category:'Study',topics:['Shabbos'],authorities:[],statementTypes:['question'],classifications:{obligation:[{value:'uncertain',status:'uncertain'}],ruling:[{value:'not-applicable',status:'not-applicable'}]}}
];
const data={passages,audio:{duration:32,version:'new-audio'},idMigration:{oldA:['a'],oldB:['a','b']}};

test('multi-tag filters use OR within a facet and AND across facets',()=>{
 assert.deepEqual(filteredPassages(passages,{facets:{topic:['Dough','Shabbos'],authority:['Rambam']}}).map(p=>p.id),['a','b']);
 assert.deepEqual(filteredPassages(passages,{facets:{topic:['Shabbos'],authority:['Rambam'],ruling:['strict']}}).map(p=>p.id),['a']);
 assert.equal(filteredPassages(passages,{facets:{authority:['Rambam'],type:['question']}}).length,0);
});
test('search, bookmarks and metadata facets compose without mutating source records',()=>{
 const before=structuredClone(passages);
 assert.deepEqual(filteredPassages(passages,{query:'DIFFERENT OPINION',filter:'saved',saved:['a','b'],facets:{authority:['Rambam']}}).map(p=>p.id),['b']);
 assert.deepEqual(passages,before);
});
test('facet counts ignore their own selection but retain other active facets',()=>{
 const counts=facetCounts(passages,{facets:{topic:['Shabbos'],authority:['Rambam']}});
 assert.equal(counts.topic.find(item=>item.value==='Dough').count,2);
 assert.equal(counts.topic.find(item=>item.value==='Shabbos').count,1);
 assert.equal(counts.authority.find(item=>item.value==='Rambam').count,1);
});
test('active zero-result tags remain present and removable',()=>{
 const counts=facetCounts(passages,{facets:{topic:['Does not exist'],authority:['Rambam']}});
 assert.deepEqual(counts.topic.find(item=>item.value==='Does not exist'),{value:'Does not exist',count:0});
});
test('source page facet includes every page of a qualified cross-page passage',()=>{
 assert.deepEqual(facetValues(passages[0],'page'),['3','4']);
 assert.deepEqual(filteredPassages(passages,{facets:{page:['4']}}).map(p=>p.id),['a','b']);
});
test('contextual uncertainty and missing metadata never imply a practical ruling',()=>{
 assert.deepEqual(facetValues(passages[2],'obligation'),['Uncertain']);
 assert.deepEqual(facetValues(passages[2],'ruling'),['Not applicable']);
 assert.deepEqual(facetValues(passages[2],'authority'),['Unclassified']);
});
test('a canonical metadata section unifies organization and search without changing literal source labels',()=>{
 const original={...passages[0],section:'F. Amount of Dough Required',metadataSection:'F. Amount of Dough Needed to be Mafrish'};
 const before=structuredClone(original);
 assert.deepEqual(facetValues(original,'section'),['F. Amount of Dough Needed to be Mafrish']);
 assert.deepEqual(filteredPassages([original],{facets:{section:['F. Amount of Dough Needed to be Mafrish']}}),[original]);
 assert.deepEqual(filteredPassages([original],{query:'dough needed to be mafrish'}),[original]);
 assert.deepEqual(original,before);
});
test('metadata sorting is stable and never changes the chronological playback array',()=>{
 const order=passages.map(p=>p.id);
 const result=sortPassages(passages,'authority');
 assert.deepEqual(result.map(p=>p.id),['a','b','c']);
 assert.deepEqual(passages.map(p=>p.id),order);
 assert.notEqual(result,passages);
});
test('multi-valued grouping displays each passage exactly once with source tie breaks',()=>{
 const groups=groupPassages(sortPassages(passages,'source'),'topic');
 assert.deepEqual(groups.map(group=>[group.key,group.passages.map(p=>p.id)]),[['Dough',['a','b']],['Shabbos',['c']]]);
 assert.equal(groups.flatMap(group=>group.passages).length,passages.length);
});
test('sentence selection follows measured boundaries without estimating words',()=>{
 assert.equal(sentenceAt(passages[0],4.99).id,'a.1');
 assert.equal(sentenceAt(passages[0],5).id,'a.2');
 assert.equal(sentenceAt(passages[0],12),null);
 assert.equal(sentenceAt(passages[1],15),null);
});
test('a cross-page paragraph follows measured sentence source pages within the same stable passage',()=>{
 const passage={id:'spanning',page:3,start:0,end:12,sourceSpans:[{page:3},{page:4}],sentenceTimings:[{id:'spanning.1',start:0,end:5,sourcePage:3},{id:'spanning.2',start:5,end:12,sourcePage:4}]};
 assert.equal(playbackSourcePage(passage,0),3);
 assert.equal(playbackSourcePage(passage,4.999),3);
 assert.equal(playbackSourcePage(passage,5),4);
 assert.equal(playbackSourcePage(passage,11.999),4);
 assert.equal(sentenceAt(passage,4.999).id,'spanning.1');
 assert.equal(sentenceAt(passage,5).id,'spanning.2');
 assert.equal(passage.id,'spanning');
});
test('source-page following falls back honestly when no measured sentence page is available',()=>{
 assert.equal(playbackSourcePage(passages[0],0),3);
 assert.equal(playbackSourcePage(passages[0],12),3);
 assert.equal(playbackSourcePage({...passages[0],sentenceTimings:[{start:0,end:12,sourcePage:0}]},4),3);
 assert.equal(playbackSourcePage(null,0),undefined);
});
test('bookmark migration preserves all known successor passages',()=>{
 const migrated=migrateSession({saved:['oldA','oldB','missing'],studied:['b'],review:['oldB'],selected:'oldA',time:999},data);
 assert.deepEqual(migrated.saved,['a','b']);assert.deepEqual(migrated.studied,['b']);assert.deepEqual(migrated.review,['a','b']);assert.equal(migrated.selected,'a');assert.equal(migrated.time,0);
});
test('a regenerated audio version cannot resume at an old raw timestamp',()=>{
 const migrated=migrateSession({selected:'b',time:21,follow:true,audioVersion:'old-audio'},data);
 assert.equal(migrated.time,12);assert.equal(migrated.follow,false);assert.equal(migrated.audioVersion,'new-audio');
 const current=migrateSession({selected:'b',time:17,audioVersion:'new-audio'},data);assert.equal(current.time,17);
});
test('unmapped legacy marks retain raw IDs and their original audio edition without false new bookmarks',()=>{
 const memory={audioVersion:'old-audio',saved:['oldA','unmapped-schedule'],studied:['unmapped-scan'],review:['missing'],legacyMarks:{saved:[{id:'earlier-mark',audioVersion:'earlier-edition'}],studied:[],review:[{id:'missing',audioVersion:'old-audio'}]}};
 const before=structuredClone(memory),migrated=migrateSession(memory,data);
 assert.deepEqual(migrated.saved,['a']);assert.deepEqual(migrated.studied,[]);assert.deepEqual(migrated.review,[]);
 assert.deepEqual(migrated.legacyMarks.saved,[{id:'earlier-mark',audioVersion:'earlier-edition'},{id:'unmapped-schedule',audioVersion:'old-audio'}]);
 assert.deepEqual(migrated.legacyMarks.studied,[{id:'unmapped-scan',audioVersion:'old-audio'}]);
 assert.deepEqual(migrated.legacyMarks.review,[{id:'missing',audioVersion:'old-audio'}]);
 const again=migrateSession(migrated,data);assert.deepEqual(again.legacyMarks,migrated.legacyMarks);
 assert.deepEqual(memory,before);
});
test('unversioned v1 marks and previously stored raw legacy IDs retain a recognizable original edition',()=>{
 const migrated=migrateSession({saved:['missing'],legacyMarks:{saved:['earlier-mark']}},data);
 assert.deepEqual(migrated.legacyMarks.saved,[{id:'earlier-mark',audioVersion:'scp-challah-notes-v1'},{id:'missing',audioVersion:'scp-challah-notes-v1'}]);
});
test('timing validation rejects overlapping or out-of-passage sentence boundaries',()=>{
 assert.equal(validateModel(data),data);
 const overlapping=structuredClone(data);overlapping.passages[0].sentenceTimings[1].start=4;assert.throws(()=>validateModel(overlapping));
 const outside=structuredClone(data);outside.passages[0].sentenceTimings[1].end=13;assert.throws(()=>validateModel(outside));
});
