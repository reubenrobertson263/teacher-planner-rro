(function (root) {
  'use strict';
  const MAX_FILE = 25 * 1024 * 1024;
  const MAX_XML = 8 * 1024 * 1024;
  function xml(raw) {
    const document = new root.DOMParser().parseFromString(raw, 'application/xml');
    if (document.getElementsByTagName('parsererror').length) throw new Error('This presentation contains invalid XML.');
    return document;
  }
  function elements(doc, name) { return [...doc.getElementsByTagNameNS('*', name)]; }
  function lines(doc) {
    return elements(doc, 'p').map(p => elements(p, 't').map(t => t.textContent).join('')).filter(Boolean).join('\n');
  }
  function resolve(base, target) {
    const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
    for (const part of target.split('/')) {
      if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  }
  async function pptx(buffer, name, Zip = root.JSZip) {
    if (!Zip) throw new Error('Presentation importer is unavailable. Refresh and try again.');
    if (buffer.byteLength > MAX_FILE) throw new Error('Choose a presentation under 25 MB.');
    const zip = await Zip.loadAsync(buffer);
    const files = Object.values(zip.files);
    if (files.length > 5000) throw new Error('This presentation has too many embedded files.');
    let expanded = 0;
    for (const file of files) {
      // Inspect ZIP directory sizes before decompression, including oversized image archives.
      const size = file._data?.uncompressedSize || 0;
      expanded += size;
      if (expanded > 100 * 1024 * 1024 || (/\.xml$/.test(file.name) && size > MAX_XML)) throw new Error('Presentation expands beyond the import limit.');
    }
    let readTotal = 0;
    async function read(path) {
      const entry = zip.file(path);
      if (!entry) throw new Error(`Presentation part missing: ${path}`);
      const raw = await new Promise((accept, reject) => {
        let output = '';
        const stream = entry.internalStream('string');
        stream.on('data', chunk => {
          if (output.length + chunk.length > MAX_XML) { stream.pause(); reject(new Error('Presentation text exceeds the import limit.')); }
          else output += chunk;
        });
        stream.on('error', reject);
        stream.on('end', () => accept(output));
        stream.resume();
      });
      readTotal += raw.length;
      if (raw.length > MAX_XML || readTotal > 20 * 1024 * 1024) throw new Error('Presentation text exceeds the import limit.');
      return xml(raw);
    }
    const presentation = await read('ppt/presentation.xml');
    const relations = await read('ppt/_rels/presentation.xml.rels');
    const targets = new Map(elements(relations, 'Relationship').filter(r => r.getAttribute('TargetMode') !== 'External').map(r => [r.getAttribute('Id'), resolve('ppt/presentation.xml', r.getAttribute('Target'))]));
    const order = elements(presentation, 'sldId');
    if (!order.length || order.length > 120) throw new Error('Import a presentation with 1–120 slides.');
    const slides = [];
    for (const id of order) {
      const rel = id.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const path = targets.get(rel);
      if (!path) throw new Error('A slide relationship is missing.');
      const doc = await read(path);
      const text = lines(doc);
      const relPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
      let notes = '';
      if (zip.file(relPath)) {
        const slideRels = await read(relPath);
        const note = elements(slideRels, 'Relationship').find(r => /\/notesSlide$/.test(r.getAttribute('Type')) && r.getAttribute('TargetMode') !== 'External');
        if (note) notes = lines(await read(resolve(path, note.getAttribute('Target'))));
      }
      slides.push({ title: text.split('\n')[0] || `Slide ${slides.length + 1}`, content: text, speakerNotes: notes, sourceRef: `${name}, slide ${slides.length + 1}`, phase: 'Explicit Instruction', minutes: 0 });
    }
    const source = slides.map((s, i) => `[Source slide ${i + 1}]\n${s.content || '[No extractable text]'}${s.speakerNotes ? '\nTeacher notes: ' + s.speakerNotes : ''}`).join('\n\n');
    if (source.length > 60000) throw new Error('This deck has more than 60,000 characters. Split it into smaller presentations to keep all the content.');
    return { slides, source, notice: 'Text and speaker notes imported in presentation order. Images, diagrams, charts, animations and the original layout are not copied. Check the original alongside the extracted text; image-only content needs a written description.' };
  }
  root.LessonImport = { pptx, MAX_FILE };
})(typeof window === 'object' ? window : globalThis);
