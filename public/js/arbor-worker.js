/* FlowDesk Arbor import worker: keeps XLSX/JSZip work off the UI thread. */
'use strict';

const XLSX_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

function progress(value, message) {
  self.postMessage({ type: 'progress', value, message });
}

function normaliseHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normaliseBoolean(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return false;
  const negatives = ['0', 'false', 'no', 'n', 'none', 'not eligible', 'not current', 'not pupil premium', 'not pp', 'not fsm', 'not eligible for free school meals', 'not eligible for fsm', 'no special educational need', 'no sen', 'no send', 'not sen', 'not send'];
  if (negatives.includes(raw)) return false;
  return ['1', 'true', 'yes', 'y', 'eligible', 'current', 'k', 'e', 's'].includes(raw) || raw.length > 0;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseClassCodes(value) {
  const raw = String(value ?? '').replace(/\u00a0/g, ' ').trim();
  if (!raw) return [];

  // Arbor exports commonly contain: "English: Year 10: 10a/En1 (2026/2027), ..."
  // Prefer explicit short-code matches before using a conservative last-colon fallback.
  const direct = [...raw.matchAll(/\b\d{1,2}[A-Za-z0-9]{0,5}\/[A-Za-z][A-Za-z0-9._-]{0,15}\b/g)].map(match => match[0].trim());
  if (direct.length) return unique(direct);

  const fallback = [];
  raw.split(/[,;\n|]+/).forEach(section => {
    let candidate = String(section || '').trim();
    if (!candidate) return;
    candidate = candidate.split(':').pop().trim();
    candidate = candidate.replace(/\([^)]*\)/g, '').trim();
    if (!candidate || /^year\s*\d+/i.test(candidate)) return;
    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(candidate)) fallback.push(candidate);
  });
  return unique(fallback);
}

function resolveZipTarget(drawingPath, target) {
  const rawTarget = String(target || '').replace(/\\/g, '/').replace(/^\//, '');
  if (!rawTarget) return '';
  const parts = drawingPath.split('/');
  parts.pop();
  rawTarget.split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') parts.pop();
    else parts.push(part);
  });
  return parts.join('/');
}

function mimeForPath(path) {
  const ext = String(path).split('.').pop().toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'bmp') return 'image/bmp';
  return 'image/jpeg';
}

async function extractImages(arrayBuffer, fileName) {
  if (!/\.xlsx$/i.test(fileName || '')) return {};
  progress(32, 'Reading embedded profile photos…');
  const zip = await self.JSZip.loadAsync(arrayBuffer);
  const drawingPaths = Object.keys(zip.files).filter(name => /^xl\/drawings\/drawing\d+\.xml$/i.test(name));
  const imageByRow = {};
  let anchorsProcessed = 0;

  for (let drawingIndex = 0; drawingIndex < drawingPaths.length; drawingIndex += 1) {
    const drawingPath = drawingPaths[drawingIndex];
    const fileNameOnly = drawingPath.split('/').pop();
    const relPath = `xl/drawings/_rels/${fileNameOnly}.rels`;
    const drawingFile = zip.file(drawingPath);
    const relFile = zip.file(relPath);
    if (!drawingFile || !relFile) continue;

    const [drawingText, relText] = await Promise.all([drawingFile.async('text'), relFile.async('text')]);
    const relations = {};
    for (const tag of relText.matchAll(/<Relationship\b[^>]*>/gi)) {
      const idMatch = tag[0].match(/\bId="([^"]+)"/i);
      const targetMatch = tag[0].match(/\bTarget="([^"]+)"/i);
      if (!idMatch || !targetMatch) continue;
      relations[idMatch[1]] = resolveZipTarget(drawingPath, targetMatch[1]);
    }

    const anchors = drawingText.split(/<xdr:(?:twoCellAnchor|oneCellAnchor)\b[^>]*>/i).slice(1);
    for (const anchor of anchors) {
      const rowMatch = anchor.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:from>/i);
      const embedMatch = anchor.match(/<a:blip\b[^>]*\br:embed="([^"]+)"/i);
      if (!rowMatch || !embedMatch) continue;
      const imagePath = relations[embedMatch[1]];
      const imageFile = imagePath ? zip.file(imagePath) : null;
      if (!imageFile) continue;
      const base64 = await imageFile.async('base64');
      imageByRow[Number(rowMatch[1])] = `data:${mimeForPath(imagePath)};base64,${base64}`;
      anchorsProcessed += 1;
      if (anchorsProcessed % 20 === 0) {
        const pct = Math.min(72, 38 + Math.round((drawingIndex + 1) / Math.max(1, drawingPaths.length) * 30));
        progress(pct, `Extracted ${anchorsProcessed} profile photos…`);
      }
    }
  }
  return imageByRow;
}

