import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateModel } from '../public/model.js';

// Explicit immutable inputs; this script never edits the first release or source audio.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'v2', 'dist');
const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, all) => {
  if (value.startsWith('--')) out.push([value.slice(2), all[index + 1]]);
  return out;
}, []));
for (const key of ['model', 'timings', 'audio']) if (!args[key] || args[key].startsWith('--')) throw Error('required_argument_' + key);
const resolveInput = value => path.resolve(root, value);
const modelPath = resolveInput(args.model), timingPath = resolveInput(args.timings), audioPath = resolveInput(args.audio);
if (existsSync(out)) throw Error('v2_dist_already_exists_preserve_and_review_before_rebuild');
const raw = validateModel(JSON.parse(readFileSync(modelPath, 'utf8')));
const timing = JSON.parse(readFileSync(timingPath, 'utf8'));
const audioBytes = readFileSync(audioPath), sha = value => createHash('sha256').update(value).digest('hex');
const audioHash = sha(audioBytes), audioRelative = 'audio/' + audioHash.slice(0, 16) + '.mp3';
if (path.extname(audioPath).toLowerCase() !== '.mp3' || audioBytes.length < 1000000 || audioBytes.length > 536870912) throw Error('invalid_new_audio');
if (raw.schemaVersion < 2 || !raw.passages.every(p => p.id?.startsWith('hc2-') && p.sourceText && p.narrationText)) throw Error('semantic_passage_model_required');
const declaredHash = timing.audio?.sha256 || timing.audioSha256;
if (declaredHash && declaredHash !== audioHash) throw Error('timing_audio_hash_mismatch');
if (raw.audio.sha256 && raw.audio.sha256 !== audioHash) throw Error('model_audio_hash_mismatch');
if (raw.audio.version !== audioHash || timing.audio?.version !== audioHash) throw Error('audio_version_must_be_final_sha256');
if (!raw.source.pdfLocalPath || !existsSync(raw.source.pdfLocalPath)) throw Error('original_pdf_path_missing');
const passageFields = ['id', 'chapterId', 'page', 'sourcePages', 'sourceOrder', 'text', 'spokenText', 'sourceText', 'displayText', 'narrationText', 'textKind', 'isNarrationCue', 'lang', 'start', 'end', 'rects', 'mapping', 'section', 'subsection', 'category', 'subcategory', 'topics', 'authorities', 'authorityRole', 'statementTypes', 'conditions', 'sourceCitations', 'parentId', 'relatedIds', 'sourceSpans', 'classifications', 'metadataEvidence', 'reviewStatus', 'sentenceTimings', 'narrationMapping', 'pronunciationNormalization', 'legacyIds', 'contextIds', 'opinionRelationships', 'sourceIncomplete', 'sourceNote', 'sourceTextSha256', 'narrationTextSha256', 'previousSourceId', 'nextSourceId', 'isFootnote', 'footnoteNumber'];
passageFields.push('sourceIssues', 'contextSubsection', 'metadataSubsection', 'metadataSection', 'startFrame', 'endFrame');
const passages = raw.passages.map(p => Object.fromEntries(passageFields.filter(key => p[key] !== undefined).map(key => [key, p[key]])));
const publicAudio = { ...raw.audio, file: audioRelative, url: audioRelative, sha256: audioHash, bytes: audioBytes.length, version: audioHash, timingManifestUrl: 'data/timing-manifest.json' };
for (const key of ['localPath', 'mp3LocalPath', 'path', 'wavPath', 'filePath']) delete publicAudio[key];
const notes = {
  schemaVersion: raw.schemaVersion,
  title: raw.title,
  program: raw.program || { name: 'Semichas Chaver Program', zman: 'Winter 2026', subjects: ['Hafrashas Challah', "Terumos Uma'asros"], currentMaterial: 'Hafrashas Challah class notes' },
  audio: publicAudio,
  source: { pages: raw.source.pages, pdfUrl: 'source.pdf', fileName: raw.source.fileName, sha256: raw.source.sha256, blankPages: raw.source.blankPages, narrationPageOrder: raw.source.narrationPageOrder },
  chapters: raw.chapters, pages: raw.pages, passages,
  alignment: raw.alignment,
  migration: raw.migration,
  metadata: raw.metadata,
  schema: raw.schema
};
const semantic = { schemaVersion: notes.schemaVersion, source: notes.source, program: notes.program, metadata: notes.metadata, records: passages.map(p => Object.fromEntries(Object.entries(p).filter(([key]) => !['start', 'end', 'sentenceTimings'].includes(key)))) };
const sourcePassages = new Map(raw.passages.map(p => [p.id, p]));
const publicTiming = { ...timing, audio: { ...timing.audio, file: audioRelative, url: audioRelative, sha256: audioHash, bytes: audioBytes.length, version: audioHash },
  sourceBinding: { sourcePdfSha256: raw.source.sha256, semanticVersion: raw.metadata?.semanticVersion, preparedSemanticInputSha256: timing.sourceHash, scriptHash: timing.scriptHash },
  passages: timing.passages.map(p => {
    const source = sourcePassages.get(p.id);
    if (!source || p.startFrame !== source.startFrame || p.endFrame !== source.endFrame) throw Error('source_timing_passage_mismatch');
    const sentences = new Map(source.sentenceTimings.map(s => [s.id, s]));
    return { ...p, sourcePages: source.sourcePages, sentenceTimings: p.sentenceTimings.map(s => {
      const enriched = sentences.get(s.id);
      if (!enriched || s.startFrame !== enriched.startFrame || s.endFrame !== enriched.endFrame) throw Error('source_timing_sentence_mismatch');
      return { ...s, ...Object.fromEntries(['sourceStart','sourceEnd','sourcePage','sourcePages','sourceSpanIds','sourceText','sourceMapping'].filter(k=>enriched[k]!==undefined).map(k=>[k,enriched[k]])) };
    }) };
  }) };
