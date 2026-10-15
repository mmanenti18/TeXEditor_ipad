// TeX Live engines (pdfTeX, LuaHBTeX) compiled to WebAssembly, running in the same worker as the
// SwiftLaTeX pdfTeX so they all share the TeX bundle (PACKS) and BibTeX.
// Loaded with 'tl-boot' messages: {engine: 'pdflatex' | 'lualatex', glueJs, js, wasm, factory, pack: {index, blob}}.
//
// Each engine uses the real kpathsea on a small TeX tree in its own in-memory file system:
//   /texlive/base   every file of the bundle, flat              (views into the bundle, no copies)
//   /texlive/texmf  the engine's own pack as a TeX tree (+ ls-R)  /texlive/web2c  texmf.cnf
//   /texlive/fmt    the format                                    /texlive/var    luaotfload caches
// One instance per engine; before each pass its memory is reset to the state right after start-up
// (as the SwiftLaTeX side does) while its file system carries over.
var TL = TL || {};
const TL_WORK = '/work';
const TL_TIME = 1700000000 * 1000;   // the time stamp the font caches were made with (luaotfload compares it)
const TL_ARGS = {
  pdflatex: ['-progname=pdflatex', '-fmt=pdflatex'],
  lualatex: ['-progname=lualatex', '-fmt=lualatex'],
};

function tlReadText(M, p) {
  try { return M.FS.readFile(TL_WORK + '/' + p, { encoding: 'utf8' }); } catch (e) { return null; }
}
function tlMkdirp(M, dir) {
  let cur = '';
  dir.split('/').filter(Boolean).forEach(function (part) {
    cur += '/' + part;
    try { M.FS.mkdir(cur); } catch (e) {}
  });
}
function tlCleanDir(M, dir) {
  M.FS.readdir(dir).forEach(function (item) {
    if (item === '.' || item === '..') return;
    const p = dir + '/' + item;
    const st = M.FS.stat(p);
    if (M.FS.isDir(st.mode)) { tlCleanDir(M, p); M.FS.rmdir(p); } else M.FS.unlink(p);
  });
}

async function tlBoot(d) {
  importScripts(URL.createObjectURL(new Blob([d.js], { type: 'text/javascript' })));
  TL[d.engine] = { name: d.engine, factory: self[d.factory], wasmModule: await WebAssembly.compile(d.wasm), pack: d.pack, inst: null, project: null, userFiles: new Set() };
  self.postMessage({ cmd: 'tl-ready', engine: d.engine });
}

async function tlInstance(E) {
  if (E.inst) return E.inst;
  const out = { text: '' };
  const M = await E.factory({
    instantiateWasm: function (imports, done) {
      WebAssembly.instantiate(E.wasmModule, imports).then(function (inst) { done(inst); });
      return {};
    },
    thisProgram: '/texlive/bin/tex',
    print: function (s) { out.text += s + '\n'; },
    printErr: function (s) { out.text += s + '\n'; },
    preRun: [function (M) {
      Object.assign(M.ENV, { TEXMFCNF: '/texlive/web2c', HOME: '/texlive/var', USER: 'tex', LANG: 'C.UTF-8' });
    }],
  });
  const FS = M.FS;
  const t0 = Date.now();
  ['/texlive', '/texlive/bin', '/texlive/base', '/texlive/var', TL_WORK].forEach(function (p) { try { FS.mkdir(p); } catch (e) {} });
  FS.writeFile('/texlive/bin/tex', '');
  // The bundle and its extra packs, flat (later packs win).
  for (let k = 0; k < PACKS.length; k++) {
    const idx = PACKS[k].index, blob = PACKS[k].blob;
    for (const name in idx) {
      if (!has.call(idx, name) || name.endsWith('.fmt')) continue;
      const e = idx[name];
      const p = '/texlive/base/' + name;
      try { FS.unlink(p); } catch (err) {}
      FS.writeFile(p, new Uint8Array(blob, e[0], e[1]), { canOwn: true });
    }
  }
  // The engine's pack, as a tree, with the time stamps its caches expect.
  const lidx = E.pack.index, lblob = E.pack.blob;
  for (const rel in lidx) {
    if (!has.call(lidx, rel)) continue;
    const e = lidx[rel];
    const p = '/texlive/' + rel;
    tlMkdirp(M, p.slice(0, p.lastIndexOf('/')));
    FS.writeFile(p, new Uint8Array(lblob, e[0], e[1]), { canOwn: true });
    FS.utime(p, TL_TIME, TL_TIME);
  }
  E.inst = { M: M, out: out, snapshot: M.HEAPU8.slice(0), sp: M.stackSave(), setupMs: Date.now() - t0 };
  return E.inst;
}