function locateColumns(rows) {
  const headerAliases = new Set(['name', 'student name', 'legal name', 'first name', 'legal forename', 'forename']);
  let headerIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 80); i += 1) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    if (row.some(cell => headerAliases.has(normaliseHeader(cell)))) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) throw new Error('Could not find the Arbor student header row. Check that this is the master student export.');

  const headers = rows[headerIndex].map(normaliseHeader);
  const find = aliases => headers.findIndex(header => aliases.some(alias => header === alias || header.includes(alias)));
  return {
    headerIndex,
    columns: {
      name: find(['student name', 'legal name', 'full name', 'name']),
      first: find(['first name', 'legal forename', 'forename']),
      last: find(['last name', 'legal surname', 'surname']),
      year: find(['year group', 'year']),
      classes: find(['courses classes', 'courses class', 'classes', 'class memberships', 'class']),
      gender: find(['gender', 'sex']),
      id: find(['upn', 'student id', 'pupil id', 'external id', 'id']),
      sen: find(['sen status', 'send status', 'sen']),
      pp: find(['pupil premium', 'pp']),
      fsm: find(['free school meals', 'fsm']),
      cat: find(['cat mean', 'cat score', 'cat'])
    }
  };
}

function buildRoster(rows, imageByRow) {
  const { headerIndex, columns } = locateColumns(rows);
  const roster = [];
  const allClasses = new Set();

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = Array.isArray(rows[index]) ? rows[index] : [];
    if (!row.length) continue;

    let name = columns.name >= 0 ? String(row[columns.name] ?? '').trim() : '';
    const first = columns.first >= 0 ? String(row[columns.first] ?? '').trim() : '';
    const last = columns.last >= 0 ? String(row[columns.last] ?? '').trim() : '';
    if (!name && (first || last)) name = [first, last].filter(Boolean).join(' ');
    if (!name) continue;

    const rawId = columns.id >= 0 ? String(row[columns.id] ?? '').trim() : '';
    const id = rawId || `local-${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const gender = columns.gender >= 0 ? String(row[columns.gender] ?? '').trim() : '';
    const classList = columns.classes >= 0 ? parseClassCodes(row[columns.classes]) : [];
    classList.forEach(code => allClasses.add(code));

    roster.push({
      id,
      externalRef: id,
      name,
      firstName: first,
      surname: last,
      year: columns.year >= 0 ? String(row[columns.year] ?? '').trim() : '',
      yearGroup: columns.year >= 0 ? String(row[columns.year] ?? '').trim() : '',
      classes: classList.join(', '),
      classList,
      gender,
      sex: gender,
      sen: columns.sen >= 0 ? normaliseBoolean(row[columns.sen]) : false,
      pp: columns.pp >= 0 ? normaliseBoolean(row[columns.pp]) : false,
      fsm: columns.fsm >= 0 ? normaliseBoolean(row[columns.fsm]) : false,
      catMean: columns.cat >= 0 ? String(row[columns.cat] ?? '').trim() : '',
      photo: imageByRow[index] || null
    });
  }

  if (!roster.length) throw new Error('No student rows were found in the Arbor spreadsheet.');
  return { roster, classCount: allClasses.size };
}

self.onmessage = async event => {
  const { arrayBuffer, fileName } = event.data || {};
  try {
    progress(8, 'Starting Arbor import…');
    importScripts(XLSX_CDN, JSZIP_CDN);
    if (!self.XLSX || !self.JSZip) throw new Error('Excel import libraries could not be loaded.');

    progress(16, 'Parsing student rows…');
    const workbook = self.XLSX.read(arrayBuffer, { type: 'array', cellDates: false, dense: false });
    if (!workbook.SheetNames?.length) throw new Error('The spreadsheet contains no worksheets.');
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = self.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: true });
    progress(28, `Read ${Math.max(0, rows.length - 1)} spreadsheet rows…`);

    const imageByRow = await extractImages(arrayBuffer, fileName);
    progress(78, 'Matching student data to classes…');
    const { roster, classCount } = buildRoster(rows, imageByRow);
    progress(88, 'Preparing local FlowDesk roster…');

    self.postMessage({
      type: 'done',
      roster,
      photoCount: Object.keys(imageByRow).length,
      classCount
    });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'Arbor import failed.' });
  }
};
