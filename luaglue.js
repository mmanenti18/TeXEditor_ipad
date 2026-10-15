// LuaLaTeX, running in the same worker as pdfTeX so the two share the TeX bundle (PACKS) and BibTeX.
// Loaded on demand with the 'lua-boot' message: {glueJs, luaJs, luaWasm, pack: {index, blob}}.
//
// LuaHBTeX uses the real kpathsea, so it gets a small TeX tree in its own in-memory file system:
//   /texlive/base   every file of the pdfTeX bundle, flat   (views into the bundle, no copies)
//   /texlive/texmf  the LuaLaTeX pack as a TeX tree        (+ ls-R)
//   /texlive/web2c  texmf.cnf     /texlive/fmt  lualatex.fmt     /texlive/var  luaotfload caches
// One instance is created; before each pass its memory is reset to the state right after start-up,
// as the pdfTeX side does, while the file system (and so the font caches) carries over.
var LUA = null;
const LUA_WORK = '/work';
const LUA_TIME = 1700000000 * 1000;   // the time stamp the font caches were made with (luaotfload compares it)

function luaReadText(M, p) {
  try { return M.FS.readFile(LUA_WORK + '/' + p, { encoding: 'utf8' }); } catch (e) { return null; }
}
function luaMkdirp(M, dir) {
  let cur = '';
  dir.split('/').filter(Boolean).forEach(function (part) {
    cur += '/' + part;
    try { M.FS.mkdir(cur); } catch (e) {}
  });
}
function luaCleanDir(M, dir) {
  M.FS.readdir(dir).forEach(function (item) {
    if (item === '.' || item === '..') return;
    const p = dir + '/' + item;
    const st = M.FS.stat(p);
    if (M.FS.isDir(st.mode)) { luaCleanDir(M, p); M.FS.rmdir(p); } else M.FS.unlink(p);
  });
}

async function luaBoot(d) {
  importScripts(URL.createObjectURL(new Blob([d.luaJs], { type: 'text/javascript' })));
  LUA = { factory: self.createLuaTeX, wasmModule: await WebAssembly.compile(d.luaWasm), pack: d.pack, inst: null, project: null, userFiles: new Set() };
  self.postMessage({ cmd: 'lua-ready' });
}

async function luaInstance() {
  if (LUA.inst) return LUA.inst;
  const out = { text: '' };
  const M = await LUA.factory({
    instantiateWasm: function (imports, done) {
      WebAssembly.instantiate(LUA.wasmModule, imports).then(function (inst) { done(inst); });
      return {};
    },
    thisProgram: '/texlive/bin/luahbtex',
    print: function (s) { out.text += s + '\n'; },
    printErr: function (s) { out.text += s + '\n'; },
    preRun: [function (M) {
      Object.assign(M.ENV, { TEXMFCNF: '/texlive/web2c', HOME: '/texlive/var', USER: 'tex', LANG: 'C.UTF-8' });
    }],
  });
  const FS = M.FS;
  const t0 = Date.now();
  ['/texlive', '/texlive/bin', '/texlive/base', '/texlive/var', LUA_WORK].forEach(function (p) { try { FS.mkdir(p); } catch (e) {} });
  // The pdfTeX bundle and its extra packs, flat (later packs win, as for pdfTeX).
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
  // The LuaLaTeX pack, as a tree, with the time stamps the caches expect.
  const lidx = LUA.pack.index, lblob = LUA.pack.blob;
  for (const rel in lidx) {
    if (!has.call(lidx, rel)) continue;
    const e = lidx[rel];
    const p = '/texlive/' + rel;
    luaMkdirp(M, p.slice(0, p.lastIndexOf('/')));
    FS.writeFile(p, new Uint8Array(lblob, e[0], e[1]), { canOwn: true });
    FS.utime(p, LUA_TIME, LUA_TIME);
  }
  FS.writeFile('/texlive/bin/luahbtex', '');
  const heap = M.HEAPU8;
  LUA.inst = { M: M, out: out, snapshot: heap.slice(0), sp: M.stackSave(), setupMs: Date.now() - t0 };
  return LUA.inst;
}

function luaReset(L) {
  const M = L.M;
  M.HEAPU8.set(L.snapshot);
  M.stackRestore(L.sp);
  const streams = M.FS.streams;
  for (let i = 0; i < streams.length; i++) {
    const s = streams[i];
    if (s && s.fd > 2) { try { M.FS.close(s); } catch (e) {} }
  }
  L.out.text = '';
  M.FS.chdir(LUA_WORK);
}

