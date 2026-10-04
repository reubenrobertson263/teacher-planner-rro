(function (root) {
  'use strict';
  const NS = { p: 'http://schemas.openxmlformats.org/presentationml/2006/main', a: 'http://schemas.openxmlformats.org/drawingml/2006/main', r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', rel: 'http://schemas.openxmlformats.org/package/2006/relationships', ct: 'http://schemas.openxmlformats.org/package/2006/content-types' };
  const all = (node, ns, name) => [...node.getElementsByTagNameNS(ns, name)];
  const parse = raw => {
    const doc = new DOMParser().parseFromString(raw, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('This template contains invalid PowerPoint XML.');
    return doc;
  };
  const xml = doc => new XMLSerializer().serializeToString(doc);
  const slideTarget = (base, target) => {
    const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
    for (const part of target.split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); }
    return parts.join('/');
  };
  const text = shape => all(shape, NS.a, 't').map(n => n.textContent).join('\n');
  const titleFor = content => {
    const clean = String(content).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}_]+/gu, ' ').trim();
    return root.LessonModel.phases.find(phase => clean === phase.toLowerCase() || clean.includes(phase.toLowerCase())) || null;
  };
  async function readDeck(buffer, Zip = root.JSZip) {
    if (!Zip) throw new Error('PowerPoint template support could not load. Refresh and retry.');
    if (buffer.byteLength > 21 * 1024 * 1024) throw new Error('Choose a template smaller than 21 MB.');
    const archive = await Zip.loadAsync(buffer);
    if (Object.keys(archive.files).length > 5000) throw new Error('The template contains too many parts.');
    const presentation = parse(await archive.file('ppt/presentation.xml')?.async('string'));
    const relationships = parse(await archive.file('ppt/_rels/presentation.xml.rels')?.async('string'));
    const rels = new Map(all(relationships, NS.rel, 'Relationship').map(r => [r.getAttribute('Id'), slideTarget('ppt/presentation.xml', r.getAttribute('Target'))]));
    const order = all(presentation, NS.p, 'sldId');
    if (order.length < 6 || order.length > 50) throw new Error('A BCHS template needs a cover and five phase slides (6–50 slides total).');
    const phasePaths = new Map(); const bodyPaths = new Map(); let coverPath = null;
    for (let i = 0; i < order.length; i++) {
      const id = order[i].getAttributeNS(NS.r, 'id'); const path = rels.get(id); if (!path) continue;
      const slide = parse(await archive.file(path)?.async('string'));
      const shapes = all(slide, NS.p, 'sp');
      const visibleText = shapes.map(text).filter(Boolean);
      const phase = visibleText.map(titleFor).find(Boolean);
      if (i === 0) coverPath = path;
      if (phase && !phasePaths.has(phase)) {
        phasePaths.set(phase, path);
        const body = shapes.find(shape => /add text here/i.test(text(shape))) || shapes.find(shape => {
          const ph = all(shape, NS.p, 'ph')[0];
          return ph && ['body', 'obj'].includes(ph.getAttribute('type'));
        });
        if (!body) throw new Error(`The ${phase} template slide needs an editable text box. Add “Add text here” to its body box, then upload it again.`);
        bodyPaths.set(phase, true);
      }
    }
    const missing = root.LessonModel.phases.filter(phase => !phasePaths.has(phase));
    if (!coverPath || missing.length) throw new Error(`Template must include a cover and a labelled slide for each phase. Missing: ${missing.join(', ')}.`);
    return { archive, presentation, relationships, coverPath, phasePaths, bodyPaths };
  }
  async function inspect(buffer, Zip) {
    const deck = await readDeck(buffer, Zip);
    return { slides: deck.phasePaths.size + 1, phases: [...deck.phasePaths.keys()], bytes: buffer.byteLength };
  }
  function setShapeText(shape, value) {
    const body = all(shape, NS.p, 'txBody')[0];
    if (!body) return false;
    const paragraphs = all(body, NS.a, 'p');
    if (!paragraphs.length) return false;
    const templates = paragraphs.filter(p => all(p, NS.a, 't').length);
    if (!templates.length) templates.push(paragraphs[0]);
    const bodyNode = paragraphs[0].parentNode;
    const rows = String(value).split('\n');
    if (rows.length > 80) throw new Error('A text box has more than 80 lines. Shorten the text before exporting.');
    for (const p of paragraphs) bodyNode.removeChild(p);
    for (let index = 0; index < (rows.length || 1); index++) {
      const line = rows[index] ?? '';
      const p = templates[Math.min(index, templates.length - 1)].cloneNode(true);
      const runs = all(p, NS.a, 'r');
      if (runs.length) {
        const chosen = runs[0], first = all(chosen, NS.a, 't')[0];
        if (first) first.textContent = line;
        else { const node = p.ownerDocument.createElementNS(NS.a, 'a:t'); node.textContent = line; chosen.appendChild(node); }
        // Keep the original run formatting/hyperlink metadata, but remove its old words.
        for (const run of runs.slice(1)) for (const node of all(run, NS.a, 't')) node.textContent = '';
        for (const node of all(p, NS.a, 'br')) node.parentNode.removeChild(node);
      } else {
        let run = all(p, NS.a, 'fld')[0];
        if (run) run.parentNode.removeChild(run);
        run = p.ownerDocument.createElementNS(NS.a, 'a:r');
        const props = p.ownerDocument.createElementNS(NS.a, 'a:rPr'); run.appendChild(props);
        const node = p.ownerDocument.createElementNS(NS.a, 'a:t'); node.textContent = line; run.appendChild(node);
        const end = all(p, NS.a, 'endParaRPr')[0]; p.insertBefore(run, end || null);
      }
      bodyNode.appendChild(p);
    }
    return true;
  }
  function fillSlide(source, item, slideHeight) {
    const doc = parse(source);
    const shapes = all(doc, NS.p, 'sp');
    const heading = shapes.map(shape => ({ shape, value: text(shape) })).find(entry => titleFor(entry.value) === item.phase);
    const placeholder = shapes.find(shape => /add text here/i.test(text(shape))) || shapes.find(shape => {
      const ph = all(shape, NS.p, 'ph')[0];
      return ph && ['body', 'obj'].includes(ph.getAttribute('type'));
    });
    if (!heading || !placeholder || placeholder === heading.shape) throw new Error(`The ${item.phase} template slide needs its phase heading and an editable body placeholder such as “Add text here”.`);
    const content = `${item.title && item.title !== item.phase ? item.title + '\n' : ''}${item.content || ''}`;
    if (!setShapeText(placeholder, content)) throw new Error(`Could not fill the ${item.phase} body placeholder.`);
    expandBodyBox(doc, placeholder, slideHeight);
    return xml(doc);
  }
  function expandBodyBox(doc, shape, slideHeight) {
    if (!Number.isFinite(slideHeight) || slideHeight <= 0) return;
    const xfrm = all(shape, NS.a, 'xfrm')[0];
    const off = xfrm && all(xfrm, NS.a, 'off')[0];
    const ext = xfrm && all(xfrm, NS.a, 'ext')[0];
    if (!off || !ext) return;
    const top = Number(off.getAttribute('y'));
    const current = Number(ext.getAttribute('cy'));
    if (!Number.isFinite(top) || !Number.isFinite(current) || current <= 0) return;
    const obstacles = [...all(doc, NS.p, 'sp'), ...all(doc, NS.p, 'pic'), ...all(doc, NS.p, 'graphicFrame')]
      .filter(item => item !== shape)
      .map(item => {
        const transform = all(item, NS.a, 'xfrm')[0] || all(item, NS.p, 'xfrm')[0];
        const position = transform && (all(transform, NS.a, 'off')[0] || all(transform, NS.p, 'off')[0]);
        const extent = transform && (all(transform, NS.a, 'ext')[0] || all(transform, NS.p, 'ext')[0]);
        return { top: Number(position?.getAttribute('y')), height: Number(extent?.getAttribute('cy')) };
      })
      .filter(box => Number.isFinite(box.top) && box.top > top + current / 2 && Number.isFinite(box.height) && box.height < slideHeight * 0.75)
      .map(box => box.top);
    const safeBottom = obstacles.length
      ? Math.min(...obstacles) - slideHeight * 0.025
      : slideHeight * 0.90;
    const available = Math.min(slideHeight * 0.62, safeBottom - top);
    if (available > current) ext.setAttribute('cy', String(Math.round(available)));
  }
  function fillCover(source, title) {
    const doc = parse(source);
    const shapes = all(doc, NS.p, 'sp');
    const heading = shapes.find(shape => /lesson\s*structure/i.test(text(shape))) || shapes.find(shape => all(shape, NS.a, 't').length);
    if (!heading || !setShapeText(heading, title)) throw new Error('The template cover needs an editable title.');
    return xml(doc);
  }
  async function exportPptx(buffer, lesson, Zip = root.JSZip) {
    const deck = await readDeck(buffer, Zip);
    const originals = new Map();
    for (const [phase, sourcePath] of deck.phasePaths) originals.set(phase, await deck.archive.file(sourcePath).async('string'));
    deck.archive.file(deck.coverPath, fillCover(await deck.archive.file(deck.coverPath).async('string'), lesson.title));
    const presentation = deck.presentation;
    const slideList = all(presentation, NS.p, 'sldIdLst')[0];
    const allSlideIds = all(slideList, NS.p, 'sldId');
    for (const id of allSlideIds.slice(1)) slideList.removeChild(id);
    const relRoot = deck.relationships.documentElement;
    const relNodes = all(deck.relationships, NS.rel, 'Relationship');
    let nextId = Math.max(0, ...relNodes.map(r => Number((r.getAttribute('Id') || '').replace(/^rId/, 0)))) + 1;
    let slideNumber = Math.max(0, ...Object.keys(deck.archive.files).map(file => Number((file.match(/^ppt\/slides\/slide(\d+)\.xml$/) || [])[1]) || 0));
    const contentTypes = parse(await deck.archive.file('[Content_Types].xml').async('string'));
    const overrides = all(contentTypes, NS.ct, 'Override');
    const slideHeight = Number(all(presentation, NS.p, 'sldSz')[0]?.getAttribute('cy'));
    let outputSlideId = Math.max(0, ...allSlideIds.map(el => Number(el.getAttribute('id')) || 0)) + 1;
    for (const originalItem of lesson.slides) {
      const pages = root.LessonExport.pages(originalItem.content);
      for (let page = 0; page < pages.length; page++) {
      const item = { ...originalItem, minutes: page ? 0 : originalItem.minutes, title: page ? `${originalItem.title} (continued)` : originalItem.title, content: `${page ? 'Continued\n' : ''}${originalItem.minutes && !page ? `${originalItem.minutes} minutes\n` : ''}${pages[page]}` };
      slideNumber += 1;
      const destination = `ppt/slides/slide${slideNumber}.xml`;
      const sourcePath = deck.phasePaths.get(item.phase);
      const body = originals.get(item.phase);
      deck.archive.file(destination, fillSlide(body, item, slideHeight));
      const sourceRelsPath = sourcePath.replace(/([^/]+)$/, '_rels/$1.rels');
      const destinationRels = destination.replace(/([^/]+)$/, '_rels/$1.rels');
      const sourceRels = deck.archive.file(sourceRelsPath);
      if (sourceRels) {
        const relDoc = parse(await sourceRels.async('string'));
        // Never copy teacher notes from a template into the new lesson.
        for (const relation of all(relDoc, NS.rel, 'Relationship')) if (/\/notesSlide$/.test(relation.getAttribute('Type'))) relation.parentNode.removeChild(relation);
        deck.archive.file(destinationRels, xml(relDoc));
      }
      const relationship = deck.relationships.createElementNS(NS.rel, 'Relationship');
      relationship.setAttribute('Id', `rId${nextId++}`); relationship.setAttribute('Type', `${NS.r}/slide`);
      relationship.setAttribute('Target', `slides/slide${slideNumber}.xml`); relRoot.appendChild(relationship);
      const id = presentation.createElementNS(NS.p, 'p:sldId'); id.setAttribute('id', String(outputSlideId++)); id.setAttributeNS(NS.r, 'r:id', relationship.getAttribute('Id')); slideList.appendChild(id);
      const override = contentTypes.createElementNS(NS.ct, 'Override'); override.setAttribute('PartName', `/${destination}`); override.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml');
      if (!overrides.some(entry => entry.getAttribute('PartName') === `/${destination}`)) contentTypes.documentElement.appendChild(override);
      }
    }
    deck.archive.file('ppt/presentation.xml', xml(presentation));
    deck.archive.file('ppt/_rels/presentation.xml.rels', xml(deck.relationships));
    deck.archive.file('[Content_Types].xml', xml(contentTypes));
    return deck.archive.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }
  async function exportSourcePptx(buffer, lesson, Zip = root.JSZip) {
    if (!Zip) throw new Error('PowerPoint export is unavailable. Refresh and try again.');
    if (buffer.byteLength > 25 * 1024 * 1024) throw new Error('The source presentation is over the 25 MB export limit.');
    const archive = await Zip.loadAsync(buffer);
    if (Object.keys(archive.files).length > 5000) throw new Error('The source presentation contains too many parts.');
    const presentation = parse(await archive.file('ppt/presentation.xml')?.async('string'));
    const relationships = parse(await archive.file('ppt/_rels/presentation.xml.rels')?.async('string'));
    const rels = new Map(all(relationships, NS.rel, 'Relationship').filter(r => r.getAttribute('TargetMode') !== 'External').map(r => [r.getAttribute('Id'), slideTarget('ppt/presentation.xml', r.getAttribute('Target'))]));
    const order = all(presentation, NS.p, 'sldId');
    if (order.length < 5 || order.length > 40 || lesson.slides.length !== order.length) throw new Error(`The adapted lesson must have exactly the source deck’s ${order.length} slides. Restore the original slide count before exporting this design.`);
    for (let i = 0; i < order.length; i++) {
      const relId = order[i].getAttributeNS(NS.r, 'id');
      const path = rels.get(relId);
      if (!path) throw new Error(`Original slide ${i + 1} is missing from the presentation.`);
      const entry = archive.file(path);
      if (!entry) throw new Error(`Original slide ${i + 1} could not be opened.`);
      const doc = parse(await entry.async('string'));
      const textShapes = all(doc, NS.p, 'sp').filter(shape => all(shape, NS.a, 't').length && !all(shape, NS.a, 'fld').length);
      const replacements = lesson.slides[i].designTexts;
      if (!Array.isArray(replacements) || replacements.length !== textShapes.length) throw new Error(`Slide ${i + 1} needs ${textShapes.length} text-box replacements to preserve its layout. Re-import the source deck and regenerate the lesson.`);
      textShapes.forEach((shape, index) => {
        if (!setShapeText(shape, replacements[index])) throw new Error(`Text box ${index + 1} on slide ${i + 1} could not be updated safely.`);
      });
      archive.file(path, xml(doc));
      await updateSpeakerNotes(archive, path, lesson.slides[i].speakerNotes);
    }
    return archive.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }
  async function updateSpeakerNotes(archive, slidePath, speakerNotes) {
    const relPath = slidePath.replace(/([^/]+)$/, '_rels/$1.rels');
    const relEntry = archive.file(relPath);
    if (!relEntry) return;
    const relations = parse(await relEntry.async('string'));
    const noteRel = all(relations, NS.rel, 'Relationship').find(r => /\/notesSlide$/.test(r.getAttribute('Type')) && r.getAttribute('TargetMode') !== 'External');
    if (!noteRel) return;
    const notePath = slideTarget(slidePath, noteRel.getAttribute('Target'));
    const noteEntry = archive.file(notePath);
    if (!noteEntry) throw new Error(`Speaker notes for ${slidePath} could not be opened.`);
    const doc = parse(await noteEntry.async('string'));
    const shapes = all(doc, NS.p, 'sp').filter(shape => all(shape, NS.a, 't').length);
    const body = shapes.find(shape => all(shape, NS.p, 'ph').some(ph => ph.getAttribute('type') === 'body'))
      || shapes.find(shape => !all(shape, NS.p, 'ph').some(ph => ['sldImg', 'sldNum', 'hdr', 'ftr', 'dt'].includes(ph.getAttribute('type'))));
    if (!body) {
      if (shapes.some(shape => text(shape).trim())) throw new Error('This deck has speaker notes that could not be safely replaced. Remove or update the notes in PowerPoint before using source-design export.');
      return;
    }
    if (!setShapeText(body, String(speakerNotes || ''))) throw new Error('Speaker notes could not be updated safely.');
    archive.file(notePath, xml(doc));
  }
  root.LessonTemplate = { inspect, exportPptx, exportSourcePptx };
})(typeof window === 'object' ? window : globalThis);

