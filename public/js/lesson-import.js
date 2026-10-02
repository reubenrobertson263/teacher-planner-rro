(function (root) {
  'use strict';
  const MAX_FILE = 25 * 1024 * 1024;
  const MAX_XML = 8 * 1024 * 1024;
  const MAX_SOURCE = 120000;
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
    if (source.length > MAX_SOURCE) throw new Error('These slides contain more than 120,000 characters. Split them into smaller batches so all the content fits.');
    return { slides, source, notice: 'Text and speaker notes imported in presentation order. Images, diagrams, charts, animations and the original layout are not copied. Check the original alongside the extracted text; image-only content needs a written description.' };
  }
  async function files(selected, Zip = root.JSZip) {
    if (!selected.length) throw new Error('Choose one or more PowerPoint files or a ZIP containing them.');
    if (selected.length > 20) throw new Error('Choose up to 20 PowerPoint files per batch.');
    let inputs = [];
    for (const file of selected) {
      if (/\.pptx$/i.test(file.name)) inputs.push({ name: file.name, buffer: await file.arrayBuffer() });
      else if (/\.zip$/i.test(file.name)) {
        if (file.size > 100 * 1024 * 1024) throw new Error('Choose a ZIP smaller than 100 MB.');
        const zip = await Zip.loadAsync(await file.arrayBuffer());
        const decks = Object.values(zip.files).filter(entry => !entry.dir && /\.pptx$/i.test(entry.name));
        const uncompressed = decks.reduce((sum, entry) => sum + (entry._data?.uncompressedSize || 0), 0);
        if (!decks.length) throw new Error('This ZIP does not contain any PowerPoint presentations.');
        if (decks.length > 20 || uncompressed > 200 * 1024 * 1024) throw new Error('Choose a ZIP with no more than 20 presentations and 200 MB expanded.');
        for (const entry of decks) inputs.push({ name: entry.name, buffer: await entry.async('arraybuffer') });
      } else throw new Error('Choose .pptx presentations or a .zip containing presentations.');
    }
    if (inputs.length > 20) throw new Error('This batch contains more than 20 presentations.');
    let total = 0; const decks = []; const sections = [];
    for (const input of inputs) {
      total += input.buffer.byteLength;
      if (input.buffer.byteLength > MAX_FILE || total > 200 * 1024 * 1024) throw new Error('The selected presentations exceed the 200 MB total import limit.');
      const deck = await pptx(input.buffer, input.name, Zip);
      decks.push({ name: input.name, slides: deck.slides.length });
      sections.push(`=== SOURCE PRESENTATION: ${input.name} (${deck.slides.length} slides) ===\n${deck.source}`);
    }
    const source = sections.join('\n\n');
    if (source.length > MAX_SOURCE) throw new Error(`This batch contains ${source.length.toLocaleString()} characters of slide text; the workspace limit is ${MAX_SOURCE.toLocaleString()}. Select fewer presentations or edit the source text.`);
    return { source, decks, notice: 'All presentation text and speaker notes are grouped by filename. Source images and slide layouts stay in the originals; the selected BCHS template styles the new lesson.' };
  }
  root.LessonImport = { pptx, files, MAX_FILE, MAX_SOURCE };
})(typeof window === 'object' ? window : globalThis);