function luaSyncFiles(M, req) {
  if (req.project !== LUA.project) {
    luaCleanDir(M, LUA_WORK);
    LUA.userFiles = new Set();
    LUA.project = req.project;
  }
  const incoming = new Set(req.files.map(function (f) { return f.path; }));
  LUA.userFiles.forEach(function (p) { if (!incoming.has(p)) { try { M.FS.unlink(LUA_WORK + '/' + p); } catch (e) {} } });
  req.files.forEach(function (f) {
    const full = LUA_WORK + '/' + f.path;
    luaMkdirp(M, full.slice(0, full.lastIndexOf('/')));
    M.FS.writeFile(full, f.data);
  });
  LUA.userFiles = incoming;
}

function luaAuxSnapshot(M, stem) {
  return ['aux', 'toc', 'lof', 'lot', 'out', 'nav', 'snm', 'tdo', 'bbl'].map(function (ext) { return luaReadText(M, stem + '.' + ext) || ''; }).join('\u0000');
}

async function luaCompileRoutine(req) {
  const t0 = Date.now();
  if (!LUA) throw new Error('LuaLaTeX non è ancora caricato.');
  let L;
  try { L = await luaInstance(); }
  catch (e) { LUA.inst = null; throw e; }
  const M = L.M;
  syncFiles(req);            // pdfTeX side: BibTeX runs there
  luaSyncFiles(M, req);
  const main = req.main;
  const stem = main.replace(/\.tex$/, '');
  const maxPasses = req.maxPasses || 3;
  let status = -1, passes = 0, log = '', ranBibtex = false, bibLog = '';
  let before = luaAuxSnapshot(M, stem);
  while (passes < maxPasses) {
    luaReset(L);
    try {
      status = M.callMain(['-progname=lualatex', '-fmt=lualatex', '-interaction=nonstopmode', main]);
    } catch (e) {
      LUA.inst = null;   // the instance can't be trusted after a trap: a new one next time
      log = L.out.text + '\n' + String(e && e.stack || e);
      self.postMessage({ cmd: 'compiled', id: req.id, status: -254, crashed: false, passes: passes + 1, ms: Date.now() - t0, log: log + '\n[LuaLaTeX si è fermato in modo anomalo]', pdf: null });
      return;
    }
    passes++;
    log = L.out.text;
    if (status !== 0) break;
    const aux = luaReadText(M, stem + '.aux') || '';
    if (!ranBibtex && /\\bibdata\{/.test(aux)) {
      // BibTeX is the pdfTeX side's: give it what this pass wrote (.aux, biblatex's -blx.bib…), take back the .bbl.
      M.FS.readdir(LUA_WORK).forEach(function (name) {
        if (name === '.' || name === '..' || LUA.userFiles.has(name) || /\.(pdf|log|synctex(\.gz)?)$/i.test(name)) return;
        try {
          if (M.FS.isFile(M.FS.stat(LUA_WORK + '/' + name).mode)) FS.writeFile(WORKROOT + '/' + name, M.FS.readFile(LUA_WORK + '/' + name));
        } catch (e) {}
      });
      prepareExecutionContext();
      setMainBib(main);
      _compileBibtex();
      bibLog = self.memlog || readText(stem + '.blg') || '';
      const bbl = readText(stem + '.bbl');
      if (bbl !== null) M.FS.writeFile(LUA_WORK + '/' + stem + '.bbl', bbl);
      ranBibtex = true;
    }
    const after = luaAuxSnapshot(M, stem);
    if (after === before) break;
    before = after;
  }
  if (bibLog) log += '\n\n===== BibTeX =====\n' + bibLog;
  let pdf = null;
  try { pdf = M.FS.readFile(LUA_WORK + '/' + stem + '.pdf'); } catch (e) {}
  const msg = {
    cmd: 'compiled', id: req.id, status: status, passes: passes, ms: Date.now() - t0, setupMs: L.setupMs, log: log, engine: 'lualatex',
    pdf: status === 0 && pdf ? pdf.slice().buffer : null,
    aux: luaReadText(M, stem + '.aux'), nav: luaReadText(M, stem + '.nav'),
  };
  L.setupMs = 0;
  self.postMessage(msg, msg.pdf ? [msg.pdf] : []);
}
function setMainBib(main) { cwrap('setMainEntry', 'number', ['string'])(main); }