const forbidden = /(?:[A-Z]:[\\/]+(?:Users|Windows)|file:\/\/\/|oauth_token|refresh_token|secretAccessKey|accessKeyId|pdfLocalPath)/i;
for (const [name, value] of Object.entries({ notes, semantic, timing: publicTiming })) if (forbidden.test(JSON.stringify(value))) throw Error('private_data_in_' + name);

const inputFiles = [];
function walk(dir, prefix = '') {
  for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.name.startsWith('.')) throw Error('hidden_public_file');
    const file = path.join(dir, item.name), relative = prefix + item.name;
    if (lstatSync(file).isSymbolicLink()) throw Error('linked_public_file');
    if (item.isDirectory()) walk(file, relative + '/');
    else inputFiles.push({ path: relative, sha256: sha(readFileSync(file)) });
  }
}
walk(path.join(root, 'public'));
const release = sha(JSON.stringify({ inputFiles, notes, semantic, publicTiming, audioHash })).slice(0, 16);
notes.release = { id: release, audioVersion: publicAudio.version };
semantic.release = notes.release;
publicTiming.release = notes.release;
mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'public'), out, { recursive: true });
mkdirSync(path.join(out, 'data'), { recursive: true });
mkdirSync(path.join(out, 'audio'), { recursive: true });
const htmlPath = path.join(out, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
if (/<base\b/i.test(html)) throw Error('unexpected_existing_base_element');
const pinnedHtml = html.replace(/<head(?:\s[^>]*)?>/i, match => match + '\n  <base href="/notes/releases/' + release + '/">')
  .replace(/(<a\b[^>]*\bid="audioDownload"[^>]*\bhref=")[^"]*(")/, (_, before, after) => before + audioRelative + after);
writeFileSync(htmlPath, pinnedHtml);
writeFileSync(path.join(out, 'data', 'notes.json'), JSON.stringify(notes) + '\n');
writeFileSync(path.join(out, 'data', 'semantic-notes.json'), JSON.stringify(semantic) + '\n');
writeFileSync(path.join(out, 'data', 'timing-manifest.json'), JSON.stringify(publicTiming) + '\n');
writeFileSync(path.join(out, 'release.json'), JSON.stringify({ schemaVersion: 2, release, audioVersion: publicAudio.version, audioSha256: audioHash, timingManifest: 'data/timing-manifest.json' }) + '\n');
cpSync(audioPath, path.join(out, audioRelative));
cpSync(raw.source.pdfLocalPath, path.join(out, 'source.pdf'));
const files = [];
function reportWalk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) reportWalk(file);
    else { const bytes = readFileSync(file); files.push({ path: path.relative(out, file).split(path.sep).join('/'), bytes: bytes.length, sha256: sha(bytes) }); }
  }
}
reportWalk(out);
const report = { schemaVersion: 2, directory: out, release, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), audio: { relative: audioRelative, sha256: audioHash, bytes: audioBytes.length, duration: raw.audio.duration }, passages: passages.length, sourcePages: raw.source.pages, originalReleasePreserved: existsSync(path.join(root, 'dist', 'index.html')), manifest: files };
writeFileSync(path.join(root, 'v2', 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, manifest: undefined }, null, 2));
