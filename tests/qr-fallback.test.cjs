const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('crear/perfil.html', 'utf8');
const start = html.indexOf('(()=>{\n const qr=document.getElementById("qrBtn")');
const end = html.indexOf('</script>', start);
assert.ok(start > 0 && end > start, 'QR fallback exists');

function element() {
  return {
    style: {}, events: {},
    setAttribute() {},
    addEventListener(name, handler) { this.events[name] = handler; },
    insertAdjacentElement(_position, child) { this.child = child; },
  };
}

function setup(writeText) {
  const qr = element(), image = element(), dialog = element();
  const created = [];
  const document = {
    getElementById: (id) => ({ qrBtn: qr, qrImage: image, qrDialog: dialog })[id],
    createElement: () => { const item = element(); created.push(item); return item; },
    body: { appendChild() {} },
    execCommand: () => false,
  };
  vm.runInNewContext(html.slice(start, end), {
    document, slug: 'cliente',
    location: { origin: 'https://clickonme.pro', href: 'https://clickonme.pro/crear/perfil.html?u=cliente' },
    navigator: { clipboard: { writeText } },
    encodeURIComponent, Error,
  });
  return { qr, image, notice: created[0], copy: created[1] };
}

test('shows the link option when the QR image fails', async () => {
  const { image, notice, copy } = setup(async () => {});
  image.events.error();
  assert.equal(image.style.display, 'none');
  assert.equal(copy.style.display, 'block');
  await copy.events.click();
  assert.equal(notice.textContent, 'Enlace copiado.');
});

test('shows the actual link when clipboard access also fails', async () => {
  const { image, notice, copy } = setup(async () => { throw new Error('denied'); });
  image.events.error();
  await copy.events.click();
  assert.match(notice.textContent, /https:\/\/clickonme\.pro\/crear\/perfil\.html\?u=cliente/);
});