function tlReset(L) {
  const M = L.M;
  M.HEAPU8.set(L.snapshot);
  M.stackRestore(L.sp);
  const streams = M.FS.streams;
  for (let i = 0; i < streams.length; i++) {
    const s = streams[i];
    if (s && s.fd > 2) { try { M.FS.close(s); } catch (e) {} }
  }
  L.out.text = '';
  M.FS.chdir(TL_WORK);
}

function tlSyncFiles(E, M, req) {
  if (req.project !== E.project) {
    tlCleanDir(M, TL_WORK);
    E.userFiles = new Set();
    E.project = req.project;
  }
  const incoming = new Set(req.files.map(function (f) { return f.path; }));
  E.userFiles.forEach(function (p) { if (!incoming.has(p)) { try { M.FS.unlink(TL_WORK + '/' + p); } catch (e) {} } });
  req.files.forEach(function (f) {
    const full = TL_WORK + '/' + f.path;
    tlMkdirp(M, full.slice(0, full.lastIndexOf('/')));
    M.FS.writeFile(full, f.data);
  });
  E.userFiles = incoming;
}

function tlAuxSnapshot(M, stem) {
  return ['aux', 'toc', 'lof', 'lot', 'out', 'nav', 'snm', 'tdo', 'bbl'].map(function (ext) { return tlReadText(M, stem + '.' + ext) || ''; }).join('\u0000');
}

async function tlCompileRoutine(req) {
  const t0 = Date.now();
  const E = TL[req.engine];
  if (!E) throw new Error(req.engine + ' non è ancora caricato.');
  let L;
  try { L = await tlInstance(E); }
  catch (e) { E.inst = null; throw e; }
  const M = L.M;
  syncFiles(req);            // the SwiftLaTeX side runs BibTeX
  tlSyncFiles(E, M, req);
  const main = req.main;
  const stem = main.replace(/\.tex$/, '');
  const maxPasses = req.maxPasses || 3;
  let status = -1, passes = 0, log = '', ranBibtex = false, bibLog = '';
  let before = tlAuxSnapshot(M, stem);
  while (passes < maxPasses) {
    tlReset(L);
    try {
      status = M.callMain(TL_ARGS[req.engine].concat(['-interaction=nonstopmode', '-synctex=-1', main]));
    } catch (e) {
      E.inst = null;   // the instance can't be trusted after a trap: a new one next time
      log = L.out.text + '\n' + String(e && e.stack || e);
      self.postMessage({ cmd: 'compiled', id: req.id, status: -254, passes: passes + 1, ms: Date.now() - t0, log: log + '\n[Il motore si è fermato in modo anomalo]', pdf: null, engine: req.engine });
      return;
    }
    passes++;
    log = L.out.text;
    if (status !== 0) break;
    const aux = tlReadText(M, stem + '.aux') || '';
    if (!ranBibtex && /\\bibdata\{/.test(aux)) {
      // BibTeX is the SwiftLaTeX side's: give it what this pass wrote (.aux, biblatex's -blx.bib…), take back the .bbl.
      M.FS.readdir(TL_WORK).forEach(function (name) {
        if (name === '.' || name === '..' || E.userFiles.has(name) || /\.(pdf|log|synctex(\.gz)?)$/i.test(name)) return;
        try {
          if (M.FS.isFile(M.FS.stat(TL_WORK + '/' + name).mode)) FS.writeFile(WORKROOT + '/' + name, M.FS.readFile(TL_WORK + '/' + name));
        } catch (e) {}
      });
      prepareExecutionContext();
      cwrap('setMainEntry', 'number', ['string'])(main);
      _compileBibtex();
      bibLog = self.memlog || readText(stem + '.blg') || '';
      const bbl = readText(stem + '.bbl');
      if (bbl !== null) M.FS.writeFile(TL_WORK + '/' + stem + '.bbl', bbl);
      ranBibtex = true;
    }
    const after = tlAuxSnapshot(M, stem);
    if (after === before) break;
    before = after;
  }
  if (bibLog) log += '\n\n===== BibTeX =====\n' + bibLog;
  let pdf = null;
  try { pdf = M.FS.readFile(TL_WORK + '/' + stem + '.pdf'); } catch (e) {}
  const msg = {
    cmd: 'compiled', id: req.id, status: status, passes: passes, ms: Date.now() - t0, setupMs: L.setupMs, log: log, engine: req.engine,
    pdf: status === 0 && pdf ? pdf.slice().buffer : null,
    aux: tlReadText(M, stem + '.aux'), nav: tlReadText(M, stem + '.nav'),
    synctex: status === 0 ? tlReadText(M, stem + '.synctex') : null,
  };
  L.setupMs = 0;
  self.postMessage(msg, msg.pdf ? [msg.pdf] : []);
}
