import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { renderTufteDocument } from '@red-cup-engineering/web-page-tiling-engine';

const EDUCATION_STYLES = `
pre{max-width:100%;overflow:auto}
.education-app{display:grid;grid-template-columns:minmax(12rem,16rem) minmax(0,1fr);gap:1rem;align-items:start}
.education-app #load-status,.education-app #storage-status,.education-app .education-actions{grid-column:1/-1;margin:0}
.education-app #room-list{display:flex;flex-direction:column;gap:.35rem;position:sticky;top:1rem}
.education-app .room-item{display:flex;align-items:center;gap:.5rem;width:100%;text-align:left}
.education-app .room-title{flex:1}.education-app .room-mastery{font-size:.8em}
.education-app .room-dot,.education-app .progress-dot{display:inline-block;background:currentColor;opacity:.25}
.education-app .room-dot{width:.65rem;height:.65rem;border-radius:50%;flex:none}
.education-app .room-item.unlocked .room-dot,.education-app .room-item.mastered .room-dot,.education-app .progress-dot.current,.education-app .progress-dot.done{opacity:1}
.education-app #content-panel{min-width:0;padding:.25rem 0;min-height:18rem}
.education-app .answer-form{display:flex;flex-direction:column;gap:.65rem;max-width:34rem}.education-app .answer-form label{display:grid;gap:.3rem}
.education-app .grade-row,.education-app .toggle-row,.education-app .radio-row,.education-app .progress-strip,.education-app .education-actions{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.education-app .progress-dot{width:1.4rem;height:.35rem}.education-app .verdict{margin-top:.9rem;padding:.65rem;border:1px solid currentColor}.education-app .verdict.fail{border-style:dashed}.education-app .verdict.pass{border-style:double}
.education-app pre{overflow:auto}.education-app table{width:100%;border-collapse:collapse}.education-app th,.education-app td{border:1px solid currentColor;padding:.35rem;text-align:left}
@media(max-width:42rem){.education-app{grid-template-columns:1fr}.education-app #room-list{position:static}}
`;

function mountDirectory(mountPath) {
  if (mountPath === '/') return '';
  if (typeof mountPath !== 'string' || !/^\/(?:[a-z0-9][a-z0-9-]*\/)+$/i.test(mountPath)) {
    throw new TypeError('mountPath must be / or a slash-terminated path of URL segments');
  }
  return mountPath.slice(1, -1);
}

function artifactPath(directory, path) {
  return directory ? `${directory}/${path}` : path;
}

function safeCourseId(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value)) throw new TypeError('course id must be a lowercase URL-safe token');
  return value;
}

function safeExportName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) throw new TypeError('adapter exportName must be a JavaScript identifier');
  return value;
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function educationShell({ brand, course, bootstrapHref }) {
  const title = brand?.title ?? course.id;
  const subtitle = brand?.subtitle ?? '';
  const orientation = brand?.orientationHtml ?? '';
  const source = brand?.sourceHtml ?? '';
  const appHtml = `<div class="education-app" lang="${escapeAttribute(brand?.language ?? 'en')}">${brand?.presentationHtml ?? ''}<p id="load-status" role="status">Loading course…</p><nav id="room-list" aria-label="Course rooms"></nav><section id="content-panel" aria-live="polite"></section><p id="storage-status" role="status" hidden></p><p class="education-actions"><button type="button" id="btn-export">Export save</button><button type="button" id="btn-import">Import save</button><input type="file" id="file-import" accept="application/json" hidden></p></div>`;
  return renderTufteDocument({
    title,
    subtitle,
    tiles: [
      { id: 'orientation', title: brand?.orientationTitle ?? 'Start here', html: orientation || '<p>Choose a room to begin.</p>' },
      { id: 'course', title: brand?.courseTitle ?? 'Practice', html: appHtml, span: 8 },
      { id: 'source', title: brand?.sourceTitle ?? 'Source', html: source || '<p>Course material is identified with the lesson.</p>', span: brand?.sourceSpan ?? 4 },
    ],
  }, {
    theme: brand?.tufteTheme,
    language: brand?.language ?? 'en',
    documentTitle: brand?.documentTitle ?? title,
    styles: EDUCATION_STYLES,
    headHtml: `<script type="module" src="${escapeAttribute(bootstrapHref)}"></script>`,
  });
}

async function educationBrowser({ course, worldPath }) {
  const adapterSource = course.adapter.source;
  if (!(adapterSource instanceof URL) || adapterSource.protocol !== 'file:') {
    throw new TypeError('course adapter.source must be a local module URL');
  }
  const contents = `import { mountEducationApp } from ${JSON.stringify(fileURLToPath(new URL('../web/js/app.js', import.meta.url)))};\n` +
    `import { ${course.adapter.exportName} } from ${JSON.stringify(fileURLToPath(adapterSource))};\n` +
    `mountEducationApp({ root: document, adapter: { ...${course.adapter.exportName}, worldUrl: new URL(${JSON.stringify(`../${worldPath}`)}, import.meta.url).href } });\n`;
  const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));
  const result = await build({
    absWorkingDir: sourceDirectory,
    stdin: { contents, sourcefile: 'education-bootstrap.mjs', resolveDir: sourceDirectory },
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    inject: [fileURLToPath(new URL('./browser-buffer.mjs', import.meta.url))],
    write: false, minify: true, legalComments: 'eof', metafile: true, logLevel: 'silent',
  });
  // Carry the notices of the packages actually included in this browser build.
  const notices = new Map();
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.includes('node_modules/')) continue;
    let directory = dirname(resolve(sourceDirectory, input));
    while (dirname(directory) !== directory) {
      let metadata;
      try { metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')); } catch {}
      if (metadata) {
        if (!notices.has(metadata.name)) {
          try { notices.set(metadata.name, await readFile(resolve(directory, 'LICENSE'), 'utf8')); } catch {}
        }
        break;
      }
      directory = dirname(directory);
    }
  }
  const licenses = [...notices].map(([name, notice]) => `\n/*! ${name}\n${notice.replaceAll('*/', '* /')} */\n`).join('');
  return result.outputFiles[0].text + licenses;
}

/** Create a VICTOR projector for one parameterized education course. */
export function createEducationProjector({ mountPath = '/', course, brand = {} } = {}) {
  if (!course?.id || typeof course.buildWorld !== 'function' || !course.adapter?.exportName || !course.adapter?.source) {
    throw new TypeError('course needs an id, buildWorld(), and adapter source/export metadata');
  }
  const courseId = safeCourseId(course.id);
  const directory = mountDirectory(mountPath);
  safeExportName(course.adapter.exportName);

  return Object.freeze({
    name: `education-${courseId}`,
    priority: 15,
    async project() {
      const world = await course.buildWorld();
      const worldPath = `data/${courseId}-world.json`;
      const bootstrapPath = 'js/education-bootstrap.js';
      const browser = await educationBrowser({ course, worldPath });
      const artifacts = [
        { path: artifactPath(directory, worldPath), body: `${JSON.stringify(world, null, 2)}\n`, source: `course:${courseId}:world` },
        { path: artifactPath(directory, bootstrapPath), body: browser, source: `course:${courseId}:bootstrap` },
        { path: artifactPath(directory, 'index.html'), body: educationShell({ brand, course: { ...course, id: courseId }, bootstrapHref: `./${bootstrapPath}` }), source: `course:${courseId}:shell` },
      ];
      return { artifacts };
    },
  });
}
